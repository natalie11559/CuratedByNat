// Turns website inquiries into Studio leads. One pipeline: every inquiry becomes a lead (or more history on an
// open lead from the same email), whether it arrives live or is imported from the backup later.
// Pure apart from D1, and tested against real SQLite.
import type { D1Database, D1Statement } from '../cloudflare.ts';
import type { InquirySubmission } from '../inquiry/validate.ts';
import { normalizeInstagram } from './validate.ts';
import { CLOSED_STAGES } from './vocab.ts';

export interface InquiryRecord {
    id: string;
    createdAt: string;
    submission: InquirySubmission;
}

export type LinkResult = { leadId: string; created: boolean };

/** Trimmed and lowercase: what two spellings of the same address have in common. */
export function emailKey(email: string): string {
    return email.trim().toLowerCase();
}

function text(value: unknown, max = 4000): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function dateOrNull(value: unknown): string | null {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * Reads a saved inquiry payload without trusting it: the backup may hold rows from older versions of the form,
 * so every field is optional here. Returns null when it is not even an object.
 */
export function submissionFromPayload(payload: string): InquirySubmission | null {
    let data: unknown;
    try {
        data = JSON.parse(payload);
    } catch {
        return null;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const record = data as Record<string, unknown>;
    return {
        firstName: text(record.firstName, 80),
        lastName: text(record.lastName, 80),
        email: text(record.email, 254),
        phone: text(record.phone, 40),
        instagram: text(record.instagram, 60),
        inquirer: text(record.inquirer, 200),
        celebrating: Array.isArray(record.celebrating)
            ? (record.celebrating.filter((value): value is string => typeof value === 'string') as InquirySubmission['celebrating'])
            : [],
        eventDate: dateOrNull(record.eventDate),
        dateNotSet: record.dateNotSet === true,
        endDate: dateOrNull(record.endDate),
        inGeorgia: text(record.inGeorgia, 40) as InquirySubmission['inGeorgia'],
        location: text(record.location, 200),
        photoVideo: text(record.photoVideo, 200),
        excitedAbout: text(record.excitedAbout, 2000),
        anythingElse: text(record.anythingElse, 2000),
        foundVia: text(record.foundVia, 200),
    };
}

const CLOSED_LIST = CLOSED_STAGES.map((stage) => `'${stage}'`).join(', ');

/** A handle the website visitor typed, made safe to link to. Anything that isn't a plain handle is left out. */
export function instagramHandle(typed: string): string {
    const handle = normalizeInstagram(typed);
    return /^(?=.*[A-Za-z0-9])[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : '';
}

function insertLead(db: D1Database, leadId: string, inquiry: InquiryRecord): D1Statement {
    const { submission } = inquiry;
    return db
        .prepare(
            `INSERT INTO leads
                (id, created_at, updated_at, first_name, last_name, email, email_key, phone, instagram, inquirer_role,
                 source, found_via, celebrating, event_date, end_date, date_not_set, location, in_georgia,
                 photo_video, excited_about, anything_else, stage)
             VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'website', ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, 'new')`,
        )
        .bind(
            leadId,
            inquiry.createdAt,
            submission.firstName || 'Unknown',
            submission.lastName,
            submission.email,
            emailKey(submission.email),
            submission.phone,
            instagramHandle(submission.instagram),
            submission.inquirer,
            submission.foundVia,
            JSON.stringify(submission.celebrating),
            submission.eventDate,
            submission.endDate,
            submission.dateNotSet ? 1 : 0,
            submission.location,
            submission.inGeorgia,
            submission.photoVideo,
            submission.excitedAbout,
            submission.anythingElse,
        );
}

function linkAndLog(db: D1Database, leadId: string, inquiry: InquiryRecord, message: string): D1Statement[] {
    return [
        db.prepare('INSERT INTO lead_inquiries (inquiry_id, lead_id, created_at) VALUES (?1, ?2, ?3)').bind(inquiry.id, leadId, inquiry.createdAt),
        db
            .prepare(
                `INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at)
                 VALUES (?1, ?2, 'system', ?3, ?4, '', ?4)`,
            )
            .bind(crypto.randomUUID(), leadId, message, inquiry.createdAt),
    ];
}

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/**
 * Creates the lead for an inquiry, or adds the inquiry to the open lead with the same email. Safe to run again:
 * an inquiry that is already linked is left alone.
 */
export async function linkInquiryToLead(
    db: D1Database,
    inquiry: InquiryRecord,
    options: { now?: Date; newId?: () => string } = {},
): Promise<LinkResult> {
    const newId = options.newId ?? (() => crypto.randomUUID());
    const now = (options.now ?? new Date()).toISOString();

    const existingLink = await db
        .prepare('SELECT lead_id FROM lead_inquiries WHERE inquiry_id = ?1')
        .bind(inquiry.id)
        .first<{ lead_id: string }>();
    if (existingLink) return { leadId: existingLink.lead_id, created: false };

    const key = emailKey(inquiry.submission.email);

    // Two tries: the second covers another inquiry from the same address creating the lead a moment before us.
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const open = key
            ? await db
                  .prepare(
                      `SELECT id FROM leads
                       WHERE email_key = ?1 AND deleted_at IS NULL AND stage NOT IN (${CLOSED_LIST})
                       ORDER BY created_at DESC LIMIT 1`,
                  )
                  .bind(key)
                  .first<{ id: string }>()
            : null;

        try {
            if (open) {
                const { submission } = inquiry;
                await db.batch([
                    ...linkAndLog(db, open.id, inquiry, 'Sent another inquiry through the website.'),
                    // Only blanks are filled in; what Nat has already corrected by hand is never overwritten.
                    db
                        .prepare(
                            `UPDATE leads SET
                                updated_at = ?2,
                                phone = CASE WHEN phone = '' THEN ?3 ELSE phone END,
                                instagram = CASE WHEN instagram = '' THEN ?4 ELSE instagram END,
                                location = CASE WHEN location = '' THEN ?5 ELSE location END,
                                event_date = COALESCE(event_date, ?6),
                                end_date = COALESCE(end_date, ?7)
                             WHERE id = ?1`,
                        )
                        .bind(open.id, now, submission.phone, instagramHandle(submission.instagram), submission.location, submission.eventDate, submission.endDate),
                ]);
                return { leadId: open.id, created: false };
            }

            const leadId = newId();
            await db.batch([insertLead(db, leadId, inquiry), ...linkAndLog(db, leadId, inquiry, 'Inquiry received through the website.')]);
            return { leadId, created: true };
        } catch (error) {
            if (attempt === 0 && isUniqueViolation(error)) continue;
            throw error;
        }
    }
    throw new Error('Could not link the inquiry to a lead.');
}

/**
 * Used by the live form. Never throws: if anything goes wrong the inquiry (already saved and emailed) is
 * untouched, and it shows up in Studio as needing attention until it is retried.
 */
export async function tryLinkInquiry(
    db: D1Database,
    inquiry: InquiryRecord,
    log: (message: string) => void = console.error,
): Promise<boolean> {
    try {
        await linkInquiryToLead(db, inquiry);
        return true;
    } catch (error) {
        // Only the id and the error text are logged, never what the visitor wrote.
        log(`[inquiry] Inquiry ${inquiry.id} is saved, but its Studio lead was not created: ${error instanceof Error ? error.message : 'unknown error'}`);
        return false;
    }
}

export async function countUnlinkedInquiries(db: D1Database): Promise<number> {
    const row = await db
        .prepare('SELECT COUNT(*) AS total FROM inquiries i WHERE NOT EXISTS (SELECT 1 FROM lead_inquiries li WHERE li.inquiry_id = i.id)')
        .first<{ total: number }>();
    return row?.total ?? 0;
}

/**
 * Creates leads for every inquiry that has none yet, oldest first. This is both the one-time import of the
 * inquiries that arrived before Studio existed and the "retry" for any live inquiry whose lead step failed.
 */
export async function syncUnlinkedInquiries(
    db: D1Database,
    options: { limit?: number; log?: (message: string) => void } = {},
): Promise<{ linked: number; failed: number; remaining: number }> {
    const log = options.log ?? console.error;
    const { results } = await db
        .prepare(
            `SELECT i.id, i.created_at, i.payload FROM inquiries i
             WHERE NOT EXISTS (SELECT 1 FROM lead_inquiries li WHERE li.inquiry_id = i.id)
             ORDER BY i.created_at, i.id LIMIT ?1`,
        )
        .bind(options.limit ?? 200)
        .all<{ id: string; created_at: string; payload: string }>();

    let linked = 0;
    let failed = 0;
    for (const row of results) {
        const submission = submissionFromPayload(row.payload);
        if (!submission) {
            log(`[studio] Inquiry ${row.id} has a payload that could not be read, so it was skipped.`);
            failed += 1;
            continue;
        }
        if (await tryLinkInquiry(db, { id: row.id, createdAt: row.created_at, submission }, log)) linked += 1;
        else failed += 1;
    }
    return { linked, failed, remaining: await countUnlinkedInquiries(db) };
}
