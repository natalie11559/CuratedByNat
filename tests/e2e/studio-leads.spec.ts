import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { addLead, easternToday, unique } from './helpers/studio';

// Studio's pipeline, against the development server where the sign-in shortcut is on.

test.describe('Adding and working a lead', () => {
    test('adds a lead from the + button and shows its details', async ({ page }) => {
        const first = unique('Ava');
        await page.goto('/studio');
        await page.getByRole('link', { name: 'Add a lead' }).click();
        await expect(page).toHaveURL(/\/studio\/leads\/new$/);

        await page.getByLabel('First name').fill(first);
        await page.getByLabel('Last name').fill('Lee');
        await page.getByLabel('Email').fill(`${first}@example.com`.toLowerCase());
        await page.getByLabel('Phone').fill('(404) 555-0100');
        await page.getByLabel('Instagram').fill('@avalee');
        await page.getByLabel('Where did they come from?').selectOption('referral');
        await page.getByRole('checkbox', { name: 'Wedding' }).check();
        await page.getByLabel('Event date').fill('2027-05-15');
        await page.getByLabel('City or area').fill('Atlanta, GA');
        await page.getByRole('button', { name: 'Add lead' }).click();

        await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${first} Lee`);
        await expect(page.getByRole('status')).toHaveText('Lead added.');
        await expect(page.getByText('May 15, 2027').first()).toBeVisible();
        await expect(page.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:4045550100');
        await expect(page.getByRole('link', { name: 'Text' })).toHaveAttribute('href', 'sms:4045550100');
        await expect(page.getByRole('link', { name: 'Email' })).toHaveAttribute('href', `mailto:${first.toLowerCase()}@example.com`);
        await expect(page.getByRole('link', { name: /Instagram/ })).toHaveAttribute('href', 'https://www.instagram.com/avalee/');
        await expect(page.getByText('Added by hand.')).toBeVisible();
    });

    test('logging a call records it, updates the lead and moves a New lead to Contacted', async ({ page }) => {
        await addLead(page, { firstName: unique('Bea') });
        await expect(page.getByText('Inquired today')).toBeVisible();

        await page.getByLabel('What was said?').fill('Left a voicemail about packages');
        await page.getByRole('button', { name: 'Called' }).click();

        await expect(page.getByRole('status')).toHaveText('Logged.');
        await expect(page.getByText('Left a voicemail about packages')).toBeVisible();
        await expect(page.getByText('Contacted today')).toBeVisible();
        await expect(page.getByText('Moved from New to Contacted.')).toBeVisible();
        await expect(page.locator('.st-pill')).toHaveText('Contacted');
    });

    test('adds a note without counting it as contact', async ({ page }) => {
        await addLead(page, { firstName: unique('Cy') });
        await page.getByLabel('Or just add a note').fill('Prefers sunset light');
        await page.getByRole('button', { name: 'Add note' }).click();
        await expect(page.getByRole('status')).toHaveText('Note added.');
        await expect(page.getByText('Prefers sunset light')).toBeVisible();
        await expect(page.locator('.st-pill')).toHaveText('New');
        await expect(page.getByText('Inquired today')).toBeVisible();
    });

    test('moves a lead through every stage, writing each move on the timeline', async ({ page }) => {
        await addLead(page, { firstName: unique('Dee') });
        const move = async (stage: string, previous: string) => {
            await page.getByLabel('Stage', { exact: true }).selectOption({ label: stage });
            await page.getByRole('button', { name: 'Move', exact: true }).click();
            await expect(page.getByRole('status')).toHaveText('Moved.');
            await expect(page.locator('.st-pill').first()).toHaveText(stage);
            await expect(page.getByText(`Moved from ${previous} to ${stage}.`)).toBeVisible();
        };
        await move('Contacted', 'New');
        await move('Consultation', 'Contacted');
        await move('Packages sent', 'Consultation');

        // Booked needs the booking details, so the booking form opens instead of a plain move.
        await page.getByLabel('Stage', { exact: true }).selectOption({ label: 'Booked' });
        await page.getByRole('button', { name: 'Move', exact: true }).click();
        const form = page.locator('details[open] form[action$="/book"]');
        await form.getByLabel('Package', { exact: true }).selectOption('custom');
        await form.getByLabel(/^Custom package name/).fill('Test day');
        await form.getByLabel(/^Custom price/).fill('300');
        await form.getByRole('button', { name: 'Book this client' }).click();
        await expect(page.locator('.st-pill').first()).toHaveText('Booked');
        await expect(page.getByText('Booked.', { exact: true })).toBeVisible();

        await move('Event done', 'Booked');
        await move('Delivered', 'Event done');
    });

    test('marks a lead lost with a reason, then reopens it where it was', async ({ page }) => {
        await addLead(page, { firstName: unique('Eve') });
        await page.getByLabel('Stage', { exact: true }).selectOption({ label: 'Packages sent' });
        await page.getByRole('button', { name: 'Move', exact: true }).click();
        await expect(page.locator('.st-pill')).toHaveText('Packages sent');

        await page.locator('summary', { hasText: 'Mark as lost' }).click();
        await page.getByLabel('Why?').selectOption('Over budget');
        await page.getByRole('button', { name: 'Mark as lost' }).click();
        await expect(page.getByRole('status')).toHaveText('Marked as lost.');
        await expect(page.locator('.st-pill')).toHaveText('Lost');
        await expect(page.getByText('Lost: Over budget', { exact: false }).first()).toBeVisible();

        await page.getByRole('button', { name: 'Reopen this lead' }).click();
        await expect(page.getByRole('status')).toHaveText('Reopened.');
        await expect(page.locator('.st-pill')).toHaveText('Packages sent');
    });

    test('a follow-up date that has come puts the lead on Home, and logging contact clears it', async ({ page }) => {
        const first = unique('Fay');
        await addLead(page, { firstName: first });
        await page.getByLabel('Follow up on').fill(easternToday());
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByRole('status')).toHaveText('Follow-up date saved.');
        await expect(page.getByText('Time to follow up')).toBeVisible();

        await page.goto('/studio');
        const section = page.locator('section', { has: page.getByRole('heading', { name: /Needs follow-up/ }) });
        await expect(section.getByRole('link', { name: new RegExp(first) })).toBeVisible();
        await section.getByRole('link', { name: new RegExp(first) }).click();

        await page.getByRole('button', { name: 'Texted' }).click();
        await expect(page.getByText('Time to follow up')).toHaveCount(0);
        await expect(page.getByLabel('Follow up on')).toHaveValue('');
    });

    test('edits details and keeps the rest', async ({ page }) => {
        const first = unique('Gia');
        await addLead(page, { firstName: first, lastName: 'Park' });
        await page.locator('summary', { hasText: 'Edit details' }).click();
        await page.locator('#edit-phone').fill('770-555-0199');
        await page.locator('#edit-venue').fill('The Foundry');
        await page.locator('#edit-notes').fill('Second shooter welcome');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByRole('status')).toHaveText('Saved.');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${first} Park`);
        await expect(page.getByText('The Foundry').first()).toBeVisible();
        await expect(page.locator('.st-notes')).toHaveText('Second shooter welcome');
        await expect(page.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:7705550199');
    });

    test('refuses a second open lead with the same email and links to the first', async ({ page }) => {
        const email = `${unique('dup')}@example.com`;
        await addLead(page, { firstName: unique('Hal'), email });
        const firstUrl = page.url().split('?')[0]!;
        await page.goto('/studio/leads/new');
        await page.getByLabel('First name').fill('Second');
        await page.getByLabel('Email').fill(email.toUpperCase());
        await page.getByRole('button', { name: 'Add lead' }).click();
        await expect(page.getByRole('alert')).toContainText('Another open lead already uses that email.');
        await page.getByRole('link', { name: 'Open that lead' }).click();
        await expect(page).toHaveURL(firstUrl);
    });

    test('deleting moves a lead to Recently deleted and it can be restored', async ({ page }) => {
        const first = unique('Ivy');
        await addLead(page, { firstName: first });
        const leadUrl = page.url().split('?')[0]!;

        await page.locator('summary', { hasText: 'Delete this lead' }).click();
        await page.getByRole('button', { name: `Delete ${first}` }).click();
        await expect(page).toHaveURL(/\/studio\/pipeline/);
        await expect(page.getByRole('status')).toHaveText('Moved to Recently deleted.');
        await page.goto('/studio/search?q=' + first);
        await expect(page.getByText(/Nobody matches/)).toBeVisible();

        await page.goto(leadUrl);
        await expect(page.getByRole('heading', { name: 'In Recently deleted' })).toBeVisible();
        await page.getByRole('button', { name: 'Restore this lead' }).click();
        await expect(page.getByRole('status')).toHaveText('Restored.');
        await expect(page.getByRole('heading', { name: 'In Recently deleted' })).toHaveCount(0);
    });
});

test.describe('Finding people', () => {
    test('search finds a lead by name, email and phone digits', async ({ page }) => {
        const first = unique('Jo');
        const email = `${first}@example.com`.toLowerCase();
        await addLead(page, { firstName: first, lastName: 'Rivera', email, phone: '(678) 555-0142' });

        for (const query of [first, `${first} Rivera`, email, '678 555-0142', '5550142']) {
            await page.goto(`/studio/search?q=${encodeURIComponent(query)}`);
            await expect(page.getByRole('link', { name: new RegExp(first) }).first(), query).toBeVisible();
        }
        await page.goto('/studio/search?q=zzzznobodyzzzz');
        await expect(page.getByText(/Nobody matches/)).toBeVisible();
    });

    test('on a phone the pipeline shows one stage at a time, with counts, and filters by what people are celebrating', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const first = unique('Kai');
        await addLead(page, { firstName: first });
        await page.goto('/studio/pipeline');
        const active = page.locator('.st-column[data-active]');
        await expect(active.getByRole('link', { name: new RegExp(first) })).toBeVisible();
        await expect(page.locator('.st-column:not([data-active])').first()).toBeHidden();

        await page.getByRole('link', { name: /^Contacted/ }).click();
        await expect(page.getByRole('link', { name: /^Contacted/ })).toHaveAttribute('aria-current', 'page');
        await expect(active.getByRole('link', { name: new RegExp(first) })).toHaveCount(0);

        await page.goto('/studio/pipeline?celebrating=bachelorette');
        await expect(page.getByText('Filters (on)')).toBeVisible();
        await expect(active.getByRole('link', { name: new RegExp(first) })).toHaveCount(0);
        await page.goto('/studio/pipeline?celebrating=wedding');
        await expect(active.getByRole('link', { name: new RegExp(first) })).toBeVisible();
    });

    test('on a laptop the pipeline shows every stage side by side', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const first = unique('Kit');
        await addLead(page, { firstName: first });
        await page.goto('/studio/pipeline');
        for (const stage of ['New', 'Contacted', 'Consultation', 'Packages sent', 'Booked', 'Event done', 'Delivered', 'Lost']) {
            await expect(page.getByRole('heading', { name: new RegExp(`^${stage}`) })).toBeVisible();
        }
        await expect(page.getByRole('navigation', { name: 'Stages' })).toBeHidden();
        await expect(page.getByRole('link', { name: new RegExp(first) })).toBeVisible();
    });

    test('moving a lead from its card in the pipeline', async ({ page }) => {
        const first = unique('Lou');
        await addLead(page, { firstName: first });
        await page.goto('/studio/pipeline');
        const card = page.locator('.st-lead-card', { hasText: first });
        await card.locator('summary').click();
        await card.getByLabel(/^Move .* to$/).selectOption({ label: 'Consultation' });
        await card.getByRole('button', { name: 'Move' }).click();
        await expect(page.getByRole('status')).toHaveText('Moved.');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/studio/pipeline');
        await page.getByRole('link', { name: /^Consultation/ }).click();
        await expect(page.locator('.st-column[data-active]').getByRole('link', { name: new RegExp(first) })).toBeVisible();
    });
});

test.describe('Safety and access', () => {
    test('writes from another site are refused', async ({ request }) => {
        const response = await request.post('/api/studio/leads', {
            form: { first_name: 'Intruder' },
            headers: { Origin: 'https://evil.example' },
            maxRedirects: 0,
        });
        expect(response.status()).toBe(403);
        const noOrigin = await request.post('/api/studio/leads', { form: { first_name: 'Intruder' }, maxRedirects: 0 });
        expect(noOrigin.status()).toBe(403);
    });

    test('lead pages only accept real ids and only POST changes things', async ({ request, baseURL }) => {
        const headers = { Origin: baseURL ?? '' };
        expect((await request.post('/api/studio/leads/not-an-id/delete', { form: {}, headers, maxRedirects: 0 })).status()).toBe(404);
        const id = '123e4567-e89b-42d3-a456-426614174000';
        const missing = await request.post(`/api/studio/leads/${id}/stage`, { form: { stage: 'consultation' }, headers, maxRedirects: 0 });
        expect(missing.status()).toBe(303);
        expect(missing.headers().location).toContain('error=not-found');
        expect((await request.get(`/api/studio/leads/${id}/delete`)).status()).toBe(405);
        expect((await request.post(`/api/studio/leads/${id}/explode`, { form: {}, headers, maxRedirects: 0 })).status()).toBe(404);
    });

    test('a banner code the page does not know shows nothing, and tags in it are not run', async ({ page }) => {
        await page.goto('/studio/pipeline?notice=%3Cb%3Ehi%3C/b%3E&error=%3Cscript%3Ealert(1)%3C/script%3E');
        await expect(page.locator('.st-notice')).toHaveCount(0);
        await expect(page.locator('main b')).toHaveCount(0);
    });

    test('returns to Studio pages only after a move', async ({ request, baseURL }) => {
        const headers = { Origin: baseURL ?? '' };
        const id = '123e4567-e89b-42d3-a456-426614174000';
        const response = await request.post(`/api/studio/leads/${id}/stage`, {
            form: { stage: 'booked', return_to: 'https://evil.example/phish' },
            headers,
            maxRedirects: 0,
        });
        expect(response.headers().location).toMatch(/^\/studio\//);
    });
});

test.describe('Looks and accessibility', () => {
    const pages = ['/studio', '/studio/pipeline', '/studio/search?q=a', '/studio/leads/new'];

    for (const path of pages) {
        test(`${path} has no automatically detectable accessibility problems`, async ({ page }) => {
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.goto(path);
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
                const type = await control.getAttribute('type');
                if (type === 'checkbox') continue; // the label around a checkbox is the 44px target
                expect(box.height, await control.evaluate((element) => element.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(43.5);
            }
        });
    }

    test('a lead page is accessible and fits a phone', async ({ page }) => {
        await addLead(page, { firstName: unique('Mae'), email: `${unique('mae')}@example.com`, phone: '404-555-0111' });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(results.violations).toEqual([]);

        await page.setViewportSize({ width: 390, height: 844 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
