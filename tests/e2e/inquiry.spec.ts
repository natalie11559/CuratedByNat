import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Each test posts from its own made-up visitor address, so the form's rate limit (5 a minute per visitor) never
// depends on how many other tests ran a moment ago. Cloudflare sets this header itself in production. It is
// added only to our own /api/inquiry requests: sent everywhere it would break the cross-origin Turnstile script.
const test = base.extend<{ visitor: string }>({
    visitor: async ({}, use) => {
        await use(`198.51.100.${Math.floor(Math.random() * 250) + 1}`);
    },
    page: async ({ page, visitor }, use) => {
        await page.route('**/api/inquiry', (route) =>
            route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': visitor } }),
        );
        await use(page);
    },
    request: async ({ playwright, baseURL, visitor }, use) => {
        const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'CF-Connecting-IP': visitor } });
        await use(context);
        await context.dispose();
    },
});

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const copy = JSON.parse(readFileSync(`${repoRoot}src/content/inquiry-form.json`, 'utf8'));
const site = JSON.parse(readFileSync(`${repoRoot}src/content/site.json`, 'utf8'));

/** The server quietly drops anything sent sooner than this after the page loaded. */
const MIN_FILL_MS = 3000;
const DUMMY_TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

interface InquiryRow {
    email: string;
    first_name: string;
    celebrating: string;
    event_date: string | null;
    end_date: string | null;
    email_status: string;
    payload: string;
}

/**
 * Runs a read-only query against the local D1 database the dev server writes to. Several tests do this at
 * once and SQLite briefly locks the file, so a failed attempt is simply tried again.
 */
function queryLocalD1<T>(sql: string): T[] {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            const output = execFileSync(
                'npx',
                ['wrangler', 'd1', 'execute', 'curatedbynat-inquiries', '--local', '--json', '--command', sql],
                { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
            );
            return JSON.parse(output)[0].results;
        } catch (error) {
            lastError = error;
            execFileSync('sleep', ['0.5']);
        }
    }
    throw lastError;
}

function inquiriesFor(email: string): InquiryRow[] {
    return queryLocalD1<InquiryRow>(
        `SELECT email, first_name, celebrating, event_date, end_date, email_status, payload FROM inquiries WHERE email = '${email}'`,
    );
}

interface LeadRow {
    id: string;
    first_name: string;
    stage: string;
    source: string;
    event_date: string | null;
    end_date: string | null;
    inquiries: number;
}

/** The Studio leads the dev server created. */
function leadsFor(email: string): LeadRow[] {
    return queryLocalD1<LeadRow>(
        `SELECT l.id, l.first_name, l.stage, l.source, l.event_date, l.end_date,
                (SELECT COUNT(*) FROM lead_inquiries li WHERE li.lead_id = l.id) AS inquiries
         FROM leads l WHERE l.email_key = lower('${email}')`,
    );
}

function uniqueEmail(label: string) {
    return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function openForm(page: Page) {
    await page.goto('/inquire');
    // The script marks the form novalidate once it has taken over validation.
    await expect(page.locator('[data-inquiry-form]')).toHaveAttribute('novalidate', '');
    return Date.now();
}

async function waitUntilHumanlyPossible(loadedAt: number) {
    const remaining = MIN_FILL_MS + 300 - (Date.now() - loadedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

async function fillValidForm(page: Page, email: string) {
    await page.getByLabel('First name').fill('Playwright');
    await page.getByLabel('Last name').fill('Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Phone').fill('(404) 555-0134');
    await page.getByLabel("Who's inquiring?").selectOption('The bride or couple');
    await page.getByRole('checkbox', { name: 'Wedding' }).check();
    await page.getByLabel('Event date').fill('2027-06-06');
    await page.getByLabel('Is your event in Georgia?').selectOption('yes');
    await page.getByLabel('City and venue').fill('Athens, The Foundry');
    await page.getByLabel('What part of the day are you most excited about?').fill('The first look <3 & the toasts');
}

const submitButton = (page: Page) => page.getByRole('button', { name: copy.submit.label });

test.describe('Inquiry form', () => {
    test('shows every required-field error and moves focus to the summary below the header', async ({ page }) => {
        await openForm(page);
        await submitButton(page).click();

        const summary = page.locator('[data-error-summary]');
        await expect(summary).toBeVisible();
        await expect(summary).toHaveAttribute('role', 'alert');
        await expect(summary).toHaveText(copy.messages.errorSummary);
        await expect(summary).toBeFocused();

        const required = ['firstName', 'lastName', 'email', 'phone', 'inquirer', 'eventDate', 'inGeorgia', 'location'];
        for (const name of required) {
            const input = page.locator(`#inquiry-${name}`);
            await expect(page.locator(`#inquiry-${name}-error`)).toHaveText(copy.fields[name].error);
            await expect(input).toHaveAttribute('aria-invalid', 'true');
            await expect(input).toHaveAttribute('aria-describedby', new RegExp(`inquiry-${name}-error`));
        }
        await expect(page.locator('#inquiry-celebrating-error')).toHaveText(copy.fields.celebrating.error);
        await expect(page.locator('[data-field="celebrating"]')).toHaveAttribute('aria-describedby', 'inquiry-celebrating-error');
        await expect(page.locator('#inquiry-instagram-error')).toBeHidden();

        // Scrolled so the summary sits 24px below the sticky header.
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const header = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
                    const summaryTop = document.querySelector('[data-error-summary]')?.getBoundingClientRect().top ?? 0;
                    return Math.round(summaryTop - header);
                }),
            )
            .toBe(24);

        // Once flagged, a field re-checks as the visitor types.
        await page.getByLabel('First name').fill('Sarah');
        await expect(page.locator('#inquiry-firstName-error')).toBeHidden();
        await expect(page.getByLabel('First name')).not.toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByLabel('First name')).not.toHaveAttribute('aria-describedby', /error/);
    });

    test('explains a badly formatted email', async ({ page }) => {
        await openForm(page);
        await page.getByLabel('Email').fill('sarah@gmail');
        await submitButton(page).click();
        await expect(page.locator('#inquiry-email-error')).toHaveText(copy.fields.email.formatError);
        await page.getByLabel('Email').fill('sarah@gmail.com');
        await expect(page.locator('#inquiry-email-error')).toBeHidden();
    });

    test('shows End date only for Bachelorette weekend or Celebration', async ({ page }) => {
        await openForm(page);
        const endDate = page.getByLabel('End date');
        await expect(endDate).toBeHidden();

        await page.getByRole('checkbox', { name: 'Bachelorette weekend' }).check();
        await expect(endDate).toBeVisible();
        await expect(endDate).toBeEnabled();
        await page.getByRole('checkbox', { name: 'Bachelorette weekend' }).uncheck();
        await expect(endDate).toBeHidden();

        await page.getByRole('checkbox', { name: /^Celebration/ }).check();
        await expect(endDate).toBeVisible();
        await page.getByRole('checkbox', { name: /^Celebration/ }).uncheck();

        await page.getByRole('checkbox', { name: 'Wedding' }).check();
        await page.getByRole('checkbox', { name: /^Bridal event/ }).check();
        await expect(endDate).toBeHidden();
    });

    test("disables Event date when the date isn't set yet", async ({ page }) => {
        await openForm(page);
        const eventDate = page.getByLabel('Event date');
        await page.getByLabel(copy.fields.dateNotSet.label).check();
        await expect(eventDate).toBeDisabled();

        await submitButton(page).click();
        await expect(page.locator('#inquiry-firstName-error')).toBeVisible();
        await expect(page.locator('#inquiry-eventDate-error')).toBeHidden();

        await page.getByLabel(copy.fields.dateNotSet.label).uncheck();
        await expect(eventDate).toBeEnabled();
        await submitButton(page).click();
        await expect(page.locator('#inquiry-eventDate-error')).toHaveText(copy.fields.eventDate.error);
    });

    test('shows the destination note for destination events', async ({ page }) => {
        await openForm(page);
        const georgia = page.getByLabel('Is your event in Georgia?');
        const note = page.locator('[data-destination-note]');
        await expect(note).toBeHidden();

        await georgia.selectOption('destination');
        await expect(note).toBeVisible();
        await expect(note).toHaveText(copy.fields.inGeorgia.destinationNote);
        await expect(georgia).toHaveAttribute('aria-describedby', /inquiry-inGeorgia-note/);

        await georgia.selectOption('yes');
        await expect(note).toBeHidden();
    });

    test('sends an inquiry end to end: success panel, D1 backup row, dev-captured email', async ({ page }) => {
        const email = uniqueEmail('success');
        const loadedAt = await openForm(page);
        await fillValidForm(page, email);
        await page.getByRole('checkbox', { name: 'Bachelorette weekend' }).check();
        await page.getByLabel('End date').fill('2027-06-08');
        await waitUntilHumanlyPossible(loadedAt);

        // Hold the request briefly to see the loading state.
        let release = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        await page.route('**/api/inquiry', async (route) => {
            await held;
            await route.continue();
        });

        await submitButton(page).click();
        const sending = page.locator('[data-submit-button]');
        await expect(sending).toBeDisabled();
        await expect(sending).toHaveText(copy.submit.loadingLabel);
        // Focus stays on the button (aria-disabled, not disabled) and the state is announced.
        await expect(sending).toHaveAttribute('aria-disabled', 'true');
        await expect(sending).toBeFocused();
        await expect(page.locator('[data-sending-status]')).toHaveText(copy.submit.loadingLabel);
        release();

        const heading = page.getByRole('heading', { name: copy.success.heading });
        await expect(heading).toBeVisible({ timeout: 30_000 });
        await expect(heading).toBeFocused();
        await expect(page.locator('[data-inquiry-form]')).toBeHidden();
        await expect(page.locator('[data-success-panel]')).toHaveAttribute('role', 'status');
        // With the fade-up playing, the panel still settles 24px below the sticky header.
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const header = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
                    const panelTop = document.querySelector('[data-success-panel]')?.getBoundingClientRect().top ?? 0;
                    return Math.round(panelTop - header);
                }),
            )
            .toBe(24);
        await expect(page.getByRole('link', { name: new RegExp(copy.success.buttonLabel) })).toHaveAttribute(
            'href',
            site.social.instagramUrl,
        );
        await expect(page.getByRole('heading', { name: 'What happens next' })).toBeVisible();

        const rows = inquiriesFor(email);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            first_name: 'Playwright',
            celebrating: 'Wedding, Bachelorette weekend',
            event_date: '2027-06-06',
            end_date: '2027-06-08',
            email_status: 'dev-captured',
        });
        expect(JSON.parse(rows[0].payload)).toMatchObject({
            email,
            inquirer: 'The bride or couple',
            inGeorgia: 'yes',
            excitedAbout: 'The first look <3 & the toasts',
        });

        // The inquiry also became a lead in Studio's pipeline.
        expect(leadsFor(email)).toMatchObject([
            { first_name: 'Playwright', stage: 'new', source: 'website', event_date: '2027-06-06', end_date: '2027-06-08', inquiries: 1 },
        ]);
    });

    test('silently drops a submission with the honeypot filled', async ({ page }) => {
        const email = uniqueEmail('honeypot');
        const loadedAt = await openForm(page);
        await fillValidForm(page, email);
        await page.locator('input[name="website"]').evaluate((input: HTMLInputElement) => {
            input.value = 'https://cheap-backlinks.example';
        });
        await waitUntilHumanlyPossible(loadedAt);
        await submitButton(page).click();

        await expect(page.getByRole('heading', { name: copy.success.heading })).toBeVisible({ timeout: 30_000 });
        expect(inquiriesFor(email)).toHaveLength(0);
    });

    test('can be completed with the keyboard alone', async ({ page }) => {
        const email = uniqueEmail('keyboard');
        const loadedAt = await openForm(page);

        const focusedId = () => page.evaluate(() => document.activeElement?.id ?? '');
        const tabTo = async (predicate: () => Promise<boolean>, limit = 40) => {
            for (let presses = 0; presses < limit; presses += 1) {
                if (await predicate()) return;
                await page.keyboard.press('Tab');
            }
            throw new Error('Could not reach the element with Tab');
        };

        await tabTo(async () => (await focusedId()) === 'inquiry-firstName');
        await page.keyboard.type('Keyboard');
        await page.keyboard.press('Tab');
        await page.keyboard.type('Only');
        await page.keyboard.press('Tab');
        await page.keyboard.type(email);
        await page.keyboard.press('Tab');
        await page.keyboard.type('404 555 0134');
        await page.keyboard.press('Tab');
        await page.keyboard.type('@keyboard');
        await page.keyboard.press('Tab');
        await page.keyboard.type('Maid'); // Picks "Maid of honor or bridesmaid" in the closed dropdown.
        await page.keyboard.press('Tab');
        await page.keyboard.press('Space'); // Wedding
        await page.keyboard.press('Tab');
        await page.keyboard.press('Space'); // Bachelorette weekend, which reveals End date
        // Tab also steps through the month, day and year parts of a date input.
        await tabTo(async () => (await focusedId()) === 'inquiry-eventDate');
        await page.keyboard.type('06062027');
        await tabTo(async () => (await focusedId()) === 'inquiry-endDate');
        await page.keyboard.type('06082027');
        await expect(page.getByLabel('Event date')).toHaveValue('2027-06-06');
        await expect(page.getByLabel('End date')).toHaveValue('2027-06-08');
        await tabTo(async () => (await focusedId()) === 'inquiry-inGeorgia');
        await page.keyboard.type('Y');
        await page.keyboard.press('Tab');
        await page.keyboard.type('Savannah');
        await tabTo(() => page.evaluate(() => document.activeElement?.hasAttribute('data-submit-button') ?? false));

        await waitUntilHumanlyPossible(loadedAt);
        await page.keyboard.press('Enter');

        await expect(page.getByRole('heading', { name: copy.success.heading })).toBeFocused({ timeout: 30_000 });
        const rows = inquiriesFor(email);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            celebrating: 'Wedding, Bachelorette weekend',
            event_date: '2027-06-06',
            end_date: '2027-06-08',
            email_status: 'dev-captured',
        });
    });

    test('shows the send-failure message after a failed plain post', async ({ page }) => {
        await page.goto('/inquire?status=error');
        const summary = page.locator('[data-error-summary]');
        await expect(summary).toHaveText(copy.messages.sendFailure);
        await expect(summary).toBeFocused();
        await expect(page).toHaveURL(/\/inquire$/);
    });

    test('keeps what was typed and explains when sending fails', async ({ page }) => {
        const loadedAt = await openForm(page);
        await fillValidForm(page, uniqueEmail('failure'));
        await waitUntilHumanlyPossible(loadedAt);
        await page.route('**/api/inquiry', (route) =>
            route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, errors: {} }) }),
        );
        await submitButton(page).click();

        await expect(page.locator('[data-error-summary]')).toHaveText(copy.messages.sendFailure);
        await expect(page.getByLabel('First name')).toHaveValue('Playwright');
        await expect(submitButton(page)).toBeEnabled();
    });

    test('has no automatically detectable accessibility problems', async ({ page }) => {
        // Reduced motion skips the scroll-reveal fade, which would otherwise be caught mid-way.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openForm(page);
        const scan = () => new AxeBuilder({ page }).include('main').analyze();
        expect((await scan()).violations).toEqual([]);

        await page.getByRole('checkbox', { name: 'Celebration' }).check();
        await page.getByLabel('Is your event in Georgia?').selectOption('destination');
        await submitButton(page).click();
        await expect(page.locator('[data-error-summary]')).toBeVisible();
        expect((await scan()).violations).toEqual([]);
    });
});

test.describe('Inquiry API', () => {
    const validPayload = () => ({
        firstName: 'Api',
        lastName: 'Tester',
        email: uniqueEmail('api'),
        phone: '404-555-0134',
        inquirer: 'Friend or host',
        celebrating: ['celebration'],
        eventDate: '2027-10-10',
        inGeorgia: 'not-sure',
        location: 'Macon',
        startedAt: Date.now() - 60_000,
        submittedAt: Date.now(),
        'cf-turnstile-response': DUMMY_TURNSTILE_TOKEN,
    });

    test('rejects a bad payload posted directly, with the same messages as the form', async ({ request }) => {
        const payload = {
            ...validPayload(),
            firstName: '   ',
            email: 'not-an-email',
            phone: '12',
            celebrating: ['wedding', 'made-up'],
            inquirer: 'Somebody',
            inGeorgia: 'Maybe',
            celebratingExtra: 'ignored',
            anythingElse: 'x'.repeat(5000),
        };
        const response = await request.post('/api/inquiry', { data: payload });
        expect(response.status()).toBe(400);
        const body = await response.json();
        expect(body).toEqual({
            ok: false,
            message: copy.messages.errorSummary,
            errors: {
                firstName: copy.fields.firstName.error,
                email: copy.fields.email.formatError,
                phone: copy.fields.phone.formatError,
                inquirer: copy.fields.inquirer.error,
                celebrating: copy.fields.celebrating.error,
                inGeorgia: copy.fields.inGeorgia.error,
                anythingElse: copy.messages.tooLong,
            },
        });
        expect(inquiriesFor(payload.email)).toHaveLength(0);
    });

    test('fails closed without a Turnstile token', async ({ request }) => {
        const payload = { ...validPayload(), 'cf-turnstile-response': '' };
        const response = await request.post('/api/inquiry', { data: payload });
        expect(response.status()).toBe(403);
        expect(await response.json()).toEqual({ ok: false, errors: {}, message: copy.messages.sendFailure });
        expect(inquiriesFor(payload.email)).toHaveLength(0);
    });

    test('drops a submission sent within 3 seconds of loading the form', async ({ request }) => {
        const payload = { ...validPayload(), startedAt: Date.now() - 1000, submittedAt: Date.now() };
        const response = await request.post('/api/inquiry', { data: payload });
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(inquiriesFor(payload.email)).toHaveLength(0);
    });

    test('accepts a plain HTML form post and redirects to the thank-you page', async ({ request, baseURL }) => {
        const payload = validPayload();
        const form: Record<string, string> = {};
        for (const [key, value] of Object.entries(payload)) form[key] = Array.isArray(value) ? value[0] : String(value);
        const response = await request.post('/api/inquiry', { form, headers: { Origin: baseURL ?? '' }, maxRedirects: 0 });
        expect(response.status()).toBe(303);
        expect(response.headers().location).toBe('/inquire/thanks');
        expect(inquiriesFor(payload.email)).toMatchObject([{ email_status: 'dev-captured', celebrating: 'Celebration' }]);

        const failed = await request.post('/api/inquiry', {
            form: { ...form, 'cf-turnstile-response': '' },
            headers: { Origin: baseURL ?? '' },
            maxRedirects: 0,
        });
        expect(failed.status()).toBe(303);
        expect(failed.headers().location).toBe('/inquire?status=error');
    });

    test('adds each inquiry to Studio, and a second one from the same address joins the same lead', async ({ request }) => {
        const payload = validPayload();
        const first = await request.post('/api/inquiry', { data: payload });
        expect(first.status()).toBe(200);
        expect(leadsFor(payload.email)).toMatchObject([{ first_name: 'Api', stage: 'new', source: 'website', inquiries: 1 }]);

        const again = await request.post('/api/inquiry', {
            data: { ...payload, email: payload.email.toUpperCase(), firstName: 'Api again', startedAt: Date.now() - 60_000, submittedAt: Date.now() },
        });
        expect(again.status()).toBe(200);
        expect(await again.json()).toEqual({ ok: true });

        const leads = leadsFor(payload.email);
        expect(leads).toHaveLength(1);
        expect(leads[0]).toMatchObject({ first_name: 'Api', inquiries: 2 });
        expect(inquiriesFor(payload.email)).toHaveLength(1);
        expect(inquiriesFor(payload.email.toUpperCase())).toHaveLength(1);
    });

    test('only takes POST requests of a sensible size', async ({ request }) => {
        const get = await request.get('/api/inquiry');
        expect(get.status()).toBe(405);
        expect(get.headers().allow).toBe('POST');

        const huge = await request.post('/api/inquiry', {
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ anythingElse: 'x'.repeat(40 * 1024) }),
        });
        expect(huge.status()).toBe(413);
    });
});

test('the thank-you page shows the success panel and is hidden from search', async ({ page }) => {
    await page.goto('/inquire/thanks');
    await expect(page.getByRole('heading', { level: 1, name: copy.success.heading })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(page.getByRole('heading', { name: 'What happens next' })).toBeVisible();
});
