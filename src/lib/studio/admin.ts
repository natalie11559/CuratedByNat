// Settings Nat can change, reply templates, and the Recently deleted area. Plain parameterized SQL.
import type { D1Database, R2Bucket } from '../cloudflare.ts';
import { addDays, easternDate } from './dates.ts';
import { auditStatement, type WriteResult } from './queries.ts';
import type { GeneralSettingsInput, TemplateInput } from './validate.ts';

// ---- General settings -----------------------------------------------------------------------------

export async function saveGeneralSettings(db: D1Database, input: GeneralSettingsInput, context: { actor: string; now?: Date }): Promise<void> {
    const now = context.now ?? new Date();
    const upsert = (key: string, value: unknown) =>
        db
            .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
            .bind(key, JSON.stringify(value), now.toISOString());
    await db.batch([
        upsert('follow_up_days', input.followUpDays),
        upsert('lost_reasons', input.lostReasons),
        auditStatement(db, { actor: context.actor, action: 'update', entity: 'settings', entityId: 'general', summary: `Follow up after ${input.followUpDays} days`, now }),
    ]);
}

// ---- Reply templates ------------------------------------------------------------------------------

export interface TemplateRow {
    id: string;
    name: string;
    subject: string;
    body: string;
    sort_order: number;
    is_draft: number;
}

export async function listTemplates(db: D1Database): Promise<TemplateRow[]> {
    const { results } = await db.prepare('SELECT id, name, subject, body, sort_order, is_draft FROM templates ORDER BY sort_order, name').all<TemplateRow>();
    return results;
}

export async function getTemplate(db: D1Database, id: string): Promise<TemplateRow | null> {
    return db.prepare('SELECT id, name, subject, body, sort_order, is_draft FROM templates WHERE id = ?1').bind(id).first<TemplateRow>();
}

export async function saveTemplate(db: D1Database, id: string | null, input: TemplateInput, context: { actor: string; now?: Date }): Promise<WriteResult & { id?: string }> {
    const now = context.now ?? new Date();
    const timestamp = now.toISOString();
    if (id) {
        if (!(await getTemplate(db, id))) return { ok: false, error: 'not-found' };
        await db.batch([
            db
                .prepare('UPDATE templates SET name = ?2, subject = ?3, body = ?4, sort_order = ?5, is_draft = ?6, updated_at = ?7 WHERE id = ?1')
                .bind(id, input.name, input.subject, input.body, input.sortOrder, input.isDraft ? 1 : 0, timestamp),
            auditStatement(db, { actor: context.actor, action: 'update', entity: 'template', entityId: id, summary: input.name, now }),
        ]);
        return { ok: true, id };
    }
    const newId = crypto.randomUUID();
    await db.batch([
        db
            .prepare('INSERT INTO templates (id, name, subject, body, sort_order, is_draft, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)')
            .bind(newId, input.name, input.subject, input.body, input.sortOrder, input.isDraft ? 1 : 0, timestamp),
        auditStatement(db, { actor: context.actor, action: 'create', entity: 'template', entityId: newId, summary: input.name, now }),
    ]);
    return { ok: true, id: newId };
}

export async function deleteTemplate(db: D1Database, id: string, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    const existing = await getTemplate(db, id);
    if (!existing) return { ok: false, error: 'not-found' };
    await db.batch([
        db.prepare('DELETE FROM templates WHERE id = ?1').bind(id),
        auditStatement(db, { actor: context.actor, action: 'delete', entity: 'template', entityId: id, summary: existing.name, now }),
    ]);
    return { ok: true };
}

// ---- Recently deleted -----------------------------------------------------------------------------

export const KEEP_DELETED_DAYS = 30;

/** True once something has been in Recently deleted for 30 days. Only then is "Delete forever" offered. */
export function isPurgeable(deletedAt: string, now: Date = new Date()): boolean {
    return easternDate(now) >= addDays(easternDate(deletedAt), KEEP_DELETED_DAYS);
}

export function purgeDate(deletedAt: string): string {
    return addDays(easternDate(deletedAt), KEEP_DELETED_DAYS);
}

export interface DeletedFile {
    id: string;
    lead_id: string;
    kind: string;
    original_name: string;
    deleted_at: string;
    first_name: string;
    last_name: string;
}

export async function listDeletedFiles(db: D1Database): Promise<DeletedFile[]> {
    const { results } = await db
        .prepare(
            `SELECT f.id, f.lead_id, f.kind, f.original_name, f.deleted_at, l.first_name, l.last_name
             FROM files f JOIN leads l ON l.id = f.lead_id WHERE f.deleted_at IS NOT NULL ORDER BY f.deleted_at DESC`,
        )
        .all<DeletedFile>();
    return results;
}

export interface DeletedCalendarItem {
    id: string;
    type: string;
    title: string;
    starts_at: string;
    all_day: number;
    deleted_at: string;
}

export async function listDeletedCalendarItems(db: D1Database): Promise<DeletedCalendarItem[]> {
    const { results } = await db
        .prepare('SELECT id, type, title, starts_at, all_day, deleted_at FROM calendar_items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')
        .all<DeletedCalendarItem>();
    return results;
}

export async function restoreCalendarItem(db: D1Database, id: string, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    const existing = await db.prepare('SELECT id FROM calendar_items WHERE id = ?1 AND deleted_at IS NOT NULL').bind(id).first();
    if (!existing) return { ok: false, error: 'not-found' };
    await db.batch([
        db.prepare('UPDATE calendar_items SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1').bind(id, now.toISOString()),
        auditStatement(db, { actor: context.actor, action: 'restore', entity: 'calendar_item', entityId: id, now }),
    ]);
    return { ok: true };
}

export type PurgeResult = { ok: true } | { ok: false; error: 'not-found' | 'too-soon' | 'has-records' | 'is-contract' };

/** Erases a calendar item that has been in Recently deleted for 30 days. */
export async function purgeCalendarItem(db: D1Database, id: string, context: { actor: string; now?: Date }): Promise<PurgeResult> {
    const now = context.now ?? new Date();
    const item = await db.prepare('SELECT id, deleted_at FROM calendar_items WHERE id = ?1 AND deleted_at IS NOT NULL').bind(id).first<{ id: string; deleted_at: string }>();
    if (!item) return { ok: false, error: 'not-found' };
    if (!isPurgeable(item.deleted_at, now)) return { ok: false, error: 'too-soon' };
    await db.batch([
        db.prepare('DELETE FROM calendar_items WHERE id = ?1').bind(id),
        auditStatement(db, { actor: context.actor, action: 'purge', entity: 'calendar_item', entityId: id, now }),
    ]);
    return { ok: true };
}

/** Erases a file after 30 days in Recently deleted. A signed contract is never erased this way. */
export async function purgeFile(db: D1Database, bucket: R2Bucket, id: string, context: { actor: string; now?: Date }): Promise<PurgeResult> {
    const now = context.now ?? new Date();
    const file = await db.prepare('SELECT id, kind, r2_key, deleted_at FROM files WHERE id = ?1 AND deleted_at IS NOT NULL').bind(id).first<{ id: string; kind: string; r2_key: string; deleted_at: string }>();
    if (!file) return { ok: false, error: 'not-found' };
    if (file.kind === 'contract') return { ok: false, error: 'is-contract' };
    if (!isPurgeable(file.deleted_at, now)) return { ok: false, error: 'too-soon' };
    await bucket.delete(file.r2_key);
    await db.batch([
        db.prepare('DELETE FROM files WHERE id = ?1').bind(id),
        auditStatement(db, { actor: context.actor, action: 'purge', entity: 'file', entityId: id, summary: 'file', now }),
    ]);
    return { ok: true };
}

/**
 * Erases a lead after 30 days in Recently deleted, along with their timeline, calendar items and the website inquiry
 * backup. A lead with a booking, a payment or a file is kept: contracts and money records are never erased by Studio.
 */
export async function purgeLead(db: D1Database, id: string, context: { actor: string; now?: Date }): Promise<PurgeResult> {
    const now = context.now ?? new Date();
    const lead = await db.prepare('SELECT id, deleted_at FROM leads WHERE id = ?1 AND deleted_at IS NOT NULL').bind(id).first<{ id: string; deleted_at: string }>();
    if (!lead) return { ok: false, error: 'not-found' };
    if (!isPurgeable(lead.deleted_at, now)) return { ok: false, error: 'too-soon' };

    const records = await db
        .prepare('SELECT (SELECT COUNT(*) FROM bookings WHERE lead_id = ?1) + (SELECT COUNT(*) FROM files WHERE lead_id = ?1) AS total')
        .bind(id)
        .first<{ total: number }>();
    if ((records?.total ?? 0) > 0) return { ok: false, error: 'has-records' };

    const { results: links } = await db.prepare('SELECT inquiry_id FROM lead_inquiries WHERE lead_id = ?1').bind(id).all<{ inquiry_id: string }>();
    const inquiryIds = links.map((link) => link.inquiry_id);
    await db.batch([
        db.prepare('DELETE FROM lead_inquiries WHERE lead_id = ?1').bind(id),
        ...inquiryIds.map((inquiryId) => db.prepare('DELETE FROM inquiries WHERE id = ?1').bind(inquiryId)),
        db.prepare('DELETE FROM activities WHERE lead_id = ?1').bind(id),
        db.prepare('DELETE FROM calendar_items WHERE lead_id = ?1').bind(id),
        auditStatement(db, { actor: context.actor, action: 'purge', entity: 'lead', entityId: id, summary: 'Deleted forever.', now }),
        db.prepare('DELETE FROM leads WHERE id = ?1').bind(id),
    ]);
    return { ok: true };
}
