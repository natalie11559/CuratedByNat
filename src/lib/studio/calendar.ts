// The calendar: what shows on which day. It combines Nat's own calendar items with dates Studio already knows from
// the leads (a booked client's event, a follow-up date, the delivery that follows an event), so changing a date on a
// lead moves it on the calendar by itself. Pure, so it is easy to test.
import { addDays, daysBetween } from './dates.ts';
import { utcToEastern } from './tz.ts';

export const CALENDAR_TYPES = [
    { id: 'event', label: 'Event' },
    { id: 'consultation', label: 'Consultation' },
    { id: 'follow_up', label: 'Follow-up' },
    { id: 'delivery', label: 'Delivery' },
    { id: 'personal', label: 'Personal' },
] as const;

export type CalendarType = (typeof CALENDAR_TYPES)[number]['id'];

export const calendarTypeLabel = (type: string): string => CALENDAR_TYPES.find((entry) => entry.id === type)?.label ?? type;

export interface CalendarLead {
    id: string;
    first_name: string;
    last_name: string;
    stage: string;
    event_date: string | null;
    end_date: string | null;
    location: string;
    next_follow_up_at: string | null;
    deleted_at?: string | null;
}

/** A row of the calendar_items table. All-day items hold plain dates; timed items hold UTC moments. */
export interface CalendarItem {
    id: string;
    lead_id: string | null;
    type: CalendarType;
    title: string;
    starts_at: string;
    ends_at: string | null;
    all_day: number;
    location: string;
    notes: string;
}

export interface CalendarEntry {
    /** Stable, so a phone calendar updates an item instead of duplicating it. */
    key: string;
    type: CalendarType;
    /** True for entries worked out from a lead rather than saved as a calendar item. */
    auto: boolean;
    title: string;
    /** First and last day, in Eastern time. */
    date: string;
    endDate: string;
    allDay: boolean;
    startsAt: string | null;
    endsAt: string | null;
    startTime: string | null;
    endTime: string | null;
    leadId: string | null;
    firstName: string;
    /** For the phone feed: the lead's location, or the item's own for things not about a client. */
    location: string;
    itemId: string | null;
    notes: string;
}

const EVENT_STAGES = ['booked', 'event_done', 'delivered'];
const DELIVERY_STAGES = ['booked', 'event_done'];
const FOLLOW_UP_STAGES = ['new', 'contacted', 'consultation', 'packages_sent'];

function entryBase(): Omit<CalendarEntry, 'key' | 'type' | 'auto' | 'title' | 'date' | 'endDate' | 'allDay'> {
    return { startsAt: null, endsAt: null, startTime: null, endTime: null, leadId: null, firstName: '', location: '', itemId: null, notes: '' };
}

export function buildCalendarEntries(input: { leads: readonly CalendarLead[]; items: readonly CalendarItem[] }): CalendarEntry[] {
    const entries: CalendarEntry[] = [];
    const byId = new Map(input.leads.map((lead) => [lead.id, lead]));

    for (const lead of input.leads) {
        if (lead.deleted_at) continue;
        const common = { ...entryBase(), leadId: lead.id, firstName: lead.first_name, location: lead.location, allDay: true, auto: true };

        if (EVENT_STAGES.includes(lead.stage) && lead.event_date) {
            entries.push({ ...common, key: `lead-event:${lead.id}`, type: 'event', title: `${lead.first_name}'s event`, date: lead.event_date, endDate: lead.end_date ?? lead.event_date });
        }
        if (DELIVERY_STAGES.includes(lead.stage) && lead.event_date) {
            // The content is promised within 24 hours of the event.
            const day = addDays(lead.end_date ?? lead.event_date, 1);
            entries.push({ ...common, key: `lead-delivery:${lead.id}`, type: 'delivery', title: `Deliver content to ${lead.first_name}`, date: day, endDate: day });
        }
        if (FOLLOW_UP_STAGES.includes(lead.stage) && lead.next_follow_up_at) {
            entries.push({ ...common, key: `lead-followup:${lead.id}`, type: 'follow_up', title: `Follow up with ${lead.first_name}`, date: lead.next_follow_up_at, endDate: lead.next_follow_up_at });
        }
    }

    for (const item of input.items) {
        const lead = item.lead_id ? byId.get(item.lead_id) : undefined;
        if (item.lead_id && (!lead || lead.deleted_at)) continue; // the client was deleted, so their items are hidden too
        const allDay = item.all_day === 1;
        const start = allDay ? { date: item.starts_at, time: null } : utcToEastern(item.starts_at);
        const end = item.ends_at ? (allDay ? { date: item.ends_at, time: null } : utcToEastern(item.ends_at)) : null;
        const lastDay = allDay ? (end?.date && end.date >= start.date ? end.date : start.date) : end && end.date >= start.date ? end.date : start.date;
        entries.push({
            ...entryBase(),
            key: `item:${item.id}`,
            type: item.type,
            auto: false,
            title: item.title || (lead ? `${calendarTypeLabel(item.type)} with ${lead.first_name}` : calendarTypeLabel(item.type)),
            date: start.date,
            endDate: lastDay,
            allDay,
            startsAt: allDay ? null : item.starts_at,
            endsAt: allDay ? null : item.ends_at,
            startTime: start.time,
            endTime: end?.time ?? null,
            leadId: item.lead_id,
            firstName: lead?.first_name ?? '',
            location: lead ? lead.location : item.location,
            itemId: item.id,
            notes: item.notes,
        });
    }
    return entries.sort(compareEntries);
}

const TYPE_ORDER = CALENDAR_TYPES.map((entry) => entry.id as string);

export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
    return (
        a.date.localeCompare(b.date) ||
        Number(b.allDay) - Number(a.allDay) ||
        (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
        TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
        a.title.localeCompare(b.title)
    );
}

/** Entries that touch any day from `from` to `to` (inclusive). */
export function entriesInRange(entries: readonly CalendarEntry[], from: string, to: string): CalendarEntry[] {
    return entries.filter((entry) => entry.endDate >= from && entry.date <= to);
}

/** For each day in the range, the entries that fall on it. A multi-day entry appears on every day it covers. */
export function entriesByDay(entries: readonly CalendarEntry[], from: string, to: string): Map<string, CalendarEntry[]> {
    const days = new Map<string, CalendarEntry[]>();
    for (const entry of entriesInRange(entries, from, to)) {
        const first = entry.date < from ? from : entry.date;
        const last = entry.endDate > to ? to : entry.endDate;
        for (let offset = 0; offset <= daysBetween(first, last); offset += 1) {
            const day = addDays(first, offset);
            days.set(day, [...(days.get(day) ?? []), entry]);
        }
    }
    for (const list of days.values()) list.sort(compareEntries);
    return days;
}

export interface MonthDay {
    date: string;
    inMonth: boolean;
}

/** The weeks (Sunday first) that make up a month's grid, including the days around it. */
export function monthGrid(month: string): MonthDay[][] {
    const first = `${month}-01`;
    const [year, number] = month.split('-').map(Number) as [number, number];
    const startWeekday = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const start = addDays(first, -startWeekday);
    const weeks: MonthDay[][] = [];
    for (let index = 0; index < Math.ceil((startWeekday + daysInMonth) / 7); index += 1) {
        weeks.push(
            Array.from({ length: 7 }, (_, day) => {
                const date = addDays(start, index * 7 + day);
                return { date, inMonth: date.startsWith(month) };
            }),
        );
    }
    return weeks;
}

export function shiftMonth(month: string, by: number): string {
    const [year, number] = month.split('-').map(Number) as [number, number];
    const total = year * 12 + (number - 1) + by;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function isMonth(value: string | null | undefined): value is string {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
