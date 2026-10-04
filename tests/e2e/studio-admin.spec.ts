import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { runLocalD1 } from './helpers/d1';
import { addLead, unique } from './helpers/studio';

// Reply templates, the Clients list, settings and Recently deleted, against the development server where the
// sign-in shortcut is on.

const leadIdFromUrl = (page: Page) => /\/studio\/leads\/([0-9a-f-]{36})/.exec(page.url())![1]!;

async function openReply(page: Page, template: string) {
    await page.getByLabel('Pick a saved message').selectOption({ label: template });
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Reply to');
}

test.describe('Reply templates', () => {
    test('fills a starter draft with the client\'s details and opens it in the email app', async ({ page }) => {
        const first = unique('Tess');
        await addLead(page, { firstName: first, email: `${first.toLowerCase()}@example.com`, eventDate: '2027-05-15' });
        await openReply(page, 'Thanks for inquiring');

        await expect(page.locator('#reply-subject')).toHaveValue(`Thanks for reaching out, ${first}!`);
        const body = await page.locator('#reply-body').inputValue();
        expect(body).toContain(`Hi ${first}!`);
        expect(body).toContain('about your wedding.');
        expect(body).not.toMatch(/\{[a-z_]+\}/);
        expect(body).not.toMatch(/[—–]/);
        await expect(page.locator('.st-callout', { hasText: 'starter drafts' })).toBeVisible();

        const mail = await page.getByRole('link', { name: 'Open in Mail' }).getAttribute('href');
        expect(mail).toMatch(new RegExp(`^mailto:${first.toLowerCase()}@example\\.com\\?subject=Thanks%20for%20reaching%20out`));
        expect(mail).toContain('&body=');
    });

    test('the packages email lists your packages and extras with prices, and says when a detail is missing', async ({ page }) => {
        const name = unique('Pkg');
        await page.goto('/studio/settings');
        await page.locator('summary', { hasText: 'Add a package' }).click();
        const form = page.locator('form', { has: page.getByRole('button', { name: 'Add package' }) });
        await form.getByLabel('Name').fill(name);
        await form.getByLabel('Price').fill('425.50');
        await form.getByLabel(/What's included/).fill('Seven hours\nTwo reels');
        await form.getByRole('button', { name: 'Add package' }).click();

        const first = unique('Pam');
        await addLead(page, { firstName: first, email: `${first.toLowerCase()}@example.com` });
        await page.locator('summary', { hasText: 'Edit details' }).click();
        await page.getByLabel("Their date isn't set yet").check();
        await page.getByRole('button', { name: 'Save changes' }).click();
        await openReply(page, 'Packages and availability');

        const body = await page.locator('#reply-body').inputValue();
        expect(body).toContain(`${name} ($425.50)`);
        expect(body).toContain('Travel fees may apply for locations outside my local service area.');
        expect(body).toContain('checking my calendar for your date');
        await expect(page.locator('.st-callout', { hasText: 'a stand-in was used' })).toContainText('the date of their event');
    });

    test('Copy message copies it, and "I sent it" writes it on the timeline', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        const first = unique('Cora');
        await addLead(page, { firstName: first, email: `${first.toLowerCase()}@example.com` });
        const leadUrl = page.url().split('?')[0]!;
        await openReply(page, 'Following up');
        await page.getByRole('button', { name: 'Copy message' }).click();
        await expect(page.locator('#reply-copy-status')).toHaveText('Copied.');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.locator('#reply-body').inputValue());

        await page.getByRole('button', { name: 'I sent it' }).click();
        await expect(page).toHaveURL(new RegExp(leadUrl));
        await expect(page.getByText('Sent "Following up".')).toBeVisible();
        await expect(page.getByText('Contacted today')).toBeVisible();
    });

    test('edits a template, leaves the draft state, adds one with an unknown blank, and deletes it', async ({ page }) => {
        await page.goto('/studio/settings');
        const starter = page.locator('.st-price-item', { hasText: 'Following up' });
        await expect(starter.locator('.st-pill')).toHaveText('Draft');
        await starter.locator('summary').first().click();
        await starter.getByLabel('Message').fill('Hi {first_name}, just checking in! Nat');
        await starter.getByLabel('Still a draft').uncheck();
        await starter.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.locator('.st-notice')).toHaveText('Template saved.');
        await expect(page.locator('.st-price-item', { hasText: 'Following up' }).locator('.st-pill')).toHaveCount(0);

        // Put the starter back as it was, so other runs see the original draft.
        await page.locator('.st-price-item', { hasText: 'Following up' }).locator('summary').first().click();
        const restored = page.locator('.st-price-item', { hasText: 'Following up' });
        await restored.getByLabel('Message').fill('Hi {first_name}!\n\nJust popping back in to see if you had any questions about my packages or what I\'d capture for your {celebrating}. No pressure at all, I just want to make sure you have everything you need.\n\nIf {event_date} is still the plan, I\'d love to hold it for you. Let me know and we can set up a quick chat!\n\nNat\nCurated by Nat');
        await restored.getByLabel('Still a draft').check();
        await restored.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.locator('.st-notice')).toHaveText('Template saved.');

        const name = unique('Mine');
        await page.locator('summary', { hasText: 'Add a template' }).click();
        await page.locator('#new-template-name').fill(name);
        await page.locator('#new-template-subject').fill('Hello {first_name}');
        await page.locator('#new-template-body').fill('Hi {first_name} {nickname}');
        await page.getByRole('button', { name: 'Add template' }).click();
        await expect(page.locator('.st-notice')).toHaveText('Template saved.');

        const first = unique('Una');
        await addLead(page, { firstName: first, email: `${first.toLowerCase()}@example.com` });
        await openReply(page, name);
        await expect(page.locator('.st-callout', { hasText: "aren't recognised" })).toContainText('{nickname}');
        expect(await page.locator('#reply-body').inputValue()).toBe(`Hi ${first} {nickname}`);

        await page.goto('/studio/settings');
        const mine = page.locator('.st-price-item', { hasText: name });
        await mine.locator('summary').first().click();
        await mine.locator('summary', { hasText: 'Delete this template' }).click();
        await mine.getByRole('button', { name: `Delete ${name}` }).click();
        await expect(page.locator('.st-notice')).toHaveText('Template deleted.');
        await expect(page.locator('.st-price-item', { hasText: name })).toHaveCount(0);
    });

    test('a client with no email gets a clear message and no mail link', async ({ page }) => {
        await addLead(page, { firstName: unique('Noel') });
        await openReply(page, 'Thanks for inquiring');
        await expect(page.getByRole('link', { name: 'Open in Mail' })).toHaveCount(0);
        await expect(page.getByText(/no email address/)).toBeVisible();
    });
});

test.describe('Settings', () => {
    test('saves follow-up days and lost reasons, and uses them', async ({ page }) => {
        await page.goto('/studio/settings');
        const original = await page.getByLabel(/^Flag someone after/).inputValue();
        const reasons = await page.getByLabel(/^Reasons you can pick/).inputValue();
        const extra = unique('Reason');

        await page.getByLabel(/^Flag someone after/).fill('9');
        await page.getByLabel(/^Reasons you can pick/).fill(`${reasons}\n${extra}`);
        await page.locator('#general').getByRole('button', { name: 'Save' }).click();
        await expect(page.locator('.st-notice')).toHaveText('Settings saved.');
        await expect(page.getByLabel(/^Flag someone after/)).toHaveValue('9');

        await addLead(page, { firstName: unique('Lou') });
        await page.locator('summary', { hasText: 'Mark as lost' }).click();
        await expect(page.getByLabel('Why?').locator('option', { hasText: extra })).toHaveCount(1);

        await page.goto('/studio/settings');
        await page.getByLabel(/^Flag someone after/).fill(original);
        await page.getByLabel(/^Reasons you can pick/).fill(reasons);
        await page.locator('#general').getByRole('button', { name: 'Save' }).click();
        await expect(page.locator('.st-notice')).toHaveText('Settings saved.');
    });

    test('refuses days outside 1 to 60', async ({ page }) => {
        await page.goto('/studio/settings');
        await page.getByLabel(/^Flag someone after/).evaluate((input: HTMLInputElement) => input.removeAttribute('max'));
        await page.getByLabel(/^Flag someone after/).fill('90');
        await page.locator('#general').getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('alert')).toHaveText('Please check: Days before a nudge.');
    });
});

test.describe('The Clients list', () => {
    test('finds, filters and sorts everyone, and exports a spreadsheet that cannot run formulas', async ({ page, request }) => {
        const tag = unique('Cl');
        await addLead(page, { firstName: `${tag}b`, lastName: 'Zed', email: `${tag}b@example.com`, eventDate: '2027-08-01' });
        await addLead(page, { firstName: `${tag}a`, lastName: '=HYPERLINK("http://evil.example")', email: `${tag}a@example.com`, eventDate: '2027-03-01' });

        await page.goto(`/studio/clients?q=${tag}&sort=name`);
        const names = page.locator('.st-lead-card__name');
        await expect(names).toHaveText([new RegExp(`${tag}a`), new RegExp(`${tag}b`)]);
        await page.goto(`/studio/clients?q=${tag}&sort=event&dir=desc`);
        await expect(names).toHaveText([new RegExp(`${tag}b`), new RegExp(`${tag}a`)]);
        await page.goto(`/studio/clients?q=${tag}&stage=booked`);
        await expect(page.getByText(/^0 clients match/)).toBeVisible();
        await page.goto(`/studio/clients?q=${tag}`);
        await expect(page.getByText(/^2 clients match/)).toBeVisible();

        const link = await page.getByRole('link', { name: 'Export to a spreadsheet' }).getAttribute('href');
        const csv = await request.get(link!);
        expect(csv.status()).toBe(200);
        expect(csv.headers()['content-type']).toBe('text/csv; charset=utf-8');
        expect(csv.headers()['content-disposition']).toMatch(/^attachment; filename="curated-by-nat-clients-\d{4}-\d{2}-\d{2}\.csv"$/);
        expect(csv.headers()['cache-control']).toBe('no-store, private');
        const text = await csv.text();
        expect(text.startsWith('﻿"First name","Last name"')).toBe(true);
        expect(text.split('\r\n').length).toBe(1 + 2 + 1); // header, two clients, trailing break
        expect(text).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
        expect(text).not.toMatch(/,"=HYPERLINK/);
    });

    test('a person with nothing recorded shows no money', async ({ page, request }) => {
        const tag = unique('Nm');
        await addLead(page, { firstName: tag, email: `${tag}@example.com` });
        const csv = await (await request.get(`/api/studio/clients.csv?q=${tag}`)).text();
        expect(csv).toContain(`"${tag}"`);
        expect(csv.trimEnd().endsWith('"","",""')).toBe(true);
    });
});

test.describe('Recently deleted', () => {
    test('shows what was deleted, restores it, and offers "Delete forever" only after 30 days', async ({ page }) => {
        const first = unique('Del');
        await addLead(page, { firstName: first, email: `${first.toLowerCase()}@example.com` });
        const id = leadIdFromUrl(page);
        await page.locator('summary', { hasText: 'Delete this lead' }).click();
        await page.getByRole('button', { name: `Delete ${first}` }).click();

        await page.goto('/studio/deleted');
        const row = page.locator('.st-deleted', { hasText: first });
        await expect(row).toContainText('Can be deleted forever from');
        await expect(row.getByText('Delete forever')).toHaveCount(0);

        runLocalD1(`UPDATE leads SET deleted_at = datetime('now', '-40 days') WHERE id = '${id}'`);
        await page.goto('/studio/deleted');
        await expect(row.locator('summary', { hasText: 'Delete forever' })).toBeVisible();
        await row.getByRole('button', { name: 'Restore' }).click();
        await expect(page.locator('.st-notice')).toHaveText('Restored.');
        await expect(page.locator('.st-deleted', { hasText: first })).toHaveCount(0);
    });

    test('deleting forever erases a client with nothing attached', async ({ page }) => {
        const first = unique('Gone');
        await addLead(page, { firstName: first });
        const id = leadIdFromUrl(page);
        await page.locator('summary', { hasText: 'Delete this lead' }).click();
        await page.getByRole('button', { name: `Delete ${first}` }).click();
        runLocalD1(`UPDATE leads SET deleted_at = datetime('now', '-40 days') WHERE id = '${id}'`);

        await page.goto('/studio/deleted');
        const row = page.locator('.st-deleted', { hasText: first });
        await row.locator('summary', { hasText: 'Delete forever' }).click();
        await row.getByRole('button', { name: `Delete ${first} forever` }).click();
        await expect(page.locator('.st-notice')).toHaveText('Deleted forever.');
        expect(runLocalD1(`SELECT COUNT(*) AS n FROM leads WHERE id = '${id}'`)[0]).toEqual({ n: 0 });
    });

    test('a client with a booking is kept even after 30 days', async ({ page }) => {
        const first = unique('Keep');
        await addLead(page, { firstName: first });
        const id = leadIdFromUrl(page);
        await page.locator('summary', { hasText: /^Book / }).click();
        const form = page.locator('form[action$="/book"]');
        await form.getByLabel('Package', { exact: true }).selectOption('custom');
        await form.getByLabel(/^Custom package name/).fill('Day');
        await form.getByLabel(/^Custom price/).fill('300');
        await form.getByRole('button', { name: 'Book this client' }).click();
        await page.locator('summary', { hasText: 'Delete this lead' }).click();
        await page.getByRole('button', { name: `Delete ${first}` }).click();
        runLocalD1(`UPDATE leads SET deleted_at = datetime('now', '-40 days') WHERE id = '${id}'`);

        await page.goto('/studio/deleted');
        const row = page.locator('.st-deleted', { hasText: first });
        await row.locator('summary', { hasText: 'Delete forever' }).click();
        await row.getByRole('button', { name: `Delete ${first} forever` }).click();
        await expect(page.getByRole('alert')).toContainText('has a booking or files, so Studio keeps them');
        expect(runLocalD1(`SELECT COUNT(*) AS n FROM leads WHERE id = '${id}'`)[0]).toEqual({ n: 1 });
    });

    test('lists a deleted file and a deleted calendar item, and restores them', async ({ page }) => {
        const first = unique('Fi');
        await addLead(page, { firstName: first });
        await page.locator('#upload-file').setInputFiles({ name: 'keep-me.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 x') });
        await page.locator('#upload-kind').selectOption('other');
        await page.getByRole('button', { name: 'Save file' }).click();
        await page.getByRole('button', { name: 'Remove keep-me.pdf' }).click();

        await page.goto('/studio/deleted');
        const row = page.locator('.st-deleted', { hasText: 'keep-me.pdf' });
        await expect(row).toContainText(first);
        await row.getByRole('button', { name: /^Restore/ }).click();
        await expect(page.locator('.st-notice')).toHaveText('Restored.');
        await expect(page.locator('.st-deleted', { hasText: 'keep-me.pdf' })).toHaveCount(0);
    });
});

test.describe('Home-screen app', () => {
    test('has a manifest scoped to Studio, fetched with the sign-in, and no offline cache', async ({ page, request }) => {
        await page.goto('/studio');
        const link = page.locator('link[rel="manifest"]');
        await expect(link).toHaveAttribute('href', '/studio/manifest.webmanifest');
        await expect(link).toHaveAttribute('crossorigin', 'use-credentials');
        await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');

        const response = await request.get('/studio/manifest.webmanifest');
        expect(response.status()).toBe(200);
        const manifest = await response.json();
        expect(manifest).toMatchObject({ name: 'Curated by Nat Studio', short_name: 'Studio', start_url: '/studio', scope: '/studio/', display: 'standalone' });
        expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual(['/icon-192.png', '/icon-512.png']);
        expect(response.headers()['cache-control']).toBe('no-store, private');
        expect(await page.evaluate(() => 'serviceWorker' in navigator && navigator.serviceWorker.controller === null)).toBe(true);
    });
});

test.describe('Looks and accessibility', () => {
    const paths = ['/studio/clients', '/studio/deleted', '/studio/settings'];

    for (const path of paths) {
        test(`${path} has no automatically detectable accessibility problems, with every section open`, async ({ page }) => {
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.goto(path);
            for (let attempt = 0; attempt < 60 && (await page.locator('details:not([open]) > summary').count()) > 0; attempt += 1) {
                await page.locator('details:not([open]) > summary').first().click();
            }
            const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
            expect(results.violations).toEqual([]);
        });

        test(`${path} fits a 390px phone with 44px touch targets`, async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await page.goto(path);
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow).toBeLessThanOrEqual(0);
            for (const control of await page.locator('main a:visible, main button:visible, main select:visible, main input:visible').all()) {
                const box = await control.boundingBox();
                if (!box) continue;
                const skip = await control.evaluate((element) => element.getAttribute('type') === 'checkbox' || element.closest('.st-steps, .st-hint, .st-callout, .st-quiet, .st-dl, .st-optional') !== null);
                if (skip) continue;
                expect(box.height, await control.evaluate((element) => element.outerHTML.slice(0, 90))).toBeGreaterThanOrEqual(43.5);
            }
        });
    }

    test('the reply page is accessible and fits a phone', async ({ page }) => {
        await addLead(page, { firstName: unique('Rae'), email: `${unique('rae').toLowerCase()}@example.com` });
        await openReply(page, 'Booking confirmed');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(results.violations).toEqual([]);
        await page.setViewportSize({ width: 390, height: 844 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
