// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { D1Database, D1Statement, R2Bucket } from '../../src/lib/cloudflare.ts';
import { MANIFEST_KEY, syncInstagramFeed, type SyncEnv } from '../../src/lib/instagram/sync.ts';

// ---- Fakes for D1, R2 and the network ----------------------------------------------------------

class FakeD1 {
    rows = new Map<string, string>();
    prepare(query: string): D1Statement {
        const rows = this.rows;
        let values: unknown[] = [];
        const statement: D1Statement = {
            bind(...next: unknown[]) {
                values = next;
                return statement;
            },
            async run() {
                if (/INSERT INTO instagram_state/.test(query)) rows.set(values[0] as string, values[1] as string);
                return {};
            },
            async first<T>() {
                const value = rows.get(values[0] as string);
                return (value === undefined ? null : { value }) as T | null;
            },
            async all<T>() {
                return { results: [] as T[] };
            },
        };
        return statement;
    }
    async batch() {
        return [];
    }
    state<T>(key: string): T | null {
        const value = this.rows.get(key);
        return value === undefined ? null : (JSON.parse(value) as T);
    }
}

class FakeR2 {
    objects = new Map<string, { data: ArrayBuffer | string; contentType?: string }>();
    async get(key: string) {
        const object = this.objects.get(key);
        if (!object) return null;
        return {
            body: new ReadableStream(),
            etag: 'x',
            httpMetadata: { contentType: object.contentType },
            text: async () => String(object.data),
        };
    }
    async put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }) {
        this.objects.set(key, { data: value, contentType: options?.httpMetadata?.contentType });
    }
    async delete(keys: string | string[]) {
        for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
    }
    async list(options?: { prefix?: string }) {
        const prefix = options?.prefix ?? '';
        return { objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    }
}

interface NetworkOptions {
    media?: unknown[];
    refresh?: { status: number; body: unknown };
    mediaStatus?: number;
    /** Tokens the pretend Instagram accepts. */
    validTokens?: string[];
}

function fakeNetwork(options: NetworkOptions = {}) {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    const validTokens = options.validTokens ?? ['seed-token', 'refreshed-token'];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

        if (url.startsWith('https://graph.instagram.com/refresh_access_token')) {
            const refresh = options.refresh ?? { status: 200, body: { access_token: 'refreshed-token', token_type: 'bearer', expires_in: 5_184_000 } };
            return json(refresh.status, refresh.body);
        }
        if (url.startsWith('https://graph.instagram.com/me/media')) {
            const token = new URL(url).searchParams.get('access_token') ?? '';
            if (!validTokens.includes(token)) return json(400, { error: { message: 'Invalid OAuth access token.' } });
            if (options.mediaStatus && options.mediaStatus !== 200) return json(options.mediaStatus, { error: { message: 'Server trouble' } });
            return json(200, { data: options.media ?? [] });
        }
        if (url.startsWith('https://api.resend.com/emails')) return json(200, { id: 'email-1' });
        if (url.startsWith('https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/')) return json(200, {});
        if (url.startsWith('https://cdn.example/')) {
            const isVideo = url.endsWith('.mp4');
            return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': isVideo ? 'video/mp4' : 'image/jpeg' } });
        }
        return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return { fetcher, calls };
}

function media(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        media_type: 'IMAGE',
        media_url: `https://cdn.example/${id}.jpg`,
        permalink: `https://www.instagram.com/p/code${id}/`,
        timestamp: `2026-06-${id.slice(-2).padStart(2, '0')}T10:00:00+0000`,
        caption: `Caption for post ${id} with a real sentence`,
        ...overrides,
    };
}

const HOOK = 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc';
const NOW = new Date('2026-06-20T09:17:00Z');

describe('syncInstagramFeed', () => {
    let db: FakeD1;
    let bucket: FakeR2;
    let env: SyncEnv;

    beforeEach(() => {
        db = new FakeD1();
        bucket = new FakeR2();
        env = {
            DB: db as unknown as D1Database,
            INSTAGRAM_BUCKET: bucket as unknown as R2Bucket,
            INSTAGRAM_ACCESS_TOKEN: 'seed-token',
            DEPLOY_HOOK_URL: HOOK,
            RESEND_API_KEY: 're_test',
            INQUIRY_TO: 'hello@curatedbynat.com',
            INQUIRY_FROM: 'Site <website@curatedbynat.com>',
        };
    });

    it('does nothing, quietly, until a token is set', async () => {
        const { fetcher, calls } = fakeNetwork();
        const result = await syncInstagramFeed({ ...env, INSTAGRAM_ACCESS_TOKEN: undefined }, { now: NOW, fetcher });
        assert.equal(result.status, 'not-configured');
        assert.equal(calls.length, 0);
    });

    it('copies new posts, saves the list, asks for a rebuild and keeps the refreshed token', async () => {
        const { fetcher, calls } = fakeNetwork({ media: [media('1001'), media('1002')] });
        const result = await syncInstagramFeed(env, { now: NOW, fetcher });

        assert.equal(result.status, 'ok');
        assert.equal(result.posts, 2);
        assert.equal(result.rebuildRequested, true);
        assert.ok(bucket.objects.has('img/1001.jpg') && bucket.objects.has('img/1002.jpg'));

        const manifest = JSON.parse(String(bucket.objects.get(MANIFEST_KEY)!.data));
        assert.deepEqual(manifest.posts.map((post: { key: string }) => post.key).sort(), ['1001.jpg', '1002.jpg']);
        assert.equal(manifest.posts[0].alt.includes('Caption for post'), true);

        assert.equal(db.state<{ token: string }>('token')!.token, 'refreshed-token');
        assert.equal(calls.filter((call) => call.url === HOOK).length, 1);
        assert.equal(db.state<{ ok: boolean }>('last_sync')!.ok, true);
    });

    it('does not download again or rebuild when nothing changed', async () => {
        const network = fakeNetwork({ media: [media('1001'), media('1002')] });
        await syncInstagramFeed(env, { now: NOW, fetcher: network.fetcher });
        const second = fakeNetwork({ media: [media('1001'), media('1002')] });
        const result = await syncInstagramFeed(env, { now: new Date(NOW.getTime() + 86_400_000), fetcher: second.fetcher });

        assert.equal(result.rebuildRequested, false);
        assert.equal(second.calls.filter((call) => call.url.startsWith('https://cdn.example/')).length, 0);
        assert.equal(second.calls.filter((call) => call.url === HOOK).length, 0);
        // The saved token is only a day old, so it is not refreshed again yet.
        assert.equal(second.calls.filter((call) => call.url.startsWith('https://graph.instagram.com/refresh_access_token')).length, 0);
    });

    it('rebuilds when a new post appears and removes pictures for posts that dropped off', async () => {
        await syncInstagramFeed(env, { now: NOW, fetcher: fakeNetwork({ media: [media('1001'), media('1002')] }).fetcher });
        const next = fakeNetwork({ media: [media('1003'), media('1001')] });
        const result = await syncInstagramFeed(env, { now: new Date(NOW.getTime() + 86_400_000), fetcher: next.fetcher });

        assert.equal(result.rebuildRequested, true);
        assert.deepEqual([...bucket.objects.keys()].filter((key) => key.startsWith('img/')).sort(), ['img/1001.jpg', 'img/1003.jpg']);
    });

    it('skips a carousel whose first item is a video', async () => {
        const { fetcher } = fakeNetwork({ media: [media('1001'), media('1002', { media_type: 'CAROUSEL_ALBUM', media_url: 'https://cdn.example/1002.mp4' })] });
        const result = await syncInstagramFeed(env, { now: NOW, fetcher });
        assert.equal(result.posts, 1);
        assert.equal(bucket.objects.has('img/1002.jpg'), false);
    });

    it('still reads posts when a brand new token is too young to refresh', async () => {
        const { fetcher } = fakeNetwork({
            media: [media('1001')],
            refresh: { status: 400, body: { error: { message: 'Token must be at least 24 hours old' } } },
        });
        const result = await syncInstagramFeed(env, { now: NOW, fetcher });
        assert.equal(result.status, 'ok');
        assert.equal(db.state<{ token: string }>('token')!.token, 'seed-token');
    });

    it('switches to a newly generated token when the saved one has expired', async () => {
        db.rows.set('token', JSON.stringify({ token: 'expired-token', refreshedAt: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(), expiresAt: null }));
        const { fetcher } = fakeNetwork({ media: [media('1001')] });
        const result = await syncInstagramFeed(env, { now: NOW, fetcher });
        assert.equal(result.status, 'ok');
        assert.equal(db.state<{ token: string }>('token')!.token, 'refreshed-token');
    });

    it('reports a failure, leaves the saved list alone and emails once every few days', async () => {
        await syncInstagramFeed(env, { now: NOW, fetcher: fakeNetwork({ media: [media('1001')] }).fetcher });
        const savedList = String(bucket.objects.get(MANIFEST_KEY)!.data);

        const broken = fakeNetwork({ validTokens: [] });
        const later = new Date(NOW.getTime() + 2 * 86_400_000);
        const result = await syncInstagramFeed(env, { now: later, fetcher: broken.fetcher });
        assert.equal(result.status, 'failed');
        assert.equal(String(bucket.objects.get(MANIFEST_KEY)!.data), savedList);
        assert.equal(broken.calls.filter((call) => call.url.startsWith('https://api.resend.com/')).length, 1);
        assert.equal(db.state<{ ok: boolean }>('last_sync')!.ok, false);

        const again = fakeNetwork({ validTokens: [] });
        await syncInstagramFeed(env, { now: new Date(later.getTime() + 86_400_000), fetcher: again.fetcher });
        assert.equal(again.calls.filter((call) => call.url.startsWith('https://api.resend.com/')).length, 0);
    });

    it('retries the rebuild request tomorrow when it failed today', async () => {
        const failingHook = fakeNetwork({ media: [media('1001')] });
        const original = failingHook.fetcher;
        const flaky = (async (input: string | URL | Request, init?: RequestInit) =>
            String(input) === HOOK ? new Response('no', { status: 500 }) : original(input, init)) as typeof fetch;
        const first = await syncInstagramFeed(env, { now: NOW, fetcher: flaky });
        assert.equal(first.rebuildRequested, false);

        const second = await syncInstagramFeed(env, { now: new Date(NOW.getTime() + 86_400_000), fetcher: fakeNetwork({ media: [media('1001')] }).fetcher });
        assert.equal(second.rebuildRequested, true);
    });

    it('never puts the access token in the alert email', async () => {
        const network = fakeNetwork({ validTokens: [] });
        let emailBody = '';
        const spy = (async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input).startsWith('https://api.resend.com/')) emailBody = String(init?.body);
            return network.fetcher(input, init);
        }) as typeof fetch;
        await syncInstagramFeed(env, { now: NOW, fetcher: spy });
        assert.ok(emailBody.length > 0);
        assert.equal(emailBody.includes('seed-token'), false);
    });
});
