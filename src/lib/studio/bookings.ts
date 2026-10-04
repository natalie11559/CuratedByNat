// Packages, extras, bookings and payments. Plain parameterized SQL against D1, tested against real SQLite.
import type { D1Database, D1Statement } from '../cloudflare.ts';
import { addDays } from './dates.ts';
import { formatCents, summarizePayments, type BalanceSummary, type PaymentMethod } from './money.ts';
import { auditStatement, getLead, type WriteResult } from './queries.ts';
import type { BookingInput, PaymentInput, PriceListInput } from './validate.ts';

export interface PackageRow {
    id: string;
    name: string;
    price_cents: number;
    details: string; // JSON array of lines
    sort_order: number;
    active: number;
}

export interface ExtraRow {
    id: string;
    name: string;
    price_cents: number;
    sort_order: number;
    active: number;
}

export interface BookingExtraRow {
    id: string;
    extra_id: string | null;
    name: string;
    price_cents: number;
    quantity: number;
}

export interface PaymentRow {
    id: string;
    booking_id: string;
    amount_cents: number;
    received_on: string;
    method: PaymentMethod;
    note: string;
    actor_email: string;
}

interface BookingRow {
    id: string;
    lead_id: string;
    package_id: string | null;
    package_name: string;
    package_price_cents: number;
    travel_fee_cents: number;
    travel_fee_note: string;
    total_cents: number;
    retainer_cents: number;
    balance_due_date: string | null;
    notes: string;
    created_at: string;
}

/** A booking with its extras, payments and the figures worked out from them. */
export interface BookingView extends BookingRow {
    extras: BookingExtraRow[];
    payments: PaymentRow[];
    summary: BalanceSummary;
}

export function packageDetails(row: Pick<PackageRow, 'details'>): string[] {
    try {
        const parsed: unknown = JSON.parse(row.details);
        return Array.isArray(parsed) ? parsed.filter((line): line is string => typeof line === 'string') : [];
    } catch {
        return [];
    }
}

// ---- Price lists ----------------------------------------------------------------------------------

export async function listPackages(db: D1Database, options: { includeInactive?: boolean } = {}): Promise<PackageRow[]> {
    const { results } = await db
        .prepare(`SELECT * FROM packages ${options.includeInactive ? '' : 'WHERE active = 1'} ORDER BY active DESC, sort_order, price_cents, name`)
        .all<PackageRow>();
    return results;
}

export async function listExtras(db: D1Database, options: { includeInactive?: boolean } = {}): Promise<ExtraRow[]> {
    const { results } = await db
        .prepare(`SELECT * FROM extras ${options.includeInactive ? '' : 'WHERE active = 1'} ORDER BY active DESC, sort_order, price_cents, name`)
        .all<ExtraRow>();
    return results;
}

export type PriceListKind = 'package' | 'extra';

const tableOf = (kind: PriceListKind) => (kind === 'package' ? 'packages' : 'extras');

export async function savePriceListItem(
    db: D1Database,
    kind: PriceListKind,
    id: string | null,
    input: PriceListInput,
    context: { actor: string; now?: Date },
): Promise<WriteResult & { id?: string }> {
    const now = context.now ?? new Date();
    const timestamp = now.toISOString();
    const table = tableOf(kind);

    if (id) {
        const existing = await db.prepare(`SELECT id FROM ${table} WHERE id = ?1`).bind(id).first();
        if (!existing) return { ok: false, error: 'not-found' };
        const statements: D1Statement[] =
            kind === 'package'
                ? [
                      db
                          .prepare('UPDATE packages SET name = ?2, price_cents = ?3, details = ?4, sort_order = ?5, active = ?6, updated_at = ?7 WHERE id = ?1')
                          .bind(id, input.name, input.priceCents, JSON.stringify(input.details), input.sortOrder, input.active ? 1 : 0, timestamp),
                  ]
                : [
                      db
                          .prepare('UPDATE extras SET name = ?2, price_cents = ?3, sort_order = ?4, active = ?5, updated_at = ?6 WHERE id = ?1')
                          .bind(id, input.name, input.priceCents, input.sortOrder, input.active ? 1 : 0, timestamp),
                  ];
        statements.push(auditStatement(db, { actor: context.actor, action: 'update', entity: kind, entityId: id, summary: `${input.name}: ${formatCents(input.priceCents)}`, now }));
        await db.batch(statements);
        return { ok: true, id };
    }

    const newId = crypto.randomUUID();
    const statements: D1Statement[] =
        kind === 'package'
            ? [
                  db
                      .prepare('INSERT INTO packages (id, name, price_cents, details, sort_order, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)')
                      .bind(newId, input.name, input.priceCents, JSON.stringify(input.details), input.sortOrder, input.active ? 1 : 0, timestamp),
              ]
            : [
                  db
                      .prepare('INSERT INTO extras (id, name, price_cents, sort_order, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)')
                      .bind(newId, input.name, input.priceCents, input.sortOrder, input.active ? 1 : 0, timestamp),
              ];
    statements.push(auditStatement(db, { actor: context.actor, action: 'create', entity: kind, entityId: newId, summary: `${input.name}: ${formatCents(input.priceCents)}`, now }));
    await db.batch(statements);
    return { ok: true, id: newId };
}

export async function setPriceListItemActive(
    db: D1Database,
    kind: PriceListKind,
    id: string,
    active: boolean,
    context: { actor: string; now?: Date },
): Promise<WriteResult> {
    const now = context.now ?? new Date();
    const table = tableOf(kind);
    const existing = await db.prepare(`SELECT id FROM ${table} WHERE id = ?1`).bind(id).first();
    if (!existing) return { ok: false, error: 'not-found' };
    await db.batch([
        db.prepare(`UPDATE ${table} SET active = ?2, updated_at = ?3 WHERE id = ?1`).bind(id, active ? 1 : 0, now.toISOString()),
        auditStatement(db, { actor: context.actor, action: active ? 'show' : 'hide', entity: kind, entityId: id, now }),
    ]);
    return { ok: true };
}

// ---- Bookings -------------------------------------------------------------------------------------

export async function getBookingsForLead(db: D1Database, leadId: string): Promise<BookingView[]> {
    const { results: bookings } = await db
        .prepare('SELECT * FROM bookings WHERE lead_id = ?1 AND deleted_at IS NULL ORDER BY created_at')
        .bind(leadId)
        .all<BookingRow>();
    const views: BookingView[] = [];
    for (const booking of bookings) {
        const [{ results: extras }, { results: payments }] = await Promise.all([
            db.prepare('SELECT id, extra_id, name, price_cents, quantity FROM booking_extras WHERE booking_id = ?1 ORDER BY name').bind(booking.id).all<BookingExtraRow>(),
            db
                .prepare('SELECT id, booking_id, amount_cents, received_on, method, note, actor_email FROM payments WHERE booking_id = ?1 AND deleted_at IS NULL ORDER BY received_on, created_at')
                .bind(booking.id)
                .all<PaymentRow>(),
        ]);
        views.push({
            ...booking,
            extras,
            payments,
            summary: summarizePayments({
                totalCents: booking.total_cents,
                retainerCents: booking.retainer_cents,
                paymentsCents: payments.map((payment) => payment.amount_cents),
            }),
        });
    }
    return views;
}

function extraStatements(db: D1Database, bookingId: string, input: BookingInput): D1Statement[] {
    return input.extras.map((extra) =>
        db
            .prepare('INSERT INTO booking_extras (id, booking_id, extra_id, name, price_cents, quantity) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
            .bind(crypto.randomUUID(), bookingId, extra.extraId, extra.name, extra.priceCents, extra.quantity),
    );
}

function describeBooking(input: BookingInput): string {
    return `${input.packageName || 'Custom booking'}, total ${formatCents(input.totalCents)}`;
}

/** Books a client: records the booking and moves the lead to Booked in one step. */
export async function createBooking(
    db: D1Database,
    leadId: string,
    input: BookingInput,
    context: { actor: string; now?: Date },
): Promise<WriteResult & { id?: string }> {
    const now = context.now ?? new Date();
    const timestamp = now.toISOString();
    const lead = await getLead(db, leadId);
    if (!lead) return { ok: false, error: 'not-found' };

    const id = crypto.randomUUID();
    const statements: D1Statement[] = [
        db
            .prepare(
                `INSERT INTO bookings
                    (id, lead_id, package_id, package_name, package_price_cents, travel_fee_cents, travel_fee_note, total_cents,
                     retainer_cents, balance_due_date, notes, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`,
            )
            .bind(
                id,
                leadId,
                input.packageId,
                input.packageName,
                input.packagePriceCents,
                input.travelFeeCents,
                input.travelFeeNote,
                input.totalCents,
                input.retainerCents,
                input.balanceDueDate,
                input.notes,
                timestamp,
            ),
        ...extraStatements(db, id, input),
        db
            .prepare('INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)')
            .bind(crypto.randomUUID(), leadId, 'payment', `Booked: ${describeBooking(input)}.`, timestamp, context.actor),
        auditStatement(db, { actor: context.actor, action: 'create', entity: 'booking', entityId: id, summary: describeBooking(input), now }),
    ];

    if (lead.stage !== 'booked' && !['event_done', 'delivered'].includes(lead.stage)) {
        statements.push(
            db.prepare("UPDATE leads SET stage = 'booked', stage_before_lost = NULL, lost_reason = NULL, updated_at = ?2 WHERE id = ?1").bind(leadId, timestamp),
            db
                .prepare('INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)')
                .bind(crypto.randomUUID(), leadId, 'stage_change', 'Booked.', timestamp, context.actor),
        );
    } else {
        statements.push(db.prepare('UPDATE leads SET updated_at = ?2 WHERE id = ?1').bind(leadId, timestamp));
    }
    await db.batch(statements);
    return { ok: true, id };
}

export async function updateBooking(db: D1Database, bookingId: string, input: BookingInput, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    const timestamp = now.toISOString();
    const existing = await db.prepare('SELECT id, lead_id FROM bookings WHERE id = ?1 AND deleted_at IS NULL').bind(bookingId).first<{ id: string; lead_id: string }>();
    if (!existing) return { ok: false, error: 'not-found' };

    await db.batch([
        db
            .prepare(
                `UPDATE bookings SET package_id = ?2, package_name = ?3, package_price_cents = ?4, travel_fee_cents = ?5, travel_fee_note = ?6,
                    total_cents = ?7, retainer_cents = ?8, balance_due_date = ?9, notes = ?10, updated_at = ?11
                 WHERE id = ?1`,
            )
            .bind(
                bookingId,
                input.packageId,
                input.packageName,
                input.packagePriceCents,
                input.travelFeeCents,
                input.travelFeeNote,
                input.totalCents,
                input.retainerCents,
                input.balanceDueDate,
                input.notes,
                timestamp,
            ),
        db.prepare('DELETE FROM booking_extras WHERE booking_id = ?1').bind(bookingId),
        ...extraStatements(db, bookingId, input),
        db
            .prepare('INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)')
            .bind(crypto.randomUUID(), existing.lead_id, 'payment', `Booking updated: ${describeBooking(input)}.`, timestamp, context.actor),
        auditStatement(db, { actor: context.actor, action: 'update', entity: 'booking', entityId: bookingId, summary: describeBooking(input), now }),
    ]);
    return { ok: true };
}

export async function removeBooking(db: D1Database, bookingId: string, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    const existing = await db.prepare('SELECT id, lead_id FROM bookings WHERE id = ?1 AND deleted_at IS NULL').bind(bookingId).first<{ id: string; lead_id: string }>();
    if (!existing) return { ok: false, error: 'not-found' };
    await db.batch([
        db.prepare('UPDATE bookings SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1').bind(bookingId, now.toISOString()),
        db
            .prepare('INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)')
            .bind(crypto.randomUUID(), existing.lead_id, 'payment', 'A booking was removed.', now.toISOString(), context.actor),
        auditStatement(db, { actor: context.actor, action: 'delete', entity: 'booking', entityId: bookingId, now }),
    ]);
    return { ok: true };
}

// ---- Payments -------------------------------------------------------------------------------------

export async function addPayment(db: D1Database, bookingId: string, input: PaymentInput, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    const timestamp = now.toISOString();
    const booking = await db.prepare('SELECT id, lead_id FROM bookings WHERE id = ?1 AND deleted_at IS NULL').bind(bookingId).first<{ id: string; lead_id: string }>();
    if (!booking) return { ok: false, error: 'not-found' };

    const paymentId = crypto.randomUUID();
    const summary = `${formatCents(input.amountCents)} by ${input.method}`;
    await db.batch([
        db
            .prepare('INSERT INTO payments (id, booking_id, amount_cents, received_on, method, note, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
            .bind(paymentId, bookingId, input.amountCents, input.receivedOn, input.method, input.note, context.actor, timestamp),
        db
            .prepare('INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)')
            .bind(crypto.randomUUID(), booking.lead_id, 'payment', `Payment received: ${summary}.`, timestamp, context.actor),
        auditStatement(db, { actor: context.actor, action: 'create', entity: 'payment', entityId: paymentId, summary, now }),
        db.prepare('UPDATE leads SET updated_at = ?2 WHERE id = ?1').bind(booking.lead_id, timestamp),
    ]);
    return { ok: true };
}

export async function deletePayment(db: D1Database, paymentId: string, context: { actor: string; now?: Date }): Promise<WriteResult> {
    const now = context.now ?? new Date();
    const payment = await db
        .prepare(
            `SELECT p.id, p.amount_cents, p.method, b.lead_id FROM payments p JOIN bookings b ON b.id = p.booking_id
             WHERE p.id = ?1 AND p.deleted_at IS NULL`,
        )
        .bind(paymentId)
        .first<{ id: string; amount_cents: number; method: string; lead_id: string }>();
    if (!payment) return { ok: false, error: 'not-found' };

    const summary = `${formatCents(payment.amount_cents)} by ${payment.method}`;
    await db.batch([
        db.prepare('UPDATE payments SET deleted_at = ?2 WHERE id = ?1').bind(paymentId, now.toISOString()),
        db
            .prepare('INSERT INTO activities (id, lead_id, type, body, occurred_at, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)')
            .bind(crypto.randomUUID(), payment.lead_id, 'payment', `A payment was removed: ${summary}.`, now.toISOString(), context.actor),
        auditStatement(db, { actor: context.actor, action: 'delete', entity: 'payment', entityId: paymentId, summary, now }),
    ]);
    return { ok: true };
}

// ---- Home: balances coming due --------------------------------------------------------------------

export interface BalanceDue {
    bookingId: string;
    leadId: string;
    firstName: string;
    lastName: string;
    packageName: string;
    dueDate: string;
    balanceCents: number;
}

/** Bookings with money still owed that fall due within `withinDays` days from today (or are already overdue). */
export async function listBalancesDue(db: D1Database, today: string, withinDays = 14): Promise<BalanceDue[]> {
    const { results } = await db
        .prepare(
            `SELECT b.id AS bookingId, l.id AS leadId, l.first_name AS firstName, l.last_name AS lastName,
                    b.package_name AS packageName, b.balance_due_date AS dueDate,
                    b.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.booking_id = b.id AND p.deleted_at IS NULL), 0) AS balanceCents
             FROM bookings b JOIN leads l ON l.id = b.lead_id
             WHERE b.deleted_at IS NULL AND l.deleted_at IS NULL AND l.stage <> 'lost' AND b.balance_due_date IS NOT NULL
               AND b.balance_due_date <= ?1
             ORDER BY b.balance_due_date, l.first_name`,
        )
        .bind(addDays(today, withinDays))
        .all<BalanceDue>();
    return results.filter((row) => row.balanceCents > 0);
}
