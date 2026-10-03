// Pure helpers for the Instagram feed: reading the API's answer, cleaning captions into alt text,
// choosing which posts to show, and deciding when the access token needs attention.
// No Cloudflare imports, so `npm run test:unit` can run these.

export type MediaType = 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';

/** One item from `GET /me/media`. */
export interface RawMedia {
    id: string;
    media_type: MediaType;
    media_url?: string;
    thumbnail_url?: string;
    permalink: string;
    timestamp: string;
    caption?: string;
}

/** What the website keeps about a post. The caption itself is not stored, only the cleaned alt text. */
export interface FeedPost {
    id: string;
    /** File name in the bucket and in the build, for example "1789.jpg". */
    key: string;
    permalink: string;
    timestamp: string;
    /** True when the picture is the cover frame of a Reel or video. */
    isVideoCover: boolean;
    alt: string;
}

export interface FeedManifest {
    syncedAt: string | null;
    posts: FeedPost[];
}

export const EMPTY_MANIFEST: FeedManifest = { syncedAt: null, posts: [] };

export const FALLBACK_ALT = "Photo from Nat's Instagram";
const MAX_ALT_LENGTH = 110;
const MIN_ALT_LENGTH = 8;

/** The public pictures Nat's page shows. A video's cover frame is used for videos and Reels. */
export function pictureUrl(media: RawMedia): string | null {
    const url = media.media_type === 'VIDEO' ? media.thumbnail_url : media.media_url;
    return url && /^https:\/\//.test(url) ? url : null;
}

/** Image types the site can process. Anything else (for example a carousel that starts with a video) is skipped. */
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function extensionForContentType(contentType: string | null): string | null {
    const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    return EXTENSIONS[type] ?? null;
}

/** Words that mean a caption is talking about money. The site never shows prices, so such captions are not used. */
const PRICE_TALK = /\$|\busd\b|\bprices?\b|\bpricing\b|\brates?\b|\bpackages?\s+(?:start|from)|\bbook(?:ing)?\s+(?:now|today|your)/i;

/**
 * Turns a caption into one short sentence for screen readers: no hashtags, mentions, links or emoji,
 * and nothing at all if the caption mentions prices.
 */
export function altTextFromCaption(caption: string | null | undefined): string {
    if (!caption) return FALLBACK_ALT;
    if (PRICE_TALK.test(caption)) return FALLBACK_ALT;

    // Emoji and line breaks end a sentence just like a full stop does.
    const segments = caption
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/[#@][\p{L}\p{N}_.]+/gu, ' ')
        .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '\n')
        .split(/\n|(?<=[.!?])\s/)
        .map((segment) => segment.replace(/\s+/g, ' ').replace(/[\s.!?,;:|-]+$/, '').trim())
        .filter((segment) => /\p{L}{3,}/u.test(segment));

    const sentence = segments[0] ?? '';
    if (sentence.length < MIN_ALT_LENGTH || !/\p{L}{3,}/u.test(sentence)) return FALLBACK_ALT;
    if (sentence.length <= MAX_ALT_LENGTH) return sentence;

    const cut = sentence.slice(0, MAX_ALT_LENGTH);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:|-]+$/, '')}…`;
}

/** "https://www.instagram.com/reel/Cx12_ab/" gives "Cx12_ab". */
export function shortcodeFromPermalink(permalink: string): string | null {
    return /instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(permalink)?.[1] ?? null;
}

/** Turns what the API returned (plus the file extension found after downloading) into a stored post. */
export function toFeedPost(media: RawMedia, extension: string): FeedPost {
    return {
        id: media.id,
        key: `${media.id}.${extension}`,
        permalink: media.permalink,
        timestamp: media.timestamp,
        isVideoCover: media.media_type === 'VIDEO',
        alt: altTextFromCaption(media.caption),
    };
}

/** A fingerprint of everything the pages show, so the site is only rebuilt when something changed. */
export function manifestFingerprint(posts: readonly FeedPost[]): string {
    return posts.map((post) => `${post.key}|${post.permalink}|${post.alt}|${post.isVideoCover ? 'v' : 'p'}`).join('\n');
}

export interface SelectionOptions {
    count: number;
    includeVideoCovers: boolean;
    /** Post links Nat pasted into "Hide a post". */
    hiddenLinks: readonly string[];
}

/** The newest posts that pass Nat's choices, or an empty list when there are not enough to fill the section. */
export function selectPosts(posts: readonly FeedPost[], options: SelectionOptions & { minimum?: number }): FeedPost[] {
    const hiddenCodes = new Set(options.hiddenLinks.map((link) => shortcodeFromPermalink(link)).filter((code): code is string => Boolean(code)));
    const chosen = [...posts]
        .filter((post) => options.includeVideoCovers || !post.isVideoCover)
        .filter((post) => {
            const code = shortcodeFromPermalink(post.permalink);
            return !code || !hiddenCodes.has(code);
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, options.count);
    return chosen.length >= (options.minimum ?? options.count) ? chosen : [];
}

// ---- Access token ---------------------------------------------------------------------------------

export interface TokenState {
    token: string;
    /** ISO time of the last successful refresh; null for a token that has only been seeded. */
    refreshedAt: string | null;
    /** ISO time the token stops working, when known. */
    expiresAt: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
export const REFRESH_AFTER_DAYS = 7;
export const WARN_BEFORE_EXPIRY_DAYS = 10;

/** Meta only refreshes tokens older than 24 hours; refreshing weekly keeps the 60-day lifetime far away. */
export function tokenNeedsRefresh(state: TokenState, now: Date): boolean {
    if (!state.refreshedAt) return true;
    return now.getTime() - new Date(state.refreshedAt).getTime() >= REFRESH_AFTER_DAYS * DAY;
}

export function daysUntilExpiry(state: TokenState, now: Date): number | null {
    if (!state.expiresAt) return null;
    return Math.floor((new Date(state.expiresAt).getTime() - now.getTime()) / DAY);
}

export function tokenIsExpiringSoon(state: TokenState, now: Date): boolean {
    const days = daysUntilExpiry(state, now);
    return days !== null && days < WARN_BEFORE_EXPIRY_DAYS;
}
