// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AccessKey, KeyLoader } from '../../src/lib/studio/access.ts';
import {
    authorizeStudioRequest,
    isDevBypassAllowed,
    isStudioPath,
    studioHeaders,
    type StudioEnv,
} from '../../src/lib/studio/gate.ts';

describe('isStudioPath', () => {
    it('matches Studio pages and API routes however they are written', () => {
        for (const path of ['/studio', '/studio/', '/studio/pipeline', '/api/studio', '/api/studio/leads', '/Studio', '/STUDIO/x', '//studio', '/%73tudio', '/api//studio/x', '/studios']) {
            assert.equal(isStudioPath(path), true, path);
        }
    });

    it('leaves the public site alone', () => {
        for (const path of ['/', '/about', '/inquire', '/api/inquiry', '/api/instagram/feed', '/keystatic', '/cal/abc.ics', '/_astro/x.js']) {
            assert.equal(isStudioPath(path), false, path);
        }
    });

    it('does not throw on a broken escape', () => {
        assert.equal(isStudioPath('/studio/%E0%A4%A'), true);
        assert.equal(isStudioPath('/%E0%A4%A'), false);
    });
});

describe('isDevBypassAllowed', () => {
    const allowed = { flag: '1', hostname: 'localhost', isDevBuild: true };

    it('is on only for an explicit flag, on localhost, in a development build', () => {
        assert.equal(isDevBypassAllowed(allowed), true);
        assert.equal(isDevBypassAllowed({ ...allowed, hostname: '127.0.0.1' }), true);
        assert.equal(isDevBypassAllowed({ ...allowed, hostname: '[::1]' }), true);
    });

    it('is ignored in a production build, whatever else is set', () => {
        assert.equal(isDevBypassAllowed({ ...allowed, isDevBuild: false }), false);
        assert.equal(isDevBypassAllowed({ flag: '1', hostname: 'curatedbynat.com', isDevBuild: false }), false);
    });

    it('is ignored on any other host, even in a development build', () => {
        for (const hostname of ['curatedbynat.com', 'curatedbynat.workers.dev', 'localhost.evil.com', 'evil.com', '']) {
            assert.equal(isDevBypassAllowed({ ...allowed, hostname }), false, hostname);
        }
    });

    it('needs the flag to be exactly "1"', () => {
        for (const flag of [undefined, '', '0', 'true', 'yes', ' 1']) {
            assert.equal(isDevBypassAllowed({ ...allowed, flag }), false, String(flag));
        }
    });
});

describe('authorizeStudioRequest', () => {
    const base: StudioEnv = {
        ACCESS_TEAM_DOMAIN: 'curatedbynat.cloudflareaccess.com',
        ACCESS_AUD: 'a'.repeat(64),
        STUDIO_ALLOWED_EMAILS: 'hello@curatedbynat.com,matt.truj7@gmail.com',
    };
    const NOW = 1_800_000_000;

    async function signedToken(overrides: Record<string, unknown> = {}) {
        const pair = await crypto.subtle.generateKey(
            { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
            true,
            ['sign', 'verify'],
        );
        const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as { n: string; e: string };
        const key: AccessKey = { kid: 'k', kty: 'RSA', n: jwk.n, e: jwk.e };
        const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const input = `${part({ alg: 'RS256', kid: 'k' })}.${part({
            iss: 'https://curatedbynat.cloudflareaccess.com',
            aud: ['a'.repeat(64)],
            email: 'hello@curatedbynat.com',
            exp: NOW + 600,
            ...overrides,
        })}`;
        const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input));
        const loadKeys: KeyLoader = async () => [key];
        return { token: `${input}.${Buffer.from(signature).toString('base64url')}`, loadKeys };
    }

    it('lets a valid Access token through', async () => {
        const { token, loadKeys } = await signedToken();
        const result = await authorizeStudioRequest({
            headers: new Headers({ 'Cf-Access-Jwt-Assertion': token }),
            hostname: 'curatedbynat.com',
            isDevBuild: false,
            env: base,
            nowSeconds: NOW,
            loadKeys,
        });
        assert.deepEqual(result, { ok: true, email: 'hello@curatedbynat.com', via: 'access' });
    });

    it('refuses everything when Access is not configured, even with a perfect token', async () => {
        const { token, loadKeys } = await signedToken();
        const result = await authorizeStudioRequest({
            headers: new Headers({ 'Cf-Access-Jwt-Assertion': token }),
            hostname: 'curatedbynat.com',
            isDevBuild: false,
            env: {},
            nowSeconds: NOW,
            loadKeys,
        });
        assert.equal(result.ok, false);
    });

    it('refuses a request with no token', async () => {
        const result = await authorizeStudioRequest({ headers: new Headers(), hostname: 'curatedbynat.com', isDevBuild: false, env: base, nowSeconds: NOW });
        assert.deepEqual(result, { ok: false, reason: 'missing-token' });
    });

    it('lets the development bypass in on localhost only', async () => {
        const env = { ...base, STUDIO_DEV_BYPASS: '1', STUDIO_DEV_EMAIL: 'Dev@Localhost' };
        const local = await authorizeStudioRequest({ headers: new Headers(), hostname: 'localhost', isDevBuild: true, env });
        assert.deepEqual(local, { ok: true, email: 'dev@localhost', via: 'dev-bypass' });
    });

    it('ignores the bypass flag in production: no token means no entry', async () => {
        const env = { ...base, STUDIO_DEV_BYPASS: '1' };
        for (const input of [
            { hostname: 'curatedbynat.com', isDevBuild: false },
            { hostname: 'localhost', isDevBuild: false },
            { hostname: 'curatedbynat.com', isDevBuild: true },
        ]) {
            const result = await authorizeStudioRequest({ headers: new Headers(), env, ...input });
            assert.equal(result.ok, false, JSON.stringify(input));
        }
    });
});

describe('studioHeaders', () => {
    it('forbids caching, indexing, framing and third-party scripts', () => {
        const headers = studioHeaders({ isDevBuild: false });
        assert.equal(headers['Cache-Control'], 'no-store, private');
        assert.equal(headers['X-Robots-Tag'], 'noindex, nofollow');
        assert.equal(headers['X-Frame-Options'], 'DENY');
        const csp = headers['Content-Security-Policy']!;
        assert.match(csp, /default-src 'none'/);
        assert.match(csp, /script-src 'self'(;|$)/);
        assert.match(csp, /frame-ancestors 'none'/);
        assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
        assert.doesNotMatch(csp, /ws:/);
    });

    it('allows the development server socket only in development', () => {
        assert.match(studioHeaders({ isDevBuild: true })['Content-Security-Policy']!, /connect-src 'self' ws: wss:/);
    });
});

describe('firstNameFromEmail', () => {
    it('knows Nat and falls back to the first word of the address', async () => {
        const { firstNameFromEmail } = await import('../../src/lib/studio/people.ts');
        assert.equal(firstNameFromEmail('hello@curatedbynat.com'), 'Nat');
        assert.equal(firstNameFromEmail('Matt.Truj7@gmail.com'), 'Matt');
        assert.equal(firstNameFromEmail('@x.com'), 'there');
    });
});
