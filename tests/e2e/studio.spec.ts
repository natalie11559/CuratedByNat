import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Studio against the development server, where the sign-in shortcut from .dev.vars is on.

test.describe('Studio shell', () => {
    test('opens, greets Nat by name and has the private-page headers', async ({ page }) => {
        const response = await page.goto('/studio');
        expect(response?.status()).toBe(200);

        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hi, Nat.');
        await expect(page.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');

        const headers = response!.headers();
        expect(headers['cache-control']).toBe('no-store, private');
        expect(headers['x-robots-tag']).toBe('noindex, nofollow');
        expect(headers['x-frame-options']).toBe('DENY');
        expect(headers['content-security-policy']).toContain("script-src 'self'");
    });

    test('serves its stylesheet through the guarded route, not the public build folder', async ({ page, request }) => {
        await page.goto('/studio');
        const stylesheet = await page.locator('link[rel="stylesheet"]').getAttribute('href');
        expect(stylesheet).toBe('/studio/app.css');

        const response = await request.get('/studio/app.css');
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('text/css');
        expect(response.headers()['cache-control']).toBe('no-store, private');
    });

    test('has no inline scripts or styles (the strict policy would block them)', async ({ page }) => {
        const violations: string[] = [];
        page.on('console', (message) => {
            if (/content security policy/i.test(message.text())) violations.push(message.text());
        });
        await page.goto('/studio');
        await page.waitForLoadState('load');
        expect(await page.locator('style, script:not([src])').count()).toBe(0);
        expect(await page.locator('[style]').count()).toBe(0);
        expect(violations).toEqual([]);
    });

    test('has no automatically detectable accessibility problems', async ({ page }) => {
        await page.goto('/studio');
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(results.violations).toEqual([]);
    });

    test('works at phone width without sideways scrolling and keeps touch targets large', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/studio');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);

        for (const link of await page.locator('.st-nav__link, .st-brand').all()) {
            const box = await link.boundingBox();
            expect(box!.height).toBeGreaterThanOrEqual(44);
        }
    });

    test('reports who is signed in through the API', async ({ request }) => {
        const response = await request.get('/api/studio/session');
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual({ email: 'hello@curatedbynat.com' });
        expect(response.headers()['cache-control']).toBe('no-store, private');
    });
});

test.describe('The public site is unaffected', () => {
    test('has no Studio text and the usual headers', async ({ page }) => {
        const response = await page.goto('/');
        expect(response?.status()).toBe(200);
        const html = await page.content();
        expect(html).not.toContain('/api/studio');
        expect(html).not.toContain('st-app');
        expect(response!.headers()['cache-control'] ?? '').not.toBe('no-store, private');
    });
});
