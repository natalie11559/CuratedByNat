import { expect, test } from '@playwright/test';

// These run against the PRODUCTION build served by `wrangler dev`, with the development shortcut still
// switched on in .dev.vars. Studio must stay closed anyway: no sign-in token means an empty 404 everywhere.

// Routes that exist answer with an empty plain-text 404 from the Worker.
const closedRoutes = ['/studio', '/studio/', '/studio/app.css', '/%73tudio', '/api/studio/session'];
// Paths with no route at all never reach the Worker; Cloudflare answers with the site's own 404 page.
const unknownPaths = ['/Studio', '/STUDIO/anything', '/api/studio/leads', '/studios'];

test.describe('Studio without a sign-in', () => {
    for (const path of closedRoutes) {
        test(`${path} answers an empty 404`, async ({ request }) => {
            const response = await request.get(path);
            expect(response.status()).toBe(404);
            expect(await response.text()).toBe('Not found');
            expect(response.headers()['cache-control']).toBe('no-store, private');
            expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
        });
    }

    for (const path of unknownPaths) {
        test(`${path} is a 404 too`, async ({ request }) => {
            expect((await request.get(path)).status()).toBe(404);
        });
    }

    test('writes are refused the same way', async ({ request }) => {
        for (const method of ['post', 'put', 'patch', 'delete'] as const) {
            const response = await request[method]('/api/studio/leads', { data: { firstName: 'Nobody' } });
            expect(response.status(), method).toBe(404);
        }
    });

    test('a made-up or garbage sign-in token does not help', async ({ request }) => {
        for (const token of ['garbage', 'a.b.c', 'eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImhlbGxvQGN1cmF0ZWRieW5hdC5jb20ifQ.']) {
            const response = await request.get('/studio', { headers: { 'Cf-Access-Jwt-Assertion': token } });
            expect(response.status()).toBe(404);
        }
    });

    test('the public site still works', async ({ request }) => {
        for (const path of ['/', '/about', '/services', '/inquire', '/robots.txt']) {
            expect((await request.get(path)).status(), path).toBe(200);
        }
    });
});
