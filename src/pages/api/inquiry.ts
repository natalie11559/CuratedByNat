// Receives inquiries from the form on /inquire. Runs on Cloudflare Workers; the rest of the site is static.
// Order: size limit, honeypot, timing check, Turnstile, validation, save to D1, email Nat through Resend,
// then add the inquiry to Studio as a lead (which can never affect the answer the visitor gets).
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { D1Database } from '../../lib/cloudflare';
import { inquiryForm } from '../../lib/content';
import { buildInquiryEmail, celebrationLabels, sendWithResend } from '../../lib/inquiry/email';
import {
    HONEYPOT_FIELD,
    MIN_FILL_MILLISECONDS,
    STARTED_AT_FIELD,
    SUBMITTED_AT_FIELD,
    TURNSTILE_FIELD,
} from '../../lib/inquiry/fields';
import {
    inquiryInputFromForm,
    rulesFromContent,
    validateInquiry,
    type FieldErrors,
    type InquiryInput,
    type InquirySubmission,
} from '../../lib/inquiry/validate';
import { tryLinkInquiry } from '../../lib/studio/leads';

export const prerender = false;

/** Comfortably above the largest real inquiry (every answer at its length cap plus the Turnstile token). */
const MAX_BODY_BYTES = 32 * 1024;
const MAX_TURNSTILE_TOKEN_LENGTH = 2048;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Must match the `action` the form passes to turnstile.render(). */
const TURNSTILE_ACTION = 'inquiry';
const THANKS_PATH = '/inquire/thanks';
const ERROR_PATH = '/inquire?status=error';

interface RateLimiter {
    limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface InquiryEnv {
    DB?: D1Database;
    INQUIRY_RATE_LIMITER?: RateLimiter;
    INQUIRY_TO?: string;
    INQUIRY_FROM?: string;
    TURNSTILE_SECRET_KEY?: string;
    RESEND_API_KEY?: string;
}

type RequestKind = 'json' | 'form';

type Outcome = { ok: true } | { ok: false; errors: FieldErrors; message: string };

interface ParsedRequest {
    input: InquiryInput;
    honeypot: string;
    startedAt: number | null;
    submittedAt: number | null;
    token: string;
}

const bindings = env as unknown as InquiryEnv;
const rules = rulesFromContent(inquiryForm);
const success: Outcome = { ok: true };
const sendFailure: Outcome = { ok: false, errors: {}, message: inquiryForm.messages.sendFailure };

function requestKind(request: Request): RequestKind | null {
    const mediaType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (mediaType === 'application/json') return 'json';
    if (mediaType === 'application/x-www-form-urlencoded') return 'form';
    return null;
}

function jsonResponse(status: number, outcome: Outcome, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(outcome), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
    });
}

/** The enhanced form gets JSON; a plain HTML form post is redirected to a page. */
function reply(kind: RequestKind, status: number, outcome: Outcome): Response {
    if (kind === 'json') return jsonResponse(status, outcome);
    return new Response(null, {
        status: 303,
        headers: { Location: outcome.ok ? THANKS_PATH : ERROR_PATH, 'Cache-Control': 'no-store' },
    });
}

/** Reads the body as text, giving up (null) as soon as it passes `limit` bytes. */
async function readBody(request: Request, limit: number): Promise<string | null> {
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (declaredLength > limit) return null;
    if (!request.body) return '';

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function timestampValue(value: unknown): number | null {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
    return Number.isFinite(number) && number > 0 ? number : null;
}

function parseBody(kind: RequestKind, body: string): ParsedRequest | null {
    if (kind === 'json') {
        let data: unknown;
        try {
            data = JSON.parse(body);
        } catch {
            return null;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        const record = data as Record<string, unknown>;
        return {
            input: record as InquiryInput,
            honeypot: stringValue(record[HONEYPOT_FIELD]),
            startedAt: timestampValue(record[STARTED_AT_FIELD]),
            submittedAt: timestampValue(record[SUBMITTED_AT_FIELD]),
            token: stringValue(record[TURNSTILE_FIELD]),
        };
    }

    const params = new URLSearchParams(body);
    return {
        input: inquiryInputFromForm(params),
        honeypot: params.get(HONEYPOT_FIELD) ?? '',
        startedAt: timestampValue(params.get(STARTED_AT_FIELD)),
        submittedAt: timestampValue(params.get(SUBMITTED_AT_FIELD)),
        token: params.get(TURNSTILE_FIELD) ?? '',
    };
}

/**
 * The page records when it loaded and when Send was pressed, both on the visitor's own clock, so
 * a wrong clock cannot make a real person look like a bot. Without a start time the check is
 * skipped and Turnstile decides.
 */
function sentTooSoon({ startedAt, submittedAt }: ParsedRequest): boolean {
    if (startedAt === null) return false;
    return (submittedAt ?? Date.now()) - startedAt < MIN_FILL_MILLISECONDS;
}

/** Server-side Turnstile check. Fails closed: any doubt means no. */
async function isHuman(token: string, remoteIp: string | null, expectedHostname: string): Promise<boolean> {
    const secret = bindings.TURNSTILE_SECRET_KEY;
    if (!secret) {
        console.error('[inquiry] TURNSTILE_SECRET_KEY is not set, so no inquiry can be accepted.');
        return false;
    }
    if (!token || token.length > MAX_TURNSTILE_TOKEN_LENGTH) return false;

    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    if (remoteIp) form.append('remoteip', remoteIp);

    try {
        const response = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(8000) });
        if (!response.ok) {
            console.error(`[inquiry] Turnstile verification responded ${response.status}.`);
            return false;
        }
        const result = (await response.json()) as {
            success?: boolean;
            'error-codes'?: string[];
            hostname?: string;
            action?: string;
            metadata?: { result_with_testing_key?: boolean };
        };
        if (result.success !== true) {
            console.warn('[inquiry] Turnstile rejected a submission:', result['error-codes'] ?? []);
            return false;
        }
        // Cloudflare's test keys pass every token, so they are only acceptable in local development.
        const usedTestingKey = result.metadata?.result_with_testing_key === true;
        if (usedTestingKey && !import.meta.env.DEV) {
            console.error('[inquiry] TURNSTILE_SECRET_KEY is a test key; set the real secret. Submission rejected.');
            return false;
        }
        // The token must come from the widget on this site's own form.
        if (!usedTestingKey && result.hostname !== expectedHostname) {
            console.warn(`[inquiry] Turnstile token was issued for another hostname (${result.hostname ?? 'none'}).`);
            return false;
        }
        if (result.action && result.action !== TURNSTILE_ACTION) {
            console.warn(`[inquiry] Turnstile token was issued for another action (${result.action}).`);
            return false;
        }
        return true;
    } catch (error) {
        console.error('[inquiry] Turnstile verification failed:', error);
        return false;
    }
}

async function saveInquiry(db: D1Database, id: string, createdAt: string, submission: InquirySubmission): Promise<void> {
    await db
        .prepare(
            `INSERT INTO inquiries
                (id, created_at, first_name, last_name, email, phone, celebrating, event_date, end_date, location, payload, email_status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending')`,
        )
        .bind(
            id,
            createdAt,
            submission.firstName,
            submission.lastName,
            submission.email,
            submission.phone,
            celebrationLabels(submission.celebrating, inquiryForm).join(', '),
            submission.eventDate,
            submission.endDate,
            submission.location,
            JSON.stringify(submission),
        )
        .run();
}

type Delivery = { status: 'sent'; emailId: string } | { status: 'failed'; error: string } | { status: 'dev-captured' };

async function emailInquiry(id: string, createdAt: string, submission: InquirySubmission): Promise<Delivery> {
    const email = buildInquiryEmail(submission, inquiryForm, { id, receivedAt: createdAt });
    const { RESEND_API_KEY: apiKey, INQUIRY_TO: to, INQUIRY_FROM: from } = bindings;

    if (!apiKey && !import.meta.env.DEV) {
        const error = 'RESEND_API_KEY is not set.';
        console.error(`[inquiry] Email for inquiry ${id} not sent: ${error} The inquiry is saved in D1.`);
        return { status: 'failed', error };
    }

    if (!apiKey) {
        // Local development: nothing is sent, the email is printed so it can be checked.
        console.log(
            [
                '[inquiry] RESEND_API_KEY is not set, so this email was not sent. It would have been:',
                `From: ${from ?? '(INQUIRY_FROM not set)'}`,
                `To: ${to ?? '(INQUIRY_TO not set)'}`,
                `Reply-To: ${submission.email}`,
                `Subject: ${email.subject}`,
                '',
                email.text,
            ].join('\n'),
        );
        return { status: 'dev-captured' };
    }

    if (!to || !from) {
        const error = 'INQUIRY_TO or INQUIRY_FROM is not set.';
        console.error(`[inquiry] Email for inquiry ${id} not sent: ${error}`);
        return { status: 'failed', error };
    }

    const result = await sendWithResend({
        apiKey,
        from,
        to,
        replyTo: submission.email,
        email,
        idempotencyKey: `inquiry-${id}`,
    });
    if (result.ok) return { status: 'sent', emailId: result.id };
    console.error(`[inquiry] Email for inquiry ${id} failed (the inquiry is saved in D1): ${result.error}`);
    return { status: 'failed', error: result.error };
}

async function recordDelivery(db: D1Database, id: string, delivery: Delivery): Promise<void> {
    try {
        await db
            .prepare('UPDATE inquiries SET email_status = ?1, email_id = ?2, email_error = ?3 WHERE id = ?4')
            .bind(
                delivery.status,
                delivery.status === 'sent' ? delivery.emailId : null,
                delivery.status === 'failed' ? delivery.error.slice(0, 500) : null,
                id,
            )
            .run();
    } catch (error) {
        console.error(`[inquiry] Could not record the email status for inquiry ${id}:`, error);
    }
}

export const POST: APIRoute = async ({ request }) => {
    const kind = requestKind(request);
    if (!kind) return jsonResponse(415, sendFailure);

    const body = await readBody(request, MAX_BODY_BYTES);
    if (body === null) return reply(kind, 413, sendFailure);

    const parsed = parseBody(kind, body);
    if (!parsed) return reply(kind, 400, sendFailure);

    // Bots get the same answer as people, so they cannot tell they were caught.
    if (parsed.honeypot.trim() !== '') {
        console.info('[inquiry] Dropped a submission: the hidden honeypot field was filled.');
        return reply(kind, 200, success);
    }
    if (sentTooSoon(parsed)) {
        console.info('[inquiry] Dropped a submission: sent less than 3 seconds after the page loaded.');
        return reply(kind, 200, success);
    }

    // At most a few sends a minute from one visitor; Turnstile and the honeypot catch the rest.
    const visitorIp = request.headers.get('CF-Connecting-IP');
    if (bindings.INQUIRY_RATE_LIMITER && visitorIp) {
        const { success: allowed } = await bindings.INQUIRY_RATE_LIMITER.limit({ key: visitorIp });
        if (!allowed) {
            console.warn('[inquiry] Rate limit reached for one visitor.');
            return reply(kind, 429, sendFailure);
        }
    }

    if (!(await isHuman(parsed.token, visitorIp, new URL(request.url).hostname))) {
        return reply(kind, 403, sendFailure);
    }

    const result = validateInquiry(parsed.input, rules);
    if (!result.ok) {
        return reply(kind, 400, { ok: false, errors: result.errors, message: inquiryForm.messages.errorSummary });
    }

    const db = bindings.DB;
    if (!db) {
        console.error('[inquiry] The D1 binding DB is missing, so the inquiry could not be saved.');
        return reply(kind, 500, sendFailure);
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    try {
        await saveInquiry(db, id, createdAt, result.data);
    } catch (error) {
        console.error('[inquiry] Could not save an inquiry to D1:', error);
        return reply(kind, 500, sendFailure);
    }

    // The saved row is the backup, so a failed email still counts as a successful inquiry.
    const delivery = await emailInquiry(id, createdAt, result.data);
    await recordDelivery(db, id, delivery);

    // The inquiry is saved and emailed by now. If this step fails, Studio flags the inquiry for a retry.
    await tryLinkInquiry(db, { id, createdAt, submission: result.data });

    return reply(kind, 200, success);
};

export const ALL: APIRoute = () =>
    jsonResponse(405, { ok: false, errors: {}, message: 'Inquiries must be sent with POST.' }, { Allow: 'POST' });
