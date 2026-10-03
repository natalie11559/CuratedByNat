// The Clients list: everyone, in any stage, searchable and sortable, with a spreadsheet export.
import type { D1Database } from '../cloudflare.ts';
import { centsToNumber, toCsv } from './csv.ts';
import { easternDate } from './dates.ts';
import { celebratingOf, type LeadRow } from './queries.ts';
import { celebratingLabels, SOURCES, stageLabel } from './vocab.ts';

export const SORTS = [
    { id: 'name', label: 'Name' },
    { id: 'event', label: 'Event date' },
    { id: 'created', label: 'Date added' },
    { id: 'stage', label: 'Stage' },
] as const;

export type SortId = (typeof SORTS)[number]['id'];

export interface ClientRow extends LeadRow {
    total_cents: number;
    paid_cents: number;
    packages: string | null;
}

export interface ClientFilter {
    q?: string;
    stage?: string;
    sort?: SortId;
    dir?: 'asc' | 'desc';
}

const ORDER: Record<SortId, (direction: string) => string> = {
    name: (d) => `LOWER(l.first_name) ${d}, LOWER(l.last_name) ${d}`,
    // People with no date go last whichever way the list is sorted.
    event: (d) => `l.event_date IS NULL, l.event_date ${d}, LOWER(l.first_name)`,
    created: (d) => `l.created_at ${d}`,
    stage: (d) =>
        `CASE l.stage WHEN 'new' THEN 1 WHEN 'contacted' THEN 2 WHEN 'consultation' THEN 3 WHEN 'packages_sent' THEN 4 WHEN 'booked' THEN 5 WHEN 'event_done' THEN 6 WHEN 'delivered' THEN 7 ELSE 8 END ${d}, LOWER(l.first_name)`,
};

function likePattern(text: string): string {
    return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export async function listClients(db: D1Database, filter: ClientFilter = {}, limit = 1000): Promise<ClientRow[]> {
    const where = ['l.deleted_at IS NULL'];
    const values: unknown[] = [];
    const next = (value: unknown) => {
        values.push(value);
        return `?${values.length}`;
    };
    if (filter.stage) where.push(`l.stage = ${next(filter.stage)}`);
    const text = filter.q?.trim();
    if (text) {
        const like = next(likePattern(text));
        const columns = ['l.first_name', 'l.last_name', 'l.partner_name', 'l.email', 'l.instagram', "(l.first_name || ' ' || l.last_name)"];
        const parts = columns.map((column) => `${column} LIKE ${like} ESCAPE '\\'`);
        const digits = text.replace(/\D/g, '');
        if (digits.length >= 3) {
            parts.push(`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(l.phone, '(', ''), ')', ''), '-', ''), ' ', ''), '.', '') LIKE ${next(likePattern(digits))} ESCAPE '\\'`);
        }
        where.push(`(${parts.join(' OR ')})`);
    }
    const sort: SortId = SORTS.some((entry) => entry.id === filter.sort) ? filter.sort! : 'name';
    const direction = filter.dir === 'desc' ? 'DESC' : 'ASC';

    const { results } = await db
        .prepare(
            `SELECT l.*,
                (SELECT COALESCE(SUM(b.total_cents), 0) FROM bookings b WHERE b.lead_id = l.id AND b.deleted_at IS NULL) AS total_cents,
                (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p JOIN bookings b ON b.id = p.booking_id
                  WHERE b.lead_id = l.id AND b.deleted_at IS NULL AND p.deleted_at IS NULL) AS paid_cents,
                (SELECT GROUP_CONCAT(NULLIF(b.package_name, ''), ' + ') FROM bookings b WHERE b.lead_id = l.id AND b.deleted_at IS NULL) AS packages
             FROM leads l WHERE ${where.join(' AND ')}
             ORDER BY ${ORDER[sort](direction)}
             LIMIT ${Math.max(1, Math.min(limit, 5000))}`,
        )
        .bind(...values)
        .all<ClientRow>();
    return results;
}

const sourceLabel = (id: string) => SOURCES.find((entry) => entry.id === id)?.label ?? id;
const day = (timestamp: string | null) => (timestamp ? easternDate(timestamp) : '');

export const CSV_HEADINGS = [
    'First name',
    'Last name',
    'Partner',
    'Email',
    'Phone',
    'Instagram',
    'Stage',
    'Where they came from',
    'Celebrating',
    'Event date',
    'End date',
    'Location',
    'Venue',
    'Date added',
    'Last contacted',
    'Next follow-up',
    'Package',
    'Total',
    'Received',
    'Balance',
];

/** The Clients list as a spreadsheet. Money is plain numbers so the sheet can add it up. */
export function clientsCsv(clients: readonly ClientRow[]): string {
    return toCsv([
        CSV_HEADINGS,
        ...clients.map((client) => [
            client.first_name,
            client.last_name,
            client.partner_name,
            client.email,
            client.phone,
            client.instagram ? `@${client.instagram}` : '',
            stageLabel(client.stage) + (client.stage === 'lost' && client.lost_reason ? ` (${client.lost_reason})` : ''),
            sourceLabel(client.source),
            celebratingLabels(celebratingOf(client)).join(', '),
            client.event_date ?? '',
            client.end_date ?? '',
            client.location,
            client.venue,
            day(client.created_at),
            day(client.last_contacted_at),
            client.next_follow_up_at ?? '',
            client.packages ?? '',
            client.total_cents > 0 ? centsToNumber(client.total_cents) : '',
            client.paid_cents > 0 ? centsToNumber(client.paid_cents) : '',
            client.total_cents > 0 ? centsToNumber(Math.max(client.total_cents - client.paid_cents, 0)) : '',
        ]),
    ]);
}
