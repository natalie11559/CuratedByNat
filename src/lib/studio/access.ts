// Verifies the sign-in token Cloudflare Access attaches to every request it lets through
// (the `Cf-Access-Jwt-Assertion` header). Studio checks it again inside the Worker, so a mistake in the
// Access settings can never expose client data. Web Crypto only; no dependencies.
// Pure apart from the key download, so `npm run test:unit` covers it.

export interface AccessConfig {
    /** For example "curatedbynat.cloudflareaccess.com". */
    teamDomain: string;
    /** The "Application Audience (AUD) tag" of the Access application. */
    audience: string;
    /** Lowercase email addresses that may use Studio. */
    allowedEmails: readonly string[];
}

export interface AccessKey {
    kid: string;
    kty: string;
    n: string;
    e: string;
    alg?: string;
}

export type AccessResult = { ok: true; email: string } | { ok: false; reason: string };

/** Returns the team's public keys. `refresh` asks for a fresh copy because a token used an unknown key id. */
export type KeyLoader = (teamDomain: string, options: { refresh: boolean }) => Promise<AccessKey[]>;

const MAX_TOKEN_LENGTH = 8 * 1024;
const TEAM_DOMAIN_PATTERN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

export function isValidTeamDomain(teamDomain: string): boolean {
    return TEAM_DOMAIN_PATTERN.test(teamDomain);
}

/** "A@x.com, b@y.com" gives ["a@x.com", "b@y.com"]. Anything that is not an email address is dropped. */
export function parseAllowedEmails(value: string | undefined): string[] {
    return (value ?? '')
        .split(/[\s,;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry));
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function decodeJson(value: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

const importedKeys = new Map<string, Promise<CryptoKey>>();

function importKey(key: AccessKey): Promise<CryptoKey> {
    const cacheKey = `${key.kid}:${key.n.slice(0, 32)}`;
    let imported = importedKeys.get(cacheKey);
    if (!imported) {
        imported = crypto.subtle.importKey(
            'jwk',
            { kty: 'RSA', n: key.n, e: key.e, alg: 'RS256', ext: true },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify'],
        );
        importedKeys.set(cacheKey, imported);
    }
    return imported;
}

async function findKey(kid: string, teamDomain: string, loadKeys: KeyLoader): Promise<AccessKey | null> {
    for (const refresh of [false, true]) {
        const keys = await loadKeys(teamDomain, { refresh });
        const match = keys.find((key) => key.kid === kid && key.kty === 'RSA');
        if (match) return match;
    }
    return null;
}

function audienceMatches(claim: unknown, audience: string): boolean {
    if (typeof claim === 'string') return claim === audience;
    return Array.isArray(claim) && claim.includes(audience);
}

/** Checks signature, issuer, audience, expiry and that the email is on the allowlist. Never throws. */
export async function verifyAccessToken(
    token: string | null | undefined,
    config: AccessConfig,
    options: { nowSeconds: number; loadKeys: KeyLoader },
): Promise<AccessResult> {
    const fail = (reason: string): AccessResult => ({ ok: false, reason });
    try {
        if (!token) return fail('missing-token');
        if (token.length > MAX_TOKEN_LENGTH) return fail('token-too-long');
        if (!isValidTeamDomain(config.teamDomain) || !config.audience || config.allowedEmails.length === 0) {
            return fail('not-configured');
        }

        const parts = token.split('.');
        if (parts.length !== 3) return fail('malformed');
        const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
        const header = decodeJson(encodedHeader);
        const payload = decodeJson(encodedPayload);
        if (!header || !payload) return fail('malformed');
        if (header.alg !== 'RS256' || typeof header.kid !== 'string') return fail('bad-algorithm');

        const key = await findKey(header.kid, config.teamDomain, options.loadKeys);
        if (!key) return fail('unknown-key');

        const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
        const valid = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            await importKey(key),
            base64UrlToBytes(encodedSignature),
            signed,
        );
        if (!valid) return fail('bad-signature');

        if (payload.iss !== `https://${config.teamDomain}`) return fail('wrong-issuer');
        if (!audienceMatches(payload.aud, config.audience)) return fail('wrong-audience');
        if (typeof payload.exp !== 'number' || payload.exp <= options.nowSeconds) return fail('expired');
        if (typeof payload.nbf === 'number' && payload.nbf > options.nowSeconds) return fail('not-yet-valid');

        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
        if (!email || !config.allowedEmails.includes(email)) return fail('email-not-allowed');
        return { ok: true, email };
    } catch {
        return fail('error');
    }
}

// ---- Downloading the team's public keys ------------------------------------------------------------

const KEY_LIFETIME_MS = 60 * 60 * 1000;
const MIN_REFRESH_GAP_MS = 60 * 1000;

interface KeyCache {
    keys: AccessKey[];
    loadedAt: number;
}
const keyCache = new Map<string, KeyCache>();

/** Keeps the keys for an hour, and refetches early (at most once a minute) when a token names a key we lack. */
export function createKeyLoader(fetcher: typeof fetch = fetch, now: () => number = Date.now): KeyLoader {
    return async (teamDomain, { refresh }) => {
        if (!isValidTeamDomain(teamDomain)) return [];
        const cached = keyCache.get(teamDomain);
        const age = cached ? now() - cached.loadedAt : Infinity;
        if (cached && age < KEY_LIFETIME_MS && (!refresh || age < MIN_REFRESH_GAP_MS)) return cached.keys;

        try {
            const response = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(8000) });
            if (!response.ok) throw new Error(`certs responded ${response.status}`);
            const body = (await response.json()) as { keys?: AccessKey[] };
            const keys = (body.keys ?? []).filter((key) => typeof key.kid === 'string' && typeof key.n === 'string' && typeof key.e === 'string');
            keyCache.set(teamDomain, { keys, loadedAt: now() });
            return keys;
        } catch {
            // Keep using older keys if the download fails; they only get replaced when they rotate.
            return cached?.keys ?? [];
        }
    };
}
