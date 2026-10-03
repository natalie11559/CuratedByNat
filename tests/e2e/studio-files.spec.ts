import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addLead, unique } from './helpers/studio';

// Files and contracts, against the development server where the sign-in shortcut is on.

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of a picture')]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic')]);

async function upload(page: Page, name: string, buffer: Buffer, mimeType: string, kind: 'Signed contract' | 'Something else') {
    await page.locator('#upload-file').setInputFiles({ name, mimeType, buffer });
    await page.locator('#upload-kind').selectOption({ label: kind });
    await page.getByRole('button', { name: 'Save file' }).click();
}

test.describe('Files on a lead', () => {
    test('uploads a signed contract, lists it first, opens it, downloads it and removes it', async ({ page, request }) => {
        await addLead(page, { firstName: unique('Fil') });
        await upload(page, 'Fil contract.pdf', PDF, 'application/pdf', 'Signed contract');
        await expect(page.getByRole('status')).toHaveText('File saved.');

        const files = page.locator('#files');
        const item = files.locator('.st-file', { hasText: 'Fil contract.pdf' });
        await expect(item).toContainText('Signed contract');
        await expect(item).toContainText(`${PDF.length} B`);
        await expect(page.getByText(/Added a signed contract \(PDF, \d+ B\)\./)).toBeVisible();

        const viewHref = await item.getByRole('link', { name: /^View/ }).getAttribute('href');
        const view = await request.get(viewHref!);
        expect(view.status()).toBe(200);
        expect(view.headers()['content-type']).toBe('application/pdf');
        expect(view.headers()['content-disposition']).toMatch(/^inline; filename="Fil contract\.pdf"/);
        expect(view.headers()['x-content-type-options']).toBe('nosniff');
        expect(view.headers()['cache-control']).toBe('no-store, private');
        expect(view.headers()['x-robots-tag']).toBe('noindex, nofollow');
        expect(Buffer.from(await view.body()).equals(PDF)).toBe(true);

        const download = await request.get(`${viewHref}?download=1`);
        expect(download.headers()['content-disposition']).toMatch(/^attachment; /);

        await item.getByRole('button', { name: 'Remove Fil contract.pdf' }).click();
        await expect(page.getByRole('status')).toHaveText('File removed. It is kept for 30 days in case you need it back.');
        await expect(files.locator('.st-file')).toHaveCount(0);
        expect((await request.get(viewHref!)).status()).toBe(404);
    });

    test('keeps a phone photo (HEIC) as a download only, and shows pictures inline', async ({ page, request }) => {
        await addLead(page, { firstName: unique('Pic') });
        await upload(page, 'IMG_0042.HEIC', HEIC, 'image/heic', 'Something else');
        await upload(page, 'inspiration.png', PNG, 'image/png', 'Something else');

        const heic = page.locator('.st-file', { hasText: 'IMG_0042.HEIC' });
        await expect(heic.getByRole('link', { name: /^View/ })).toHaveCount(0);
        const heicHref = await heic.getByRole('link', { name: /^Download/ }).getAttribute('href');
        const heicResponse = await request.get(heicHref!.replace('?download=1', ''));
        expect(heicResponse.headers()['content-type']).toBe('image/heic');
        expect(heicResponse.headers()['content-disposition']).toMatch(/^attachment; /);

        const png = page.locator('.st-file', { hasText: 'inspiration.png' });
        const pngResponse = await request.get((await png.getByRole('link', { name: /^View/ }).getAttribute('href'))!);
        expect(pngResponse.headers()['content-disposition']).toMatch(/^inline; /);
    });

    test('refuses a web page dressed up as a PDF, an empty file and a file that is too big', async ({ page }) => {
        await addLead(page, { firstName: unique('Bad') });
        await upload(page, 'totally-a.pdf', Buffer.from('<script>alert(1)</script>'), 'application/pdf', 'Something else');
        await expect(page.getByRole('alert')).toHaveText('Studio keeps PDFs and photos (JPG, PNG or HEIC). That file looks like something else.');

        await page.locator('#upload-file').setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
        await page.locator('#upload-file').evaluate((input: HTMLInputElement) => input.removeAttribute('required'));
        await page.getByRole('button', { name: 'Save file' }).click();
        await expect(page.getByRole('alert')).toHaveText('Choose a file first.');

        const tooBig = Buffer.alloc(26 * 1024 * 1024);
        PDF.copy(tooBig);
        await upload(page, 'huge.pdf', tooBig, 'application/pdf', 'Something else');
        await expect(page.getByRole('alert')).toHaveText('That file is over 25 MB. Try a smaller scan or photo.');
        await expect(page.locator('.st-file')).toHaveCount(0);
    });

    test('a booked client without a contract is nudged, until one is uploaded', async ({ page }) => {
        await addLead(page, { firstName: unique('Nud') });
        const form = page.locator('summary', { hasText: /^Book / });
        await form.click();
        const bookingForm = page.locator('form[action$="/book"]');
        await bookingForm.getByLabel('Package', { exact: true }).selectOption('custom');
        await bookingForm.getByLabel(/^Custom package name/).fill('Test day');
        await bookingForm.getByLabel(/^Custom price/).fill('300');
        await bookingForm.getByRole('button', { name: 'Book this client' }).click();

        const nudge = page.locator('.st-callout');
        await expect(nudge).toContainText('No signed contract yet.');
        await nudge.getByRole('link', { name: 'Upload it under Files' }).click();
        await expect(page).toHaveURL(/#files$/);

        await upload(page, 'signed.pdf', PDF, 'application/pdf', 'Signed contract');
        await expect(page.getByRole('status')).toHaveText('File saved.');
        await expect(page.locator('.st-callout')).toHaveCount(0);
    });

    test('a file that is not yours to open gets a plain 404, and bad ids never reach the database', async ({ request }) => {
        expect((await request.get('/api/studio/files/123e4567-e89b-42d3-a456-426614174000')).status()).toBe(404);
        expect((await request.get('/api/studio/files/not-an-id')).status()).toBe(404);
        const post = await request.post('/api/studio/files/123e4567-e89b-42d3-a456-426614174000/delete', { headers: { Origin: 'https://evil.example' } });
        expect(post.status()).toBe(403);
    });

    test('uploads from another site are refused', async ({ request }) => {
        const response = await request.post('/api/studio/leads/123e4567-e89b-42d3-a456-426614174000/upload', {
            multipart: { kind: 'other', file: { name: 'x.pdf', mimeType: 'application/pdf', buffer: PDF } },
            headers: { Origin: 'https://evil.example' },
        });
        expect(response.status()).toBe(403);
    });

    test('the Files card is accessible and fits a phone', async ({ page }) => {
        await addLead(page, { firstName: unique('Acc') });
        await upload(page, 'a very long file name that could push the page wider than the phone screen.pdf', PDF, 'application/pdf', 'Signed contract');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(results.violations).toEqual([]);

        await page.setViewportSize({ width: 390, height: 844 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        for (const control of await page.locator('#files a:visible, #files button:visible, #files select:visible').all()) {
            expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
        }
    });
});
