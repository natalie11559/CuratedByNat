import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addLead, easternToday, unique } from './helpers/studio';

// The calendar and the private phone feed, against the development server where the sign-in shortcut is on.

const plusDays = (days: number) => {
    const date = new Date(`${easternToday()}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

async function addItem(page: Page, options: { title: string; date: string; type?: string; time?: string; allDay?: boolean }) {
    await page.goto(`/studio/calendar/day/${options.date}`);
    const form = page.locator('form[action="/api/studio/calendar"]');
    await form.getByLabel('What is it?').selectOption(options.type ?? 'personal');
    await form.getByLabel(/^Title/).fill(options.title);
    if (options.allDay === false) await form.getByLabel(/^Starts/).fill(options.time ?? '10:00');
    else await form.getByLabel(/^All day/).check();
    await form.getByRole('button', { name: 'Add to calendar' }).click();
    await expect(page.getByRole('status')).toHaveText('Added to your calendar.');
}

async function feedUrl(page: Page): Promise<string> {
    await page.goto('/studio/settings');
    return page.locator('#feed-url').inputValue();
}

test.describe('Calendar items', () => {
    test('adds an all-day item to a day, sees it on the month and the day, edits it and removes it', async ({ page }) => {
        const title = unique('Dentist');
        const date = plusDays(40);
        await addItem(page, { title, date });
        await expect(page).toHaveURL(new RegExp(`/studio/calendar/day/${date}`));
        await expect(page.locator('.st-entry', { hasText: title })).toContainText('Personal · All day');

        await page.goto(`/studio/calendar?month=${date.slice(0, 7)}`);
        await expect(page.locator('.st-agenda__day', { hasText: title }).getByRole('link', { name: new RegExp(title) })).toBeVisible();

        await page.goto(`/studio/calendar/day/${date}`);
        await page.locator('.st-entry', { hasText: title }).click();
        await page.getByLabel(/^Title/).fill(`${title} moved`);
        await page.getByLabel(/^Where/).fill('Midtown');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByRole('status')).toHaveText('Calendar item saved.');
        await expect(page.locator('.st-entry', { hasText: `${title} moved` })).toContainText('Midtown');

        await page.locator('.st-entry', { hasText: title }).click();
        await page.locator('summary', { hasText: 'Remove from calendar' }).click();
        await page.getByRole('button', { name: 'Remove', exact: true }).click();
        await expect(page.getByRole('status')).toHaveText('Calendar item removed.');
        await expect(page.locator('.st-entry', { hasText: title })).toHaveCount(0);
    });

    test('a timed consultation for a client shows on their page and on Home this week, in Eastern time', async ({ page }) => {
        const first = unique('Cal');
        await addLead(page, { firstName: first });
        const leadUrl = page.url().split('?')[0]!;
        await page.getByRole('link', { name: 'Schedule a consultation' }).click();
        await expect(page.getByLabel('About a client (optional)')).toHaveValue(/.+/);
        const date = plusDays(3);
        await page.getByLabel('Date', { exact: true }).fill(date);
        await page.getByLabel(/^Starts/).fill('16:30');
        await page.getByLabel(/^Ends/).fill('17:15');
        await page.getByRole('button', { name: 'Add to calendar' }).click();
        await expect(page.getByRole('status')).toHaveText('Added to your calendar.');
        await expect(page.locator('.st-entry', { hasText: first })).toContainText(`Consultation with ${first}`);
        await expect(page.locator('.st-entry', { hasText: first })).toContainText('4:30 PM to 5:15 PM');

        await page.goto(leadUrl);
        await expect(page.locator('#calendar-heading').locator('..').getByText(`Consultation with ${first}`)).toBeVisible();

        await page.goto('/studio');
        const week = page.locator('section', { has: page.getByRole('heading', { name: /This week/ }) });
        await expect(week.getByRole('link', { name: new RegExp(`Consultation with ${first}`) })).toContainText('4:30 PM');
    });

    test("a booked client's event appears by itself and moves when the lead's date changes", async ({ page }) => {
        const first = unique('Wed');
        const date = plusDays(70);
        await addLead(page, { firstName: first, eventDate: date });
        const leadUrl = page.url().split('?')[0]!;
        const form = page.locator('summary', { hasText: /^Book / });
        await form.click();
        const bookingForm = page.locator('form[action$="/book"]');
        await bookingForm.getByLabel('Package', { exact: true }).selectOption('custom');
        await bookingForm.getByLabel(/^Custom package name/).fill('Test day');
        await bookingForm.getByLabel(/^Custom price/).fill('300');
        await bookingForm.getByRole('button', { name: 'Book this client' }).click();
        await expect(page.getByRole('status')).toHaveText('Booked! Their details are below.');

        await page.goto(`/studio/calendar/day/${date}`);
        await expect(page.locator('.st-entry', { hasText: `${first}'s event` })).toContainText('Event · All day');
        await page.goto(`/studio/calendar/day/${plusDays(71)}`);
        await expect(page.locator('.st-entry', { hasText: `Deliver content to ${first}` })).toBeVisible();

        await page.goto(leadUrl);
        await page.locator('summary', { hasText: 'Edit details' }).click();
        await page.locator('#edit-event_date').fill(plusDays(80));
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByRole('status')).toHaveText('Saved.');
        await page.goto(`/studio/calendar/day/${date}`);
        await expect(page.locator('.st-entry', { hasText: `${first}'s event` })).toHaveCount(0);
        await page.goto(`/studio/calendar/day/${plusDays(80)}`);
        await expect(page.locator('.st-entry', { hasText: `${first}'s event` })).toBeVisible();
    });

    test('moves between months, marks today, and labels each day for screen readers', async ({ page }) => {
        const title = unique('Label');
        const date = plusDays(2);
        await addItem(page, { title, date });
        await page.goto(`/studio/calendar?month=${date.slice(0, 7)}`);
        const cell = page.locator(`a[href="/studio/calendar/day/${date}"]`).first();
        await expect(cell).toHaveAttribute('aria-label', /: \d+ items? \(.*Personal/);
        await expect(page.locator('[aria-current="date"]')).toHaveAttribute('href', `/studio/calendar/day/${easternToday()}`);

        await page.goto('/studio/calendar?month=2027-02');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('February 2027');
        await page.getByRole('link', { name: /Previous month/ }).click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('January 2027');
        await page.getByRole('link', { name: /next month/ }).click();
        await page.getByRole('link', { name: /next month/ }).click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('March 2027');
        await expect(page.getByRole('list', { name: 'What the shapes mean' })).toContainText('Consultation');
    });

    test('refuses bad input with what to fix', async ({ page }) => {
        await page.goto(`/studio/calendar/day/${plusDays(5)}`);
        const form = page.locator('form[action="/api/studio/calendar"]');
        await form.getByLabel(/^Title/).fill('No time given');
        await form.getByRole('button', { name: 'Add to calendar' }).click();
        await expect(page.getByRole('alert')).toHaveText('Please check: Start time.');
    });
});

test.describe('The phone calendar link', () => {
    test('serves a private calendar with the items, and only the safe details', async ({ page, request, baseURL }) => {
        const first = unique('Feed');
        const date = plusDays(20);
        await addLead(page, { firstName: first, phone: '(404) 555-0177', email: `${first.toLowerCase()}@example.com` });
        await page.locator('summary', { hasText: 'Edit details' }).click();
        await page.locator('#edit-last_name').fill('Surnameson');
        await page.locator('#edit-location').fill('Savannah, GA');
        await page.locator('#edit-notes').fill('Secret note about money $9999');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await page.getByRole('link', { name: 'Schedule a consultation' }).click();
        await page.getByLabel('Title (optional when it is about a client)').fill('Private title with retainer talk');
        await page.getByLabel('Date', { exact: true }).fill(date);
        await page.getByLabel(/^Starts/).fill('14:00');
        await page.getByLabel(/^Notes/).fill('Phone 770-555-0188');
        await page.getByRole('button', { name: 'Add to calendar' }).click();
        await expect(page.getByRole('status')).toHaveText('Added to your calendar.');
        const title = unique('Mine');
        await addItem(page, { title, date: plusDays(21) });

        const url = await feedUrl(page);
        expect(url).toMatch(new RegExp(`^${baseURL}/cal/[A-Za-z0-9_-]{43}\\.ics$`));
        const response = await request.get(url);
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toBe('text/calendar; charset=utf-8');
        expect(response.headers()['cache-control']).toBe('private, no-store');
        expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
        const body = await response.text();

        expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
        expect(body).toContain(`SUMMARY:Consultation: ${first}\r\n`);
        expect(body).toContain('LOCATION:Savannah\\, GA\r\n');
        expect(body).toContain(`SUMMARY:${title}\r\n`);
        // 2 PM Eastern, on whichever side of daylight saving that date falls.
        expect(body).toMatch(new RegExp(`DTSTART:${date.replace(/-/g, '')}T(18|19)0000Z`));
        for (const secret of ['Surnameson', '555-0177', '555-0188', '(404)', 'Secret note', '9999', 'retainer', 'Private title', `${first.toLowerCase()}@example.com`]) {
            expect(body, secret).not.toContain(secret);
        }
    });

    test('a wrong or reset link gets an empty 404, and resetting gives a new working link', async ({ page, request }) => {
        const url = await feedUrl(page);
        expect((await request.get(url)).status()).toBe(200);
        for (const bad of ['/cal/wrong.ics', `/cal/${'a'.repeat(43)}.ics`, '/cal/.ics', `/cal/${'a'.repeat(500)}.ics`, '/cal/x']) {
            const response = await request.get(bad);
            expect(response.status(), bad).toBe(404);
            // Addresses that look like the feed get the empty answer; anything else is just the site's 404 page.
            if (/^\/cal\/.+\.ics$/.test(bad) && bad.length < 80) expect(await response.text()).toBe('Not found');
        }

        await page.locator('summary', { hasText: 'Make a new link' }).click();
        await page.getByRole('button', { name: 'Make a new link' }).click();
        await expect(page.locator('.st-notice')).toContainText('Your old calendar link has stopped working.');
        const fresh = await page.locator('#feed-url').inputValue();
        expect(fresh).not.toBe(url);
        expect((await request.get(url)).status()).toBe(404);
        expect((await request.get(fresh)).status()).toBe(200);
    });

    test('the Copy link button copies the address', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/studio/settings');
        const url = await page.locator('#feed-url').inputValue();
        await page.getByRole('button', { name: 'Copy link' }).click();
        await expect(page.locator('#feed-copy-status')).toHaveText('Copied.');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    });

    test('Add to iPhone Calendar uses a webcal link to the same address', async ({ page }) => {
        await page.goto('/studio/settings');
        const url = await page.locator('#feed-url').inputValue();
        await expect(page.getByRole('link', { name: 'Add to iPhone Calendar' })).toHaveAttribute('href', url.replace(/^https?:/, 'webcal:'));
    });

    test('the script is served from the guarded path and the page has no inline code', async ({ page, request }) => {
        const script = await request.get('/studio/app.js');
        expect(script.status()).toBe(200);
        expect(script.headers()['content-type']).toContain('javascript');
        expect(script.headers()['cache-control']).toBe('no-store, private');
        await page.goto('/studio/settings');
        expect(await page.locator('script:not([src])').count()).toBe(0);
        expect(await page.locator('[style]').count()).toBe(0);
    });
});

test.describe('Looks and accessibility', () => {
    const paths = ['/studio/calendar', '/studio/calendar/new', `/studio/calendar/day/${plusDays(1)}`, '/studio/add', '/studio/settings'];

    for (const path of paths) {
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
                if (type === 'checkbox' || (await control.evaluate((element) => element.closest('.st-steps, .st-hint, p.st-callout, .st-quiet, .st-legend') !== null))) continue;
                expect(box.height, await control.evaluate((element) => element.outerHTML.slice(0, 90))).toBeGreaterThanOrEqual(43.5);
            }
        });
    }
});
