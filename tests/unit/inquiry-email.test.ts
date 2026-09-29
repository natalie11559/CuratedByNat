// Run with: npm run test:unit (node --experimental-strip-types --test tests/unit/)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { answeredQuestions, buildInquiryEmail, escapeHtml, formatDate, sendWithResend } from '../../src/lib/inquiry/email.ts';
import type { InquirySubmission } from '../../src/lib/inquiry/validate.ts';

const content = JSON.parse(readFileSync(new URL('../../src/content/inquiry-form.json', import.meta.url), 'utf8'));

const submission: InquirySubmission = {
    firstName: 'Sarah',
    lastName: 'Smith',
    email: 'sarah@example.com',
    phone: '(404) 555-0134',
    instagram: '',
    inquirer: 'Maid of honor or bridesmaid',
    celebrating: ['wedding', 'bachelorette'],
    eventDate: '2027-06-06',
    dateNotSet: false,
    endDate: '2027-06-08',
    inGeorgia: 'destination',
    location: 'Savannah <The Olde Pink House>',
    photoVideo: '',
    excitedAbout: 'Getting ready\nwith the girls & mom',
    anythingElse: '',
    foundVia: 'TikTok',
};

const meta = { id: '0f9c2b6e-test', receivedAt: '2026-09-27T18:05:09.000Z' };

describe('inquiry email', () => {
    it('formats dates without time zone shifts', () => {
        assert.equal(formatDate('2027-06-06'), 'June 6, 2027');
        assert.equal(formatDate('2027-01-01'), 'January 1, 2027');
    });

    it('has a subject with the name, celebration and date', () => {
        const email = buildInquiryEmail(submission, content, meta);
        assert.equal(email.subject, 'New inquiry: Sarah Smith, Wedding & Bachelorette weekend, June 6, 2027');
        const undated = buildInquiryEmail({ ...submission, eventDate: null, dateNotSet: true }, content, meta);
        assert.equal(undated.subject, 'New inquiry: Sarah Smith, Wedding & Bachelorette weekend, date not set yet');
    });

    it('lists every answered question with its label, skipping empty ones', () => {
        const rows = answeredQuestions(submission, content);
        const labels = rows.map((row) => row.label);
        assert.ok(labels.includes('First name'));
        assert.ok(labels.includes('End date (for weekends and multi-day events)'));
        assert.ok(!labels.includes('Instagram handle'));
        assert.ok(!labels.includes('Anything else I should know?'));
        const byName = Object.fromEntries(rows.map((row) => [row.name, row.value]));
        assert.equal(byName.celebrating, 'Wedding, Bachelorette weekend');
        assert.equal(byName.inGeorgia, "No, it's a destination event");
        assert.equal(byName.eventDate, 'June 6, 2027');
    });

    it('shows the date-not-set answer in place of a date', () => {
        const rows = answeredQuestions({ ...submission, eventDate: null, dateNotSet: true, endDate: null }, content);
        const eventDate = rows.find((row) => row.name === 'eventDate');
        assert.equal(eventDate?.value, "My date isn't set yet");
    });

    it('escapes answers in the HTML body and keeps them readable in the text body', () => {
        const email = buildInquiryEmail(submission, content, meta);
        assert.ok(email.html.includes('Savannah &lt;The Olde Pink House&gt;'));
        assert.ok(!email.html.includes('<The Olde Pink House>'));
        assert.ok(email.html.includes('Getting ready<br>with the girls &amp; mom'));
        assert.ok(email.html.includes('Who&#39;s inquiring?'));
        assert.ok(email.text.includes('Savannah <The Olde Pink House>'));
        assert.ok(email.text.includes("Who's inquiring?\nMaid of honor or bridesmaid"));
        assert.ok(email.text.includes('Inquiry ID: 0f9c2b6e-test'));
        assert.ok(email.text.includes('Received September 27, 2026 at 2:05 PM Eastern time.'));
        assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    });
});

describe('sendWithResend', () => {
    const email = buildInquiryEmail(submission, content, meta);

    it('posts the email to Resend with the visitor as reply-to', async () => {
        let request: { url: string; init: RequestInit } | undefined;
        const fetcher = (async (url: string, init: RequestInit) => {
            request = { url, init };
            return new Response(JSON.stringify({ id: 'email_123' }), { status: 200 });
        }) as unknown as typeof fetch;

        const result = await sendWithResend({
            apiKey: 're_test',
            from: 'Curated by Nat website <website@curatedbynat.com>',
            to: 'hello@curatedbynat.com',
            replyTo: 'sarah@example.com',
            email,
            idempotencyKey: 'inquiry-1',
            fetcher,
        });

        assert.deepEqual(result, { ok: true, id: 'email_123' });
        assert.equal(request?.url, 'https://api.resend.com/emails');
        const headers = request?.init.headers as Record<string, string>;
        assert.equal(headers.Authorization, 'Bearer re_test');
        assert.equal(headers['Idempotency-Key'], 'inquiry-1');
        const body = JSON.parse(String(request?.init.body));
        assert.deepEqual(body.to, ['hello@curatedbynat.com']);
        assert.equal(body.reply_to, 'sarah@example.com');
        assert.equal(body.subject, email.subject);
        assert.equal(body.text, email.text);
        assert.equal(body.html, email.html);
    });

    it('reports failures instead of throwing', async () => {
        const rejected = (async () =>
            new Response(JSON.stringify({ message: 'Domain not verified' }), { status: 403 })) as unknown as typeof fetch;
        const offline = (async () => {
            throw new Error('network down');
        }) as unknown as typeof fetch;
        const base = { apiKey: 're_test', from: 'a@b.co', to: 'c@d.co', replyTo: 'e@f.co', email, idempotencyKey: 'k' };

        assert.deepEqual(await sendWithResend({ ...base, fetcher: rejected }), {
            ok: false,
            error: 'Resend responded 403: Domain not verified',
        });
        assert.deepEqual(await sendWithResend({ ...base, fetcher: offline }), { ok: false, error: 'network down' });
    });
});
