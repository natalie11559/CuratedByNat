// The daily job that copies Nat's newest Instagram pictures into our own storage.
//
// Why copies: Instagram's picture links stop working after a few days, so the website can't point at them.
// Order: refresh the access token, list recent posts, download new pictures into R2, save the list,
// ask Cloudflare to rebuild the site if the list changed, and email Nat if the connection needs her.
// Everything is written so a failure here can never affect the live website.
import type { D1Database, R2Bucket } from '../cloudflare.ts';
import { sendWithResend } from '../inquiry/email.ts';
import {
    EMPTY_MANIFEST,
    daysUntilExpiry,
    extensionForContentType,
    manifestFingerprint,
    pictureUrl,
    toFeedPost,
    tokenIsExpiringSoon,
    tokenNeedsRefresh,
    type FeedManifest,
    type FeedPost,
    type RawMedia,
    type TokenState,
} from './feed.ts';

export interface SyncEnv {
    DB?: D1Database;
    INSTAGRAM_BUCKET?: R2Bucket;
    /** Seed token generated in Meta's dashboard. After the first run the refreshed copy lives in D1. */
    INSTAGRAM_ACCESS_TOKEN?: string;
    /** Cloudflare Workers Builds deploy hook for the main branch. */
    DEPLOY_HOOK_URL?: string;
    RESEND_API_KEY?: string;
    INQUIRY_TO?: string;
    INQUIRY_FROM?: string;
}

export const MANIFEST_KEY = 'feed.json';
export const IMAGE_PREFIX = 'img/';
/** Enough for the 12-photo slideshow even after Nat hides a few posts. */
const POSTS_TO_KEEP = 24;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const GRAPH = 'https://graph.instagram.com';
const ALERT_EVERY_DAYS = 3;

type Fetcher = typeof fetch;

export interface SyncResult {
    status: 'not-configured' | 'ok' | 'failed';
    posts: number;
    rebuildRequested: boolean;
    problem: string | null;
}

// ---- State kept in D1 (table instagram_state) -----------------------------------------------------

async function readState<T>(db: D1Database, key: string): Promise<T | null> {
    try {
        const row = await db.prepare('SELECT value FROM instagram_state WHERE key = ?1').bind(key).first<{ value: string }>();
        return row ? (JSON.parse(row.value) as T) : null;
    } catch (error) {
        console.error(`[instagram] Could not read "${key}" from D1:`, errorMessage(error));
        return null;
    }
}

async function writeState(db: D1Database, key: string, value: unknown, now: Date): Promise<void> {
    try {
        await db
            .prepare(
                `INSERT INTO instagram_state (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            )
            .bind(key, JSON.stringify(value), now.toISOString())
            .run();
    } catch (error) {
        console.error(`[instagram] Could not save "${key}" to D1:`, errorMessage(error));
    }
}

interface SyncStatus {
    at: string;
    ok: boolean;
    problem: string | null;
    posts: number;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// ---- Instagram ------------------------------------------------------------------------------------

class InstagramError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
    /** Meta answers 400 or 401 when a token is expired or revoked. */
    get isAuthProblem(): boolean {
        return this.status === 400 || this.status === 401 || this.status === 403;
    }
}

async function graphGet<T>(fetcher: Fetcher, path: string, params: Record<string, string>): Promise<T> {
    const url = `${GRAPH}${path}?${new URLSearchParams(params)}`;
    const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } & T;
    if (!response.ok) {
        // The URL carries the token, so it is never logged; only Meta's own message is.
        throw new InstagramError(`Instagram responded ${response.status}${body?.error?.message ? `: ${body.error.message}` : ''}`, response.status);
    }
    return body;
}

async function refreshToken(fetcher: Fetcher, state: TokenState, now: Date): Promise<TokenState> {
    const answer = await graphGet<{ access_token: string; expires_in: number }>(fetcher, '/refresh_access_token', {
        grant_type: 'ig_refresh_token',
        access_token: state.token,
    });
    return {
        token: answer.access_token,
        refreshedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + answer.expires_in * 1000).toISOString(),
    };
}

async function listRecentMedia(fetcher: Fetcher, token: string): Promise<RawMedia[]> {
    const answer = await graphGet<{ data?: RawMedia[] }>(fetcher, '/me/media', {
        fields: 'id,media_type,media_url,thumbnail_url,permalink,timestamp,caption',
        limit: String(POSTS_TO_KEEP),
        access_token: token,
    });
    return answer.data ?? [];
}

async function downloadPicture(fetcher: Fetcher, url: string): Promise<{ bytes: ArrayBuffer; extension: string; contentType: string } | null> {
    const response = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    const extension = extensionForContentType(contentType);
    if (!extension) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return { bytes, extension, contentType: contentType.split(';')[0]!.trim() };
}

// ---- The job --------------------------------------------------------------------------------------

/** Tries the saved token first, then the seed secret, so a freshly generated token fixes an expired one. */
async function workingToken(
    env: SyncEnv,
    db: D1Database,
    fetcher: Fetcher,
    now: Date,
): Promise<{ state: TokenState; media: RawMedia[] }> {
    const saved = await readState<TokenState>(db, 'token');
    const candidates: TokenState[] = [];
    if (saved) candidates.push(saved);
    if (env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_ACCESS_TOKEN !== saved?.token) {
        candidates.push({ token: env.INSTAGRAM_ACCESS_TOKEN, refreshedAt: null, expiresAt: null });
    }
    if (candidates.length === 0) throw new InstagramError('No Instagram access token is set.', 0);

    let lastError: unknown = null;
    for (const candidate of candidates) {
        let state = candidate;
        try {
            if (tokenNeedsRefresh(state, now)) {
                try {
                    state = await refreshToken(fetcher, state, now);
                    await writeState(db, 'token', state, now);
                } catch (error) {
                    // A token younger than 24 hours can't be refreshed yet; it still works for reading.
                    if (!(error instanceof InstagramError) || !error.isAuthProblem) throw error;
                    console.warn(`[instagram] Token refresh did not work: ${error.message}`);
                }
            }
            const media = await listRecentMedia(fetcher, state.token);
            if (state.token !== saved?.token) await writeState(db, 'token', state, now);
            return { state, media };
        } catch (error) {
            lastError = error;
            if (!(error instanceof InstagramError) || !error.isAuthProblem) throw error;
        }
    }
    throw lastError;
}

async function readManifest(bucket: R2Bucket): Promise<FeedManifest> {
    const object = await bucket.get(MANIFEST_KEY);
    if (!object) return EMPTY_MANIFEST;
    try {
        return JSON.parse(await object.text()) as FeedManifest;
    } catch {
        return EMPTY_MANIFEST;
    }
}

async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
        const page = await bucket.list({ prefix, cursor });
        keys.push(...page.objects.map((object) => object.key));
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return keys;
}

async function copyPictures(bucket: R2Bucket, fetcher: Fetcher, media: RawMedia[]): Promise<FeedPost[]> {
    const stored = new Map<string, string>();
    for (const key of await listKeys(bucket, IMAGE_PREFIX)) {
        const name = key.slice(IMAGE_PREFIX.length);
        stored.set(name.replace(/\.[a-z]+$/, ''), name);
    }

    const posts: FeedPost[] = [];
    for (const item of media.slice(0, POSTS_TO_KEEP)) {
        const existing = stored.get(item.id);
        if (existing) {
            posts.push(toFeedPost(item, existing.split('.').pop()!));
            continue;
        }
        const url = pictureUrl(item);
        if (!url) continue;
        try {
            const picture = await downloadPicture(fetcher, url);
            if (!picture) continue;
            await bucket.put(`${IMAGE_PREFIX}${item.id}.${picture.extension}`, picture.bytes, {
                httpMetadata: { contentType: picture.contentType },
            });
            posts.push(toFeedPost(item, picture.extension));
        } catch (error) {
            console.warn(`[instagram] Skipped one picture: ${errorMessage(error)}`);
        }
    }

    // Pictures for posts that are no longer in the latest list are removed.
    const keep = new Set(posts.map((post) => `${IMAGE_PREFIX}${post.key}`));
    const stale = (await listKeys(bucket, IMAGE_PREFIX)).filter((key) => !keep.has(key));
    if (stale.length > 0) await bucket.delete(stale);
    return posts;
}

async function requestRebuild(hookUrl: string | undefined, fetcher: Fetcher): Promise<boolean> {
    if (!hookUrl) {
        console.warn('[instagram] DEPLOY_HOOK_URL is not set, so the website will only pick up new posts the next time it is rebuilt.');
        return false;
    }
    try {
        const response = await fetcher(hookUrl, { method: 'POST', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) console.error(`[instagram] The rebuild request was answered ${response.status}.`);
        return response.ok;
    } catch (error) {
        console.error('[instagram] The rebuild request failed:', errorMessage(error));
        return false;
    }
}

function alertEmail(problem: string): { subject: string; text: string; html: string } {
    const subject = 'Your website needs a quick Instagram reconnect';
    const text = [
        'Hi Nat,',
        '',
        "The website couldn't refresh your latest Instagram posts, so the Instagram photos on your site are staying as they are for now. Nothing is broken and visitors won't notice.",
        '',
        `What happened: ${problem}`,
        '',
        'To fix it, ask Matt to generate a new access token in the Meta developer dashboard and add it to the website. It takes about five minutes.',
    ].join('\n');
    const html = text
        .split('\n\n')
        .map((paragraph) => `<p>${paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`)
        .join('');
    return { subject, text, html };
}

/** Emails at most once every few days, and never throws. */
async function maybeAlert(env: SyncEnv, db: D1Database, fetcher: Fetcher, now: Date, problem: string): Promise<void> {
    const last = await readState<{ at: string }>(db, 'last_alert');
    if (last && now.getTime() - new Date(last.at).getTime() < ALERT_EVERY_DAYS * 24 * 60 * 60 * 1000) return;
    const { RESEND_API_KEY: apiKey, INQUIRY_TO: to, INQUIRY_FROM: from } = env;
    if (!apiKey || !to || !from) return;

    const result = await sendWithResend({
        apiKey,
        from,
        to,
        replyTo: to,
        email: alertEmail(problem),
        idempotencyKey: `instagram-alert-${now.toISOString().slice(0, 10)}`,
        fetcher,
    });
    if (result.ok) await writeState(db, 'last_alert', { at: now.toISOString() }, now);
    else console.error(`[instagram] The reconnect email could not be sent: ${result.error}`);
}

export async function syncInstagramFeed(env: SyncEnv, options: { now?: Date; fetcher?: Fetcher } = {}): Promise<SyncResult> {
    const now = options.now ?? new Date();
    const fetcher = options.fetcher ?? fetch;
    const { DB: db, INSTAGRAM_BUCKET: bucket } = env;

    if (!db || !bucket) {
        console.warn('[instagram] The D1 or R2 binding is missing, so nothing was synced.');
        return { status: 'not-configured', posts: 0, rebuildRequested: false, problem: null };
    }
    const saved = await readState<TokenState>(db, 'token');
    if (!saved && !env.INSTAGRAM_ACCESS_TOKEN) {
        console.info('[instagram] No access token yet, so the Instagram feed is switched off.');
        return { status: 'not-configured', posts: 0, rebuildRequested: false, problem: null };
    }

    let problem: string | null = null;
    let posts: FeedPost[] = [];
    let rebuildRequested = false;
    try {
        const { state, media } = await workingToken(env, db, fetcher, now);
        posts = await copyPictures(bucket, fetcher, media);

        const previous = await readManifest(bucket);
        if (manifestFingerprint(previous.posts) !== manifestFingerprint(posts) || previous.syncedAt === null) {
            const manifest: FeedManifest = { syncedAt: now.toISOString(), posts };
            await bucket.put(MANIFEST_KEY, JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
        }

        // The rebuild is requested until it succeeds once for this exact list, so a failed request is retried tomorrow.
        const fingerprint = manifestFingerprint(posts);
        const deployed = await readState<{ fingerprint: string }>(db, 'deployed');
        if (deployed?.fingerprint !== fingerprint) {
            rebuildRequested = await requestRebuild(env.DEPLOY_HOOK_URL, fetcher);
            if (rebuildRequested) await writeState(db, 'deployed', { fingerprint }, now);
        }

        if (tokenIsExpiringSoon(state, now)) {
            problem = `Your Instagram connection runs out in ${Math.max(daysUntilExpiry(state, now) ?? 0, 0)} days and could not be renewed automatically.`;
        }
    } catch (error) {
        problem = errorMessage(error);
        console.error(`[instagram] Sync failed: ${problem}`);
    }

    const status: SyncStatus = { at: now.toISOString(), ok: problem === null, problem, posts: posts.length };
    await writeState(db, 'last_sync', status, now);
    if (problem) await maybeAlert(env, db, fetcher, now, problem);

    return { status: problem ? 'failed' : 'ok', posts: posts.length, rebuildRequested, problem };
}
