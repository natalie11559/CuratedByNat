// Decides whether a request may reach Studio. Used by src/middleware.ts for every /studio and /api/studio
// request. Fails closed: any doubt means "no", and "no" is always a plain 404.
import {
    createKeyLoader,
    parseAllowedEmails,
    verifyAccessToken,
    type KeyLoader,
} from './access.ts';

/** Bindings Studio reads. All are set in the Cloudflare dashboard or with `wrangler secret put`, never committed. */
export interface StudioEnv {
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    /** Comma-separated. A secret, so personal email addresses are not in the public repository. */
    STUDIO_ALLOWED_EMAILS?: string;
    /** Development only: "1" skips Access on localhost. */
    STUDIO_DEV_BYPASS?: string;
    STUDIO_DEV_EMAIL?: string;
}

export const ACCESS_TOKEN_HEADER = 'cf-access-jwt-assertion';

/**
 * True for /studio, /api/studio and anything below them, in any letter case and however the slashes are
 * written. Matching more than needed is safe: a path that is not Studio but looks like it simply gets a 404.
 */
export function isStudioPath(pathname: string): boolean {
    let decoded = pathname;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        // An undecodable path is treated as it is.
    }
    const normalized = decoded.toLowerCase().replace(/\/{2,}/g, '/');
    return normalized.startsWith('/studio') || normalized.startsWith('/api/studio');
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The development shortcut works only when ALL of these hold: it was switched on explicitly, the request is to
 * localhost, and the code is a development build. Production is a different build and a different host, so a
 * stray variable there changes nothing.
 */
export function isDevBypassAllowed(input: { flag: string | undefined; hostname: string; isDevBuild: boolean }): boolean {
    return input.isDevBuild === true && input.flag === '1' && LOCAL_HOSTNAMES.has(input.hostname.toLowerCase());
}

export type StudioAuthorization = { ok: true; email: string; via: 'access' | 'dev-bypass' } | { ok: false; reason: string };

let sharedKeyLoader: KeyLoader | null = null;

export async function authorizeStudioRequest(input: {
    headers: Headers;
    hostname: string;
    isDevBuild: boolean;
    env: StudioEnv;
    nowSeconds?: number;
    loadKeys?: KeyLoader;
}): Promise<StudioAuthorization> {
    const { env } = input;

    if (isDevBypassAllowed({ flag: env.STUDIO_DEV_BYPASS, hostname: input.hostname, isDevBuild: input.isDevBuild })) {
        return { ok: true, email: (env.STUDIO_DEV_EMAIL || 'dev@localhost').toLowerCase(), via: 'dev-bypass' };
    }

    sharedKeyLoader ??= createKeyLoader();
    const result = await verifyAccessToken(
        input.headers.get(ACCESS_TOKEN_HEADER),
        {
            teamDomain: (env.ACCESS_TEAM_DOMAIN ?? '').trim().toLowerCase(),
            audience: (env.ACCESS_AUD ?? '').trim(),
            allowedEmails: parseAllowedEmails(env.STUDIO_ALLOWED_EMAILS),
        },
        { nowSeconds: input.nowSeconds ?? Math.floor(Date.now() / 1000), loadKeys: input.loadKeys ?? sharedKeyLoader },
    );
    return result.ok ? { ok: true, email: result.email, via: 'access' } : { ok: false, reason: result.reason };
}

/** Headers on every Studio response. Nothing here may be cached by a browser, a proxy or a search engine. */
export function studioHeaders(options: { isDevBuild: boolean }): Record<string, string> {
    const connect = options.isDevBuild ? "'self' ws: wss:" : "'self'";
    return {
        'Cache-Control': 'no-store, private',
        'X-Robots-Tag': 'noindex, nofollow',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': [
            "default-src 'none'",
            "script-src 'self'",
            "style-src 'self'",
            "img-src 'self' data:",
            "font-src 'self'",
            `connect-src ${connect}`,
            "manifest-src 'self'",
            "form-action 'self'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
            "object-src 'none'",
        ].join('; '),
    };
}
