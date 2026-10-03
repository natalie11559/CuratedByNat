import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addLead, easternToday, unique } from './helpers/studio';

// Bookings, payments and the price lists, against the development server where the sign-in shortcut is on.
// Prices here are made up; each test makes its own packages so the real ones (if loaded locally) are untouched.

const plusDays = (days: number) => {
    const date = new Date(`${easternToday()}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

async function addPackage(page: Page, name: string, price: string, details = 'Six hours\nOne reel') {
    await page.goto('/studio/settings');
    await page.locator('summary', { hasText: 'Add a package' }).click();
    const form = page.locator('form', { has: page.getByRole('button', { name: 'Add package' }) });
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('Price').fill(price);
    await form.getByLabel(/What's included/).fill(details);
    await form.getByRole('button', { name: 'Add package' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
}

async function addExtra(page: Page, name: string, price: string) {
    await page.goto('/studio/settings');
    await page.locator('summary', { hasText: 'Add an extra' }).click();
    const form = page.locator('form', { has: page.getByRole('button', { name: 'Add extra' }) });
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('Price').fill(price);
    await form.getByRole('button', { name: 'Add extra' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
}

async function openBookingForm(page: Page) {
    const summary = page.locator('summary', { hasText: /^Book / });
    if ((await page.locator('details[open] form[action$="/book"]').count()) === 0) await summary.click();
    return page.locator('form[action$="/book"]');
}

test.describe('Price lists in Settings', () => {
    test('adds, edits, hides and shows a package and an extra', async ({ page }) => {
        const name = unique('Pkg');
        await addPackage(page, name, '$425.50', 'Seven hours\nTwo reels');
        const item = page.locator('.st-price-item', { hasText: name });
        await expect(item).toContainText('$425.50');

        await item.locator('summary').click();
        await expect(item.locator('.st-included')).toContainText('Seven hours');
        await item.getByLabel('Price').fill('450');
        await item.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('status')).toHaveText('Saved.');
        await expect(page.locator('.st-price-item', { hasText: name })).toContainText('$450');

        await page.locator('.st-price-item', { hasText: name }).locator('summary').click();
        await page.getByRole('button', { name: `Hide ${name}` }).click();
        await expect(page.getByRole('status')).toHaveText('Hidden. It stays on past bookings.');
        await expect(page.locator('.st-price-item', { hasText: name })).toHaveCount(0);

        await page.locator('summary', { hasText: /^Hidden/ }).first().click();
        await page.getByRole('button', { name: `Show ${name} again` }).click();
        await expect(page.getByRole('status')).toHaveText('It is back on the list.');
        await expect(page.locator('.st-price-item', { hasText: name })).toHaveCount(1);
    });

    test('refuses a price that is not money', async ({ page }) => {
        await page.goto('/studio/settings');
        await page.locator('summary', { hasText: 'Add an extra' }).click();
        const form = page.locator('form', { has: page.getByRole('button', { name: 'Add extra' }) });
        await form.getByLabel('Name').fill(unique('Bad'));
        await form.getByLabel('Price').fill('lots');
        await form.getByRole('button', { name: 'Add extra' }).click();
        await expect(page.getByRole('alert')).toHaveText('Please check: Price.');
    });
});

test.describe('Booking a client', () => {
    test('books with a package, extras and travel, works out the total and moves the lead to Booked', async ({ page }) => {
        const pkg = unique('Plan');
        const extra = unique('Hour');
        await addPackage(page, pkg, '500');
        await addExtra(page, extra, '50');

        const first = unique('Bo');
        await addLead(page, { firstName: first, eventDate: plusDays(60) });
        const form = await openBookingForm(page);
        await form.getByLabel('Package', { exact: true }).selectOption({ label: `${pkg} ($500)` });
        await form.getByLabel(new RegExp(`^${extra}`)).fill('2');
        await form.getByLabel(/^Travel fee/).fill('40');
        await form.getByLabel(/^What the travel covers/).fill('Savannah');
        await form.getByLabel(/^Retainer/).fill('150');
        await expect(form.getByLabel(/^Balance due on/)).toHaveValue(plusDays(30));
        await form.getByRole('button', { name: 'Book this client' }).click();

        await expect(page.getByRole('status')).toHaveText('Booked! Their details are below.');
        await expect(page.locator('.st-pill').first()).toHaveText('Booked');
        const card = page.locator('section.st-card', { has: page.getByRole('heading', { name: pkg }) });
        await expect(card).toContainText('Unpaid');
        await expect(card.locator('.st-money__total').first()).toContainText('$640'); // 500 + 2 x 50 + 40
        await expect(card).toContainText(`${extra} × 2`);
        await expect(card).toContainText('Travel (Savannah)');
        await expect(card.locator('.st-money__total').nth(1)).toContainText('$640');
        await expect(page.getByText(`Booked: ${pkg}, total $640.`)).toBeVisible();
    });

    test('moving a lead to Booked asks for the booking details first', async ({ page }) => {
        await addLead(page, { firstName: unique('Cal') });
        await page.getByLabel('Stage', { exact: true }).selectOption({ label: 'Booked' });
        await page.getByRole('button', { name: 'Move', exact: true }).click();
        await expect(page.getByRole('status')).toHaveText('Add the booking details below to mark them as booked.');
        await expect(page.locator('.st-pill').first()).toHaveText('New');
        await expect(page.locator('details[open] form[action$="/book"]')).toBeVisible();
    });

    test('a typed total beats the automatic one, and a custom package works without the price list', async ({ page }) => {
        await addLead(page, { firstName: unique('Dax') });
        const form = await openBookingForm(page);
        await form.getByLabel('Package', { exact: true }).selectOption('custom');
        await form.getByLabel(/^Custom package name/).fill('Elopement day');
        await form.getByLabel(/^Custom price/).fill('275.50');
        await form.getByLabel(/^Total/).fill('250');
        await form.getByRole('button', { name: 'Book this client' }).click();

        const card = page.locator('section.st-card', { has: page.getByRole('heading', { name: 'Elopement day' }) });
        await expect(card.locator('.st-money__total').first()).toContainText('$250');
        await expect(card).toContainText('Adjustment');
        await expect(card).toContainText('-$25.50');
    });

    test('a bad amount shows what to fix and books nobody', async ({ page }) => {
        await addLead(page, { firstName: unique('Eli') });
        const form = await openBookingForm(page);
        await form.getByLabel(/^Total/).fill('a lot');
        await form.getByLabel(/^Retainer/).fill('50');
        await form.getByRole('button', { name: 'Book this client' }).click();
        await expect(page.getByRole('alert')).toHaveText('Please check: Total.');
        await expect(page.locator('.st-pill').first()).toHaveText('New');
    });
});

test.describe('Payments and balances', () => {
    async function bookedClient(page: Page, options: { total: string; retainer: string; dueInDays?: number }) {
        const first = unique('Pay');
        await addLead(page, { firstName: first, eventDate: plusDays(90) });
        const form = await openBookingForm(page);
        await form.getByLabel('Package', { exact: true }).selectOption('custom');
        await form.getByLabel(/^Custom package name/).fill('Test day');
        await form.getByLabel(/^Custom price/).fill(options.total);
        await form.getByLabel(/^Retainer/).fill(options.retainer);
        await form.getByLabel(/^Balance due on/).fill(plusDays(options.dueInDays ?? 30));
        await form.getByRole('button', { name: 'Book this client' }).click();
        await expect(page.getByRole('status')).toHaveText('Booked! Their details are below.');
        return first;
    }
    const card = (page: Page) => page.locator('section.st-card', { has: page.getByRole('heading', { name: 'Test day' }) });

    test('records the retainer and the rest, with the balance and status following along', async ({ page }) => {
        await bookedClient(page, { total: '500', retainer: '100' });
        const booking = card(page);

        await booking.getByLabel('Amount received').fill('100');
        await booking.getByLabel('How it was paid').selectOption('venmo');
        await booking.getByLabel(/^Note \(/).fill('Retainer');
        await booking.getByRole('button', { name: 'Record payment' }).click();
        await expect(page.getByRole('status')).toHaveText('Payment recorded.');
        await expect(card(page)).toContainText('Retainer paid');
        await expect(card(page).locator('.st-money__total').nth(1)).toContainText('$400');
        await expect(card(page)).toContainText('$100 by Venmo');

        await card(page).getByLabel('Amount received').fill('$400.00');
        await card(page).getByLabel('How it was paid').selectOption('zelle');
        await card(page).getByRole('button', { name: 'Record payment' }).click();
        await expect(card(page)).toContainText('Paid in full');
        await expect(card(page).locator('.st-money__total').nth(1)).toContainText('$0');
        await expect(page.getByText('Payment received: $400 by zelle.')).toBeVisible();

        await card(page).getByRole('button', { name: /Remove the \$400 payment/ }).click();
        await expect(page.getByRole('status')).toHaveText('Payment removed.');
        await expect(card(page)).toContainText('Retainer paid');
        await expect(card(page).locator('.st-money__total').nth(1)).toContainText('$400');
    });

    test('rejects an amount that is not money', async ({ page }) => {
        await bookedClient(page, { total: '300', retainer: '0' });
        await card(page).getByLabel('Amount received').fill('lots');
        await card(page).getByRole('button', { name: 'Record payment' }).click();
        await expect(page.getByRole('alert')).toHaveText('Please check: Amount.');
        await expect(card(page)).toContainText('Nothing received yet.');
    });

    test('a balance due soon shows on Home until it is paid', async ({ page }) => {
        const first = await bookedClient(page, { total: '300', retainer: '0', dueInDays: 5 });
        await page.goto('/studio');
        const section = page.locator('section', { has: page.getByRole('heading', { name: /Balances due/ }) });
        await expect(section.getByRole('link', { name: new RegExp(first) })).toContainText('$300 still to receive for Test day');

        await section.getByRole('link', { name: new RegExp(first) }).click();
        await card(page).getByLabel('Amount received').fill('300');
        await card(page).getByRole('button', { name: 'Record payment' }).click();
        await page.goto('/studio');
        await expect(section.getByRole('link', { name: new RegExp(first) })).toHaveCount(0);
    });

    test('a balance due far in the future stays off Home', async ({ page }) => {
        const first = await bookedClient(page, { total: '300', retainer: '0', dueInDays: 60 });
        await page.goto('/studio');
        await expect(page.getByRole('link', { name: new RegExp(first) })).toHaveCount(0);
    });

    test('changing a package price later leaves existing bookings alone', async ({ page }) => {
        const pkg = unique('Fixed');
        await addPackage(page, pkg, '400');
        const first = unique('Fix');
        await addLead(page, { firstName: first });
        const form = await openBookingForm(page);
        await form.getByLabel('Package', { exact: true }).selectOption({ label: `${pkg} ($400)` });
        await form.getByRole('button', { name: 'Book this client' }).click();
        const leadUrl = page.url().split('?')[0]!;

        await page.goto('/studio/settings');
        const item = page.locator('.st-price-item', { hasText: pkg });
        await item.locator('summary').click();
        await item.getByLabel('Price').fill('999');
        await item.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('status')).toHaveText('Saved.');

        await page.goto(leadUrl);
        const booking = page.locator('section.st-card', { has: page.getByRole('heading', { name: pkg }) });
        await expect(booking.locator('.st-money__total').first()).toContainText('$400');
    });

    test('edits and removes a booking', async ({ page }) => {
        await bookedClient(page, { total: '300', retainer: '0' });
        await card(page).locator('summary', { hasText: 'Edit booking' }).click();
        await card(page).getByLabel(/^Total/).fill('350');
        await card(page).getByRole('button', { name: 'Save booking' }).click();
        await expect(page.getByRole('status')).toHaveText('Booking saved.');
        await expect(card(page).locator('.st-money__total').first()).toContainText('$350');

        await card(page).locator('summary', { hasText: 'Remove this booking' }).click();
        await card(page).getByRole('button', { name: 'Remove booking' }).click();
        await expect(page.getByRole('status')).toHaveText('Booking removed.');
        await expect(page.getByRole('heading', { name: 'Test day' })).toHaveCount(0);
    });
});

test.describe('Looks and accessibility', () => {
    test('Settings and a booked lead are accessible and fit a phone', async ({ page }) => {
        await addPackage(page, unique('Look'), '123');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/studio/settings');
        let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(results.violations).toEqual([]);

        await addLead(page, { firstName: unique('Lee') });
        const form = await openBookingForm(page);
        await form.getByLabel('Package', { exact: true }).selectOption('custom');
        await form.getByLabel(/^Custom package name/).fill('Test day');
        await form.getByLabel(/^Custom price/).fill('300');
        await form.getByRole('button', { name: 'Book this client' }).click();
        await expect(page.getByRole('status')).toHaveText('Booked! Their details are below.');
        // Open every folded section so the scan sees the forms too.
        for (let attempt = 0; attempt < 20 && (await page.locator('details:not([open]) > summary').count()) > 0; attempt += 1) {
            await page.locator('details:not([open]) > summary').first().click();
        }
        results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(results.violations).toEqual([]);

        await page.setViewportSize({ width: 390, height: 844 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
