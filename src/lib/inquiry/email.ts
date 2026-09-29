// The email Nat receives for each inquiry, and sending it through Resend's HTTP API.
// Pure functions (apart from the fetch in sendWithResend) so they can be unit tested.
import type { InquiryFormContent } from '../content';
import { CELEBRATIONS, GEORGIA_ANSWERS, type CelebrationValue, type FieldName, type GeorgiaValue } from './fields.ts';
import type { InquirySubmission } from './validate.ts';

export interface InquiryEmail {
    subject: string;
    text: string;
    html: string;
}

export interface AnsweredQuestion {
    name: FieldName;
    label: string;
    value: string;
}

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

/** "2027-06-06" becomes "June 6, 2027". Parsed by hand so time zones never shift the day. */
export function formatDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    const monthName = MONTHS[(month ?? 0) - 1];
    if (!year || !monthName || !day) return isoDate;
    return `${monthName} ${day}, ${year}`;
}

/** Nat is in Georgia, so the received time is shown in Eastern time, e.g. "September 27, 2026 at 3:05 PM Eastern time". */
export function formatReceived(isoTimestamp: string): string {
    const date = new Date(isoTimestamp);
    if (Number.isNaN(date.getTime())) return isoTimestamp;
    const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        dateStyle: 'long',
        timeStyle: 'short',
    }).format(date);
    return `${formatted} Eastern time`;
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function celebrationLabels(values: readonly CelebrationValue[], copy: InquiryFormContent): string[] {
    return values.map((value) => {
        const celebration = CELEBRATIONS.find((candidate) => candidate.value === value);
        return celebration ? copy.fields.celebrating.options[celebration.copyKey].label : value;
    });
}

export function georgiaLabel(value: GeorgiaValue, copy: InquiryFormContent): string {
    const answer = GEORGIA_ANSWERS.find((candidate) => candidate.value === value);
    return answer ? copy.fields.inGeorgia.options[answer.copyKey] : value;
}

/** Every answered question with the label Nat set for it, in form order. */
export function answeredQuestions(submission: InquirySubmission, copy: InquiryFormContent): AnsweredQuestion[] {
    const questions = copy.fields;
    const rows: AnsweredQuestion[] = [
        { name: 'firstName', label: questions.firstName.label, value: submission.firstName },
        { name: 'lastName', label: questions.lastName.label, value: submission.lastName },
        { name: 'email', label: questions.email.label, value: submission.email },
        { name: 'phone', label: questions.phone.label, value: submission.phone },
        { name: 'instagram', label: questions.instagram.label, value: submission.instagram },
        { name: 'inquirer', label: questions.inquirer.label, value: submission.inquirer },
        {
            name: 'celebrating',
            label: questions.celebrating.label,
            value: celebrationLabels(submission.celebrating, copy).join(', '),
        },
        {
            name: 'eventDate',
            label: questions.eventDate.label,
            value: submission.eventDate ? formatDate(submission.eventDate) : questions.dateNotSet.label,
        },
        { name: 'endDate', label: questions.endDate.label, value: submission.endDate ? formatDate(submission.endDate) : '' },
        { name: 'inGeorgia', label: questions.inGeorgia.label, value: georgiaLabel(submission.inGeorgia, copy) },
        { name: 'location', label: questions.location.label, value: submission.location },
        { name: 'photoVideo', label: questions.photoVideo.label, value: submission.photoVideo },
        { name: 'excitedAbout', label: questions.excitedAbout.label, value: submission.excitedAbout },
        { name: 'anythingElse', label: questions.anythingElse.label, value: submission.anythingElse },
        { name: 'foundVia', label: questions.foundVia.label, value: submission.foundVia },
    ];
    return rows.filter((row) => row.value !== '');
}

/** For example "New inquiry: Sarah Smith, Wedding, June 6, 2027". */
export function inquirySubject(submission: InquirySubmission, copy: InquiryFormContent): string {
    const name = `${submission.firstName} ${submission.lastName}`;
    const celebrating = celebrationLabels(submission.celebrating, copy).join(' & ');
    const when = submission.eventDate ? formatDate(submission.eventDate) : 'date not set yet';
    return `New inquiry: ${name}, ${celebrating}, ${when}`;
}

export function buildInquiryEmail(
    submission: InquirySubmission,
    copy: InquiryFormContent,
    meta: { id: string; receivedAt: string },
): InquiryEmail {
    const rows = answeredQuestions(submission, copy);
    const footer = `Received ${formatReceived(meta.receivedAt)}. Reply to this email to answer ${submission.firstName} directly.`;
    const title = 'New inquiry from curatedbynat.com';

    const text = [title, '', ...rows.flatMap((row) => [row.label, row.value, '']), footer, `Inquiry ID: ${meta.id}`].join('\n');

    const htmlRows = rows
        .map(
            (row) =>
                `<tr><td style="padding:14px 28px;border-top:1px solid #E4D5D0">` +
                `<div style="font-size:13px;line-height:1.4;color:#6B6260;margin:0 0 4px">${escapeHtml(row.label)}</div>` +
                `<div style="font-size:16px;line-height:1.55;color:#2B2B2B">${escapeHtml(row.value).replace(/\n/g, '<br>')}</div>` +
                `</td></tr>`,
        )
        .join('');

    const html =
        `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#F8F4EE;font-family:Helvetica,Arial,sans-serif">` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4D5D0;border-radius:4px">` +
        `<tr><td style="padding:24px 28px 18px"><h1 style="margin:0;font-family:Georgia,serif;font-size:22px;font-weight:normal;color:#2B2B2B">${escapeHtml(title)}</h1></td></tr>` +
        htmlRows +
        `<tr><td style="padding:18px 28px 24px;border-top:1px solid #E4D5D0;font-size:13px;line-height:1.5;color:#6B6260">${escapeHtml(footer)}<br>Inquiry ID: ${escapeHtml(meta.id)}</td></tr>` +
        `</table></body></html>`;

    return { subject: inquirySubject(submission, copy), text, html };
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** Sends through https://resend.com/docs/api-reference/emails/send-email. Never throws. */
export async function sendWithResend(options: {
    apiKey: string;
    from: string;
    to: string;
    replyTo: string;
    email: InquiryEmail;
    idempotencyKey: string;
    fetcher?: typeof fetch;
}): Promise<SendResult> {
    const { apiKey, from, to, replyTo, email, idempotencyKey, fetcher = fetch } = options;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetcher('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({
                from,
                to: to.split(',').map((address) => address.trim()).filter(Boolean),
                reply_to: replyTo,
                subject: email.subject,
                text: email.text,
                html: email.html,
            }),
            signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
        if (!response.ok) {
            return { ok: false, error: `Resend responded ${response.status}${body?.message ? `: ${body.message}` : ''}` };
        }
        return { ok: true, id: body?.id ?? '' };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
        clearTimeout(timeout);
    }
}
