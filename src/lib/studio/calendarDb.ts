// Reading and writing Studio's calendar, plus the secret address of the phone feed. Plain parameterized SQL.
import type { D1Database } from '../cloudflare.ts';
import { buildCalendarEntries, type CalendarEntry, type CalendarItem, type CalendarLead } from './calendar.ts';
import { auditStatement, getLead, type WriteResult } from './queries.ts';
import type { CalendarItemInput } from './validate.ts';

const ITEM_COLUMNS = 'id, lead_id, type, title, starts_at, ends_at, all_day, location, notes';

export async function listCalendarItems(db: D1Database): Promise<CalendarItem[]> {
    const { results } = await db
        .prepare(`SELECT ${ITEM_COLUMNS} FROM calendar_items WHERE deleted_at IS NULL ORDER BY starts_at LIMIT 5000`)
        .all<CalendarItem>();
    return results;
}

export async function getCalendarItem(db: D1Database, id: string): Promise<CalendarItem | null> {
    return db.prepare(`SELECT ${ITEM_COLUMNS} FROM calendar_items WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<CalendarItem>();
}

/** Everything on the calendar: Nat's items plus the dates worked out from her leads. */
export async function loadCalendar(db: D1Database): Promise<CalendarEntry[]> {
    const [{ results: leads }, items] = await Promise.all([
        db
            .prepare(
                `SELECT id, first_name, last_name, stage, event_date, end_date, location, next_follow_up_at, deleted_at
                 FROM leads WHERE deleted_at IS NULL`,
            )
            .all<CalendarLead>(),
        listCalendarItems(db),
    ]);
    return buildCalendarEntries({ leads, items });
}

export async function createCalendarItem(
    db: D1Database,
    input: CalendarItemInput,
    context: { actor: string; now?: Date },
): Promise<WriteResult & { id?: string }> {
    const now = context.now ?? new Date();
    const timestamp = now.toISOString();
    if (input.leadId && !(await getLead(db, input.leadId))) return { ok: false, error: 'not-found' };

    const id = crypto.randomUUID();
    const statements = [
        db
            .prepare(
                `INSERT INTO calendar_items (id, lead_id, type, title, starts_at, ends_at, all_day, location, notes, actor_email, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
            )
            .bind(id, input.leadId, input.type, input.title, input.startsAt, input.endsAt, input.allDay ? 1 : 0, input.location, input.notes, context.actor, timestamp),
        auditStatement(db, { actor: context.actor, action: 'create', entity: 'calendar_item', entityId: id, summary: input.type, now }),
    ];
    if (input.leadId) {
        statements.push(
            db
                .prepare('INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)')
                .bind(crypto.randomUUID(), input.leadId, 'system', `Added a ${input.type.replace('_', '-')} to the calendar.`, timestamp, context.actor),
        );
    }
    await db.batch(statements);
    return { ok: true, id };
}

export async function updateCalendarItem(db: D1Database, id: string, input: CalendarItemInput, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    if (!(await getCalendarItem(db, id))) return { ok: false, error: 'not-found' };
    if (input.leadId && !(await getLead(db, input.leadId))) return { ok: false, error: 'not-found' };
    await db.batch([
        db
            .prepare(
                `UPDATE calendar_items SET lead_id = ?2, type = ?3, title = ?4, starts_at = ?5, ends_at = ?6, all_day = ?7,
                    location = ?8, notes = ?9, updated_at = ?10
                 WHERE id = ?1 AND deleted_at IS NULL`,
            )
            .bind(id, input.leadId, input.type, input.title, input.startsAt, input.endsAt, input.allDay ? 1 : 0, input.location, input.notes, now.toISOString()),
        auditStatement(db, { actor: context.actor, action: 'update', entity: 'calendar_item', entityId: id, summary: input.type, now }),
    ]);
    return { ok: true };
}

export async function deleteCalendarItem(db: D1Database, id: string, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    if (!(await getCalendarItem(db, id))) return { ok: false, error: 'not-found' };
    await db.batch([
        db.prepare('UPDATE calendar_items SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1').bind(id, now.toISOString()),
        auditStatement(db, { actor: context.actor, action: 'delete', entity: 'calendar_item', entityId: id, now }),
    ]);
    return { ok: true };
}

// ---- The secret address of the phone feed ------------------------------------------------------------

const TOKEN_KEY = 'calendar_feed_token';

function newToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The feed's secret, made the first time it is needed. Kept in the database so Studio can reset it. */
export async function getFeedToken(db: D1Database, now: Date = new Date()): Promise<string> {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(TOKEN_KEY).first<{ value: string }>();
    if (row) {
        try {
            const stored: unknown = JSON.parse(row.value);
            if (typeof stored === 'string' && stored.length >= 40) return stored;
        } catch {
            // A damaged value is replaced below.
        }
    }
    return resetFeedToken(db, '', now);
}

/** Makes a new secret. The old address stops working at once. */
export async function resetFeedToken(db: D1Database, actor: string, now: Date = new Date()): Promise<string> {
    const token = newToken();
    await db.batch([
        db
            .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
            .bind(TOKEN_KEY, JSON.stringify(token), now.toISOString()),
        auditStatement(db, { actor: actor || 'studio', action: 'reset', entity: 'calendar_feed', entityId: 'feed', summary: 'New private feed address.', now }),
    ]);
    return token;
}

/** Compares two secrets without revealing, by timing, how many leading characters were right. */
export async function tokensMatch(given: string, actual: string): Promise<boolean> {
    const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    const [a, b] = await Promise.all([digest(given), digest(actual)]);
    let difference = 0;
    for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
    return difference === 0;
}
