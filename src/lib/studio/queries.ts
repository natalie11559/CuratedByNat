// Everything Studio reads and writes about leads. Plain parameterized SQL against D1, no string-built queries.
// Tested against real SQLite.
import type { D1Database, D1Statement } from '../cloudflare.ts';
import { easternDate } from './dates.ts';
import { emailKey } from './leads.ts';
import type { LeadFields } from './validate.ts';
import { ACTIVITY_TYPES, CONTACT_TYPES, STAGES, type ActivityType, type StageId } from './vocab.ts';

export interface LeadRow {
    id: string;
    created_at: string;
    updated_at: string;
    first_name: string;
    last_name: string;
    partner_name: string;
    email: string;
    email_key: string;
    phone: string;
    instagram: string;
    inquirer_role: string;
    source: string;
    found_via: string;
    celebrating: string; // JSON array
    event_date: string | null;
    end_date: string | null;
    date_not_set: number;
    location: string;
    in_georgia: string;
    venue: string;
    photo_video: string;
    excited_about: string;
    anything_else: string;
    stage: StageId;
    stage_before_lost: string | null;
    lost_reason: string | null;
    last_contacted_at: string | null;
    next_follow_up_at: string | null;
    notes: string;
    deleted_at: string | null;
}

export interface ActivityRow {
    id: string;
    lead_id: string;
    type: ActivityType;
    body: string;
    occurred_at: string;
    actor_email: string;
}

export interface StudioSettings {
    followUpDays: number;
    lostReasons: string[];
}

export type WriteResult = { ok: true } | { ok: false; error: 'not-found' | 'duplicate-email' | 'invalid'; conflictLeadId?: string };

const DEFAULT_LOST_REASONS = ['Booked someone else', 'Over budget', 'Date unavailable', 'No response', 'Not a fit', 'Other'];

export function celebratingOf(lead: Pick<LeadRow, 'celebrating'>): string[] {
    try {
        const parsed: unknown = JSON.parse(lead.celebrating);
        return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    } catch {
        return [];
    }
}

export function fullName(lead: Pick<LeadRow, 'first_name' | 'last_name'>): string {
    return [lead.first_name, lead.last_name].filter(Boolean).join(' ');
}

// ---- Settings -------------------------------------------------------------------------------------

export async function getSettings(db: D1Database): Promise<StudioSettings> {
    const { results } = await db.prepare("SELECT key, value FROM settings WHERE key IN ('follow_up_days', 'lost_reasons')").all<{ key: string; value: string }>();
    const byKey = new Map(results.map((row) => [row.key, row.value]));
    let followUpDays = 5;
    let lostReasons = DEFAULT_LOST_REASONS;
    try {
        const days = Number(JSON.parse(byKey.get('follow_up_days') ?? '5'));
        if (Number.isInteger(days) && days >= 1 && days <= 60) followUpDays = days;
        const reasons: unknown = JSON.parse(byKey.get('lost_reasons') ?? 'null');
        if (Array.isArray(reasons) && reasons.length > 0 && reasons.every((value) => typeof value === 'string')) lostReasons = reasons;
    } catch {
        // Unreadable settings fall back to the defaults.
    }
    return { followUpDays, lostReasons };
}

// ---- Audit ----------------------------------------------------------------------------------------

export function auditStatement(
    db: D1Database,
    entry: { actor: string; action: string; entity: string; entityId: string; summary?: string; now: Date },
): D1Statement {
    return db
        .prepare('INSERT INTO audit_log (id, at, actor_email, action, entity, entity_id, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(crypto.randomUUID(), entry.now.toISOString(), entry.actor, entry.action, entry.entity, entry.entityId, entry.summary ?? '');
}

function activityStatement(
    db: D1Database,
    entry: { leadId: string; type: ActivityType; body: string; occurredAt: string; actor: string; now: Date },
): D1Statement {
    return db
        .prepare('INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(crypto.randomUUID(), entry.leadId, entry.type, entry.body, entry.occurredAt, entry.actor, entry.now.toISOString());
}

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

async function conflictingLead(db: D1Database, key: string, exceptId: string): Promise<string | undefined> {
    if (!key) return undefined;
    const row = await db
        .prepare("SELECT id FROM leads WHERE email_key = ?1 AND id <> ?2 AND deleted_at IS NULL AND stage NOT IN ('delivered', 'lost') LIMIT 1")
        .bind(key, exceptId)
        .first<{ id: string }>();
    return row?.id;
}

// ---- Reading --------------------------------------------------------------------------------------

export async function getLead(db: D1Database, id: string, options: { includeDeleted?: boolean } = {}): Promise<LeadRow | null> {
    const lead = await db.prepare('SELECT * FROM leads WHERE id = ?1').bind(id).first<LeadRow>();
    if (!lead || (lead.deleted_at && !options.includeDeleted)) return null;
    return lead;
}

export interface LeadFilter {
    stage?: string;
    celebrating?: string;
    source?: string;
    /** YYYY-MM of the event. */
    month?: string;
    /** Search text: name, email, phone or Instagram. */
    q?: string;
    deleted?: boolean;
}

const PHONE_DIGITS = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '(', ''), ')', ''), '-', ''), ' ', ''), '.', '')";

/** Escapes % and _ so search text is matched literally. */
function likePattern(text: string): string {
    return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export async function listLeads(db: D1Database, filter: LeadFilter = {}, limit = 500): Promise<LeadRow[]> {
    const where: string[] = [filter.deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
    const values: unknown[] = [];
    const next = (value: unknown) => {
        values.push(value);
        return `?${values.length}`;
    };

    if (filter.stage) where.push(`stage = ${next(filter.stage)}`);
    if (filter.source) where.push(`source = ${next(filter.source)}`);
    if (filter.celebrating) where.push(`EXISTS (SELECT 1 FROM json_each(leads.celebrating) WHERE value = ${next(filter.celebrating)})`);
    if (filter.month) where.push(`substr(COALESCE(event_date, ''), 1, 7) = ${next(filter.month)}`);

    const text = filter.q?.trim();
    if (text) {
        const like = next(likePattern(text));
        const parts = [
            `first_name LIKE ${like} ESCAPE '\\'`,
            `last_name LIKE ${like} ESCAPE '\\'`,
            `(first_name || ' ' || last_name) LIKE ${like} ESCAPE '\\'`,
            `partner_name LIKE ${like} ESCAPE '\\'`,
            `email LIKE ${like} ESCAPE '\\'`,
            `instagram LIKE ${like} ESCAPE '\\'`,
        ];
        const digits = text.replace(/\D/g, '');
        if (digits.length >= 3) parts.push(`${PHONE_DIGITS} LIKE ${next(likePattern(digits))} ESCAPE '\\'`);
        where.push(`(${parts.join(' OR ')})`);
    }

    const { results } = await db
        .prepare(`SELECT * FROM leads WHERE ${where.join(' AND ')} ORDER BY COALESCE(event_date, '9999-12-31'), created_at DESC LIMIT ${Math.max(1, Math.min(limit, 1000))}`)
        .bind(...values)
        .all<LeadRow>();
    return results;
}

/** The months (YYYY-MM) that have at least one event, for the pipeline's month filter. */
export async function listEventMonths(db: D1Database): Promise<string[]> {
    const { results } = await db
        .prepare("SELECT DISTINCT substr(event_date, 1, 7) AS month FROM leads WHERE deleted_at IS NULL AND event_date IS NOT NULL ORDER BY month")
        .all<{ month: string }>();
    return results.map((row) => row.month);
}

export async function stageCounts(db: D1Database): Promise<Record<string, number>> {
    const { results } = await db
        .prepare('SELECT stage, COUNT(*) AS total FROM leads WHERE deleted_at IS NULL GROUP BY stage')
        .all<{ stage: string; total: number }>();
    return Object.fromEntries(results.map((row) => [row.stage, row.total]));
}

export async function listActivities(db: D1Database, leadId: string): Promise<ActivityRow[]> {
    const { results } = await db
        .prepare('SELECT id, lead_id, type, body, occurred_at, actor_email FROM activities WHERE lead_id = ?1 ORDER BY occurred_at DESC, created_at DESC')
        .bind(leadId)
        .all<ActivityRow>();
    return results;
}

export interface LeadInquiryRow {
    id: string;
    created_at: string;
    payload: string;
}

export async function listInquiriesForLead(db: D1Database, leadId: string): Promise<LeadInquiryRow[]> {
    const { results } = await db
        .prepare(
            `SELECT i.id, i.created_at, i.payload FROM lead_inquiries li
             JOIN inquiries i ON i.id = li.inquiry_id
             WHERE li.lead_id = ?1 ORDER BY i.created_at DESC`,
        )
        .bind(leadId)
        .all<LeadInquiryRow>();
    return results;
}

// ---- Writing --------------------------------------------------------------------------------------

export async function createLead(
    db: D1Database,
    fields: LeadFields,
    context: { actor: string; now?: Date },
): Promise<{ ok: true; id: string } | { ok: false; error: 'duplicate-email'; conflictLeadId?: string }> {
    const now = context.now ?? new Date();
    const id = crypto.randomUUID();
    const timestamp = now.toISOString();
    try {
        await db.batch([
            db
                .prepare(
                    `INSERT INTO leads
                        (id, created_at, updated_at, first_name, last_name, partner_name, email, email_key, phone, instagram, source,
                         celebrating, event_date, end_date, date_not_set, location, in_georgia, venue, notes, stage)
                     VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 'new')`,
                )
                .bind(
                    id,
                    timestamp,
                    fields.first_name,
                    fields.last_name,
                    fields.partner_name,
                    fields.email,
                    emailKey(fields.email),
                    fields.phone,
                    fields.instagram,
                    fields.source,
                    JSON.stringify(fields.celebrating),
                    fields.event_date,
                    fields.end_date,
                    fields.date_not_set ? 1 : 0,
                    fields.location,
                    fields.in_georgia,
                    fields.venue,
                    fields.notes,
                ),
            activityStatement(db, { leadId: id, type: 'system', body: 'Added by hand.', occurredAt: timestamp, actor: context.actor, now }),
        ]);
        return { ok: true, id };
    } catch (error) {
        if (isUniqueViolation(error)) {
            return { ok: false, error: 'duplicate-email', conflictLeadId: await conflictingLead(db, emailKey(fields.email), id) };
        }
        throw error;
    }
}

export async function updateLead(db: D1Database, id: string, fields: LeadFields, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    if (!(await getLead(db, id))) return { ok: false, error: 'not-found' };
    try {
        await db
            .prepare(
                `UPDATE leads SET updated_at = ?2, first_name = ?3, last_name = ?4, partner_name = ?5, email = ?6, email_key = ?7,
                    phone = ?8, instagram = ?9, source = ?10, celebrating = ?11, event_date = ?12, end_date = ?13, date_not_set = ?14,
                    location = ?15, in_georgia = ?16, venue = ?17, notes = ?18
                 WHERE id = ?1 AND deleted_at IS NULL`,
            )
            .bind(
                id,
                now.toISOString(),
                fields.first_name,
                fields.last_name,
                fields.partner_name,
                fields.email,
                emailKey(fields.email),
                fields.phone,
                fields.instagram,
                fields.source,
                JSON.stringify(fields.celebrating),
                fields.event_date,
                fields.end_date,
                fields.date_not_set ? 1 : 0,
                fields.location,
                fields.in_georgia,
                fields.venue,
                fields.notes,
            )
            .run();
        return { ok: true };
    } catch (error) {
        if (isUniqueViolation(error)) return { ok: false, error: 'duplicate-email', conflictLeadId: await conflictingLead(db, emailKey(fields.email), id) };
        throw error;
    }
}

const STAGE_IDS: readonly string[] = [...STAGES.map((stage) => stage.id)];

/** Moves a lead to one of the seven pipeline stages. Marking a lead lost has its own call, because it needs a reason. */
export async function changeStage(
    db: D1Database,
    id: string,
    stage: string,
    context: { actor: string; now?: Date; note?: string },
): Promise<WriteResult> {
    const now = context.now ?? new Date();
    if (!STAGE_IDS.includes(stage)) return { ok: false, error: 'invalid' };
    const lead = await getLead(db, id);
    if (!lead) return { ok: false, error: 'not-found' };
    if (lead.stage === stage) return { ok: true };

    const label = (value: string) => STAGES.find((entry) => entry.id === value)?.label ?? 'Lost';
    await db.batch([
        db
            .prepare("UPDATE leads SET stage = ?2, updated_at = ?3, lost_reason = NULL, stage_before_lost = NULL WHERE id = ?1")
            .bind(id, stage, now.toISOString()),
        activityStatement(db, {
            leadId: id,
            type: 'stage_change',
            body: context.note ?? `Moved from ${label(lead.stage)} to ${label(stage)}.`,
            occurredAt: now.toISOString(),
            actor: context.actor,
            now,
        }),
    ]);
    return { ok: true };
}

export async function markLost(db: D1Database, id: string, reason: string, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    const lead = await getLead(db, id);
    if (!lead) return { ok: false, error: 'not-found' };
    if (!reason.trim()) return { ok: false, error: 'invalid' };
    if (lead.stage === 'lost') return { ok: true };

    await db.batch([
        db
            .prepare("UPDATE leads SET stage = 'lost', stage_before_lost = ?2, lost_reason = ?3, updated_at = ?4 WHERE id = ?1")
            .bind(id, lead.stage, reason.trim().slice(0, 100), now.toISOString()),
        activityStatement(db, {
            leadId: id,
            type: 'stage_change',
            body: `Marked as lost: ${reason.trim().slice(0, 100)}.`,
            occurredAt: now.toISOString(),
            actor: context.actor,
            now,
        }),
    ]);
    return { ok: true };
}

/** Brings a lost lead back to the stage it was in. */
export async function reopenLead(db: D1Database, id: string, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    const lead = await getLead(db, id);
    if (!lead || lead.stage !== 'lost') return { ok: false, error: 'not-found' };
    const stage = STAGE_IDS.includes(lead.stage_before_lost ?? '') ? lead.stage_before_lost! : 'contacted';
    try {
        await db.batch([
            db.prepare('UPDATE leads SET stage = ?2, stage_before_lost = NULL, lost_reason = NULL, updated_at = ?3 WHERE id = ?1').bind(id, stage, now.toISOString()),
            activityStatement(db, { leadId: id, type: 'stage_change', body: 'Reopened.', occurredAt: now.toISOString(), actor: context.actor, now }),
        ]);
        return { ok: true };
    } catch (error) {
        if (isUniqueViolation(error)) return { ok: false, error: 'duplicate-email', conflictLeadId: await conflictingLead(db, lead.email_key, id) };
        throw error;
    }
}

/**
 * Writes down that Nat was in touch. Contact types update the "last contacted" time, clear a follow-up date that has
 * come, and move a brand new lead to Contacted.
 */
export async function logActivity(
    db: D1Database,
    leadId: string,
    entry: { type: string; body?: string; occurredAt?: string },
    context: { actor: string; now?: Date },
): Promise<WriteResult> {
    const now = context.now ?? new Date();
    const lead = await getLead(db, leadId);
    if (!lead) return { ok: false, error: 'not-found' };
    if (!ACTIVITY_TYPES.includes(entry.type as ActivityType) || entry.type === 'stage_change' || entry.type === 'system') {
        return { ok: false, error: 'invalid' };
    }
    const type = entry.type as ActivityType;
    const body = (entry.body ?? '').trim().slice(0, 5000);
    if (type === 'note' && !body) return { ok: false, error: 'invalid' };
    const occurredAt = entry.occurredAt ?? now.toISOString();

    const statements: D1Statement[] = [activityStatement(db, { leadId, type, body, occurredAt, actor: context.actor, now })];
    if (CONTACT_TYPES.includes(type)) {
        const today = easternDate(now);
        statements.push(
            db
                .prepare(
                    `UPDATE leads SET last_contacted_at = ?2, updated_at = ?3,
                        next_follow_up_at = CASE WHEN next_follow_up_at IS NOT NULL AND next_follow_up_at <= ?4 THEN NULL ELSE next_follow_up_at END
                     WHERE id = ?1`,
                )
                .bind(leadId, occurredAt, now.toISOString(), today),
        );
        if (lead.stage === 'new') {
            statements.push(
                db.prepare("UPDATE leads SET stage = 'contacted' WHERE id = ?1 AND stage = 'new'").bind(leadId),
                activityStatement(db, { leadId, type: 'stage_change', body: 'Moved from New to Contacted.', occurredAt, actor: context.actor, now }),
            );
        }
    } else {
        statements.push(db.prepare('UPDATE leads SET updated_at = ?2 WHERE id = ?1').bind(leadId, now.toISOString()));
    }
    await db.batch(statements);
    return { ok: true };
}

export async function setFollowUp(db: D1Database, id: string, date: string | null, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    if (!(await getLead(db, id))) return { ok: false, error: 'not-found' };
    await db.prepare('UPDATE leads SET next_follow_up_at = ?2, updated_at = ?3 WHERE id = ?1').bind(id, date, now.toISOString()).run();
    return { ok: true };
}

export async function softDeleteLead(db: D1Database, id: string, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    if (!(await getLead(db, id))) return { ok: false, error: 'not-found' };
    await db.batch([
        db.prepare('UPDATE leads SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1').bind(id, now.toISOString()),
        auditStatement(db, { actor: context.actor, action: 'delete', entity: 'lead', entityId: id, summary: 'Moved to Recently deleted.', now }),
    ]);
    return { ok: true };
}

export async function restoreLead(db: D1Database, id: string, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    const lead = await getLead(db, id, { includeDeleted: true });
    if (!lead || !lead.deleted_at) return { ok: false, error: 'not-found' };
    try {
        await db.batch([
            db.prepare('UPDATE leads SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1').bind(id, now.toISOString()),
            auditStatement(db, { actor: context.actor, action: 'restore', entity: 'lead', entityId: id, summary: 'Restored from Recently deleted.', now }),
        ]);
        return { ok: true };
    } catch (error) {
        if (isUniqueViolation(error)) return { ok: false, error: 'duplicate-email', conflictLeadId: await conflictingLead(db, lead.email_key, id) };
        throw error;
    }
}
