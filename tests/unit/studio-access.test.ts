// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createKeyLoader,
    isValidTeamDomain,
    parseAllowedEmails,
    verifyAccessToken,
    type AccessConfig,
    type AccessKey,
    type KeyLoader,
} from '../../src/lib/studio/access.ts';

const TEAM = 'curatedbynat.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const NAT = 'hello@curatedbynat.com';
const NOW = 1_800_000_000;

const config: AccessConfig = { teamDomain: TEAM, audience: AUD, allowedEmails: [NAT, 'matt.truj7@gmail.com'] };

function encode(value: unknown): string {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
    return Buffer.from(bytes).toString('base64url');
}

async function makeKeyPair(kid: string) {
    const pair = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
    );
    const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as { n: string; e: string };
    const publicKey: AccessKey = { kid, kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256' };
    return { privateKey: pair.privateKey, publicKey };
}

async function sign(privateKey: CryptoKey, payload: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
    const signingInput = `${encode({ alg: 'RS256', kid: 'key-1', typ: 'JWT', ...header })}.${encode(payload)}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signingInput));
    return `${signingInput}.${encode(new Uint8Array(signature))}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { iss: `https://${TEAM}`, aud: [AUD], email: NAT, exp: NOW + 3600, iat: NOW - 60, ...overrides };
}

const keysOf = (...keys: AccessKey[]): KeyLoader => async () => keys;

describe('verifyAccessToken', () => {
    it('accepts a valid token for an allowed email', async () => {
        const { privateKey, publicKey } = await makeKeyPair('key-1');
        const token = await sign(privateKey, claims());
        const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys: keysOf(publicKey) });
        assert.deepEqual(result, { ok: true, email: NAT });
    });

    it('treats the email case-insensitively and accepts a string audience', async () => {
        const { privateKey, publicKey } = await makeKeyPair('key-1');
        const token = await sign(privateKey, claims({ email: 'Hello@CuratedByNat.com', aud: AUD }));
        const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys: keysOf(publicKey) });
        assert.deepEqual(result, { ok: true, email: NAT });
    });

    it('rejects a missing token', async () => {
        const result = await verifyAccessToken(null, config, { nowSeconds: NOW, loadKeys: keysOf() });
        assert.deepEqual(result, { ok: false, reason: 'missing-token' });
    });

    it('rejects an expired token', async () => {
        const { privateKey, publicKey } = await makeKeyPair('key-1');
        const token = await sign(privateKey, claims({ exp: NOW - 1 }));
        const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys: keysOf(publicKey) });
        assert.deepEqual(result, { ok: false, reason: 'expired' });
    });

    it('rejects a token for another application (wrong audience)', async () => {
        const { privateKey, publicKey } = await makeKeyPair('key-1');
        const token = await sign(privateKey, claims({ aud: ['b'.repeat(64)] }));
        const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys: keysOf(publicKey) });
        assert.deepEqual(result, { ok: false, reason: 'wrong-audience' });
    });

    it('rejects a signed-in person who is not on the allowlist', async () => {
        const { privateKey, publicKey } = await makeKeyPair('key-1');
        const token = await sign(privateKey, claims({ email: 'someone@else.com' }));
        const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys: keysOf(publicKey) });
        assert.deepEqual(result, { ok: false, reason: 'email-not-allowed' });
    });

    it('rejects another team as issuer', async () => {
        const { privateKey, publicKey } = await makeKeyPair('key-1');
        const token = await sign(privateKey, claims({ iss: 'https://evil.cloudflareaccess.com' }));
        const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys: keysOf(publicKey) });
        assert.deepEqual(result, { ok: false, reason: 'wrong-issuer' });
    });

    it('rejects a token signed with a different key', async () => {
        const real = await makeKeyPair('key-1');
        const attacker = await makeKeyPair('key-1');
        const token = await sign(attacker.privateKey, claims());
        const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys: keysOf(real.publicKey) });
        assert.deepEqual(result, { ok: false, reason: 'bad-signature' });
    });

    it('rejects a token whose contents were changed after signing', async () => {
        const { privateKey, publicKey } = await makeKeyPair('key-1');
        const token = await sign(privateKey, claims({ email: 'someone@else.com' }));
        const [header, , signature] = token.split('.');
        const forged = `${header}.${encode(claims())}.${signature}`;
        const result = await verifyAccessToken(forged, config, { nowSeconds: NOW, loadKeys: keysOf(publicKey) });
        assert.deepEqual(result, { ok: false, reason: 'bad-signature' });
    });

    it('rejects unsigned and symmetric-algorithm tokens', async () => {
        const { publicKey } = await makeKeyPair('key-1');
        for (const alg of ['none', 'HS256']) {
            const token = `${encode({ alg, kid: 'key-1' })}.${encode(claims())}.`;
            const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys: keysOf(publicKey) });
            assert.deepEqual(result, { ok: false, reason: 'bad-algorithm' });
        }
    });

    it('rejects garbage', async () => {
        for (const token of ['x', 'a.b', 'a.b.c', '....', 'é.é.é']) {
            const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys: keysOf() });
            assert.equal(result.ok, false);
        }
    });

    it('rejects a token that is not valid yet', async () => {
        const { privateKey, publicKey } = await makeKeyPair('key-1');
        const token = await sign(privateKey, claims({ nbf: NOW + 600 }));
        const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys: keysOf(publicKey) });
        assert.deepEqual(result, { ok: false, reason: 'not-yet-valid' });
    });

    it('refuses to run with missing or invalid settings', async () => {
        const { privateKey, publicKey } = await makeKeyPair('key-1');
        const token = await sign(privateKey, claims());
        const attempts: AccessConfig[] = [
            { ...config, allowedEmails: [] },
            { ...config, audience: '' },
            { ...config, teamDomain: 'evil.example.com' },
            { ...config, teamDomain: '' },
        ];
        for (const attempt of attempts) {
            const result = await verifyAccessToken(token, attempt, { nowSeconds: NOW, loadKeys: keysOf(publicKey) });
            assert.deepEqual(result, { ok: false, reason: 'not-configured' });
        }
    });

    it('fetches the keys again once when a token names a key it has not seen (key rotation)', async () => {
        const oldKey = await makeKeyPair('old');
        const newKey = await makeKeyPair('new');
        const requests: boolean[] = [];
        const loadKeys: KeyLoader = async (_team, { refresh }) => {
            requests.push(refresh);
            return refresh ? [oldKey.publicKey, newKey.publicKey] : [oldKey.publicKey];
        };
        const token = await sign(newKey.privateKey, claims(), { kid: 'new' });
        const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys });
        assert.deepEqual(result, { ok: true, email: NAT });
        assert.deepEqual(requests, [false, true]);
    });

    it('does not fetch endlessly for a key that never appears', async () => {
        const { privateKey } = await makeKeyPair('ghost');
        const requests: boolean[] = [];
        const loadKeys: KeyLoader = async (_team, { refresh }) => {
            requests.push(refresh);
            return [];
        };
        const token = await sign(privateKey, claims(), { kid: 'ghost' });
        const result = await verifyAccessToken(token, config, { nowSeconds: NOW, loadKeys });
        assert.deepEqual(result, { ok: false, reason: 'unknown-key' });
        assert.equal(requests.length, 2);
    });
});

describe('parseAllowedEmails and isValidTeamDomain', () => {
    it('splits, lowercases and drops anything that is not an email', () => {
        assert.deepEqual(parseAllowedEmails(' Hello@CuratedByNat.com, matt.truj7@gmail.com ;junk, '), [
            'hello@curatedbynat.com',
            'matt.truj7@gmail.com',
        ]);
        assert.deepEqual(parseAllowedEmails(undefined), []);
    });

    it('only accepts Cloudflare Access team domains', () => {
        assert.equal(isValidTeamDomain('curatedbynat.cloudflareaccess.com'), true);
        assert.equal(isValidTeamDomain('curatedbynat.cloudflareaccess.com.evil.com'), false);
        assert.equal(isValidTeamDomain('evil.com/x.cloudflareaccess.com'), false);
        assert.equal(isValidTeamDomain(''), false);
    });
});

describe('createKeyLoader', () => {
    function loaderWith(responses: Array<{ status: number; body: unknown }>) {
        let clock = 0;
        let calls = 0;
        const fetcher = (async () => {
            const next = responses[Math.min(calls, responses.length - 1)]!;
            calls += 1;
            return new Response(JSON.stringify(next.body), { status: next.status });
        }) as typeof fetch;
        const loader = createKeyLoader(fetcher, () => clock);
        return { loader, advance: (ms: number) => (clock += ms), calls: () => calls };
    }
    const key = (kid: string) => ({ kid, kty: 'RSA', n: 'n', e: 'AQAB' });

    it('caches for an hour', async () => {
        const { loader, advance, calls } = loaderWith([{ status: 200, body: { keys: [key('a')] } }]);
        await loader('cache-test-1.cloudflareaccess.com', { refresh: false });
        advance(30 * 60 * 1000);
        await loader('cache-test-1.cloudflareaccess.com', { refresh: false });
        assert.equal(calls(), 1);
        advance(31 * 60 * 1000);
        await loader('cache-test-1.cloudflareaccess.com', { refresh: false });
        assert.equal(calls(), 2);
    });

    it('limits forced refreshes to one a minute', async () => {
        const { loader, advance, calls } = loaderWith([{ status: 200, body: { keys: [key('a')] } }]);
        await loader('cache-test-2.cloudflareaccess.com', { refresh: true });
        await loader('cache-test-2.cloudflareaccess.com', { refresh: true });
        assert.equal(calls(), 1);
        advance(61 * 1000);
        await loader('cache-test-2.cloudflareaccess.com', { refresh: true });
        assert.equal(calls(), 2);
    });

    it('keeps the older keys when a download fails and never asks other hosts', async () => {
        const { loader, advance, calls } = loaderWith([
            { status: 200, body: { keys: [key('a')] } },
            { status: 500, body: {} },
        ]);
        const first = await loader('cache-test-3.cloudflareaccess.com', { refresh: false });
        advance(2 * 60 * 60 * 1000);
        const second = await loader('cache-test-3.cloudflareaccess.com', { refresh: false });
        assert.deepEqual(second, first);
        assert.equal(calls(), 2);
        assert.deepEqual(await loader('evil.example.com', { refresh: false }), []);
        assert.equal(calls(), 2);
    });
});
