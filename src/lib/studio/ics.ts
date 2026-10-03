// The private calendar feed (.ics) that Nat adds once to her phone. One way only: Studio to her calendar.
// It shows only what a calendar needs: the client's first name, the kind of thing, the time and the city. No phone
// numbers, emails, notes or money ever go in it.
import { addDays } from './dates.ts';
import { calendarTypeLabel, type CalendarEntry } from './calendar.ts';

const CRLF = '\r\n';

/** Commas, semicolons, backslashes and line breaks have special meaning in a calendar file. */
export function escapeText(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Lines longer than 75 bytes are split; the next line starts with a space. Never splits a character in half. */
export function foldLine(line: string): string {
    const encoder = new TextEncoder();
    if (encoder.encode(line).length <= 75) return line;
    const parts: string[] = [];
    let current = '';
    let size = 0;
    let limit = 75;
    for (const character of line) {
        const bytes = encoder.encode(character).length;
        if (size + bytes > limit) {
            parts.push(current);
            current = '';
            size = 0;
            limit = 74; // the leading space counts
        }
        current += character;
        size += bytes;
    }
    parts.push(current);
    return parts.join(`${CRLF} `);
}

const compactDate = (isoDate: string) => isoDate.replace(/-/g, '');
const compactUtc = (moment: Date) => moment.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** What a phone calendar shows as the title. Anything about a client uses only the first name. */
export function feedSummary(entry: CalendarEntry): string {
    if (entry.leadId && entry.firstName) return `${calendarTypeLabel(entry.type)}: ${entry.firstName}`;
    return entry.title;
}

function feedLocation(entry: CalendarEntry): string {
    return entry.location.trim().slice(0, 80);
}

function eventLines(entry: CalendarEntry, stamp: string): string[] {
    const lines = ['BEGIN:VEVENT', `UID:${entry.key.replace(/[^A-Za-z0-9:_-]/g, '-')}@curatedbynat.com`, `DTSTAMP:${stamp}`];

    if (entry.allDay || !entry.startsAt) {
        lines.push(`DTSTART;VALUE=DATE:${compactDate(entry.date)}`, `DTEND;VALUE=DATE:${compactDate(addDays(entry.endDate, 1))}`);
    } else {
        const start = new Date(entry.startsAt);
        const end = entry.endsAt && new Date(entry.endsAt) > start ? new Date(entry.endsAt) : new Date(start.getTime() + 3_600_000);
        lines.push(`DTSTART:${compactUtc(start)}`, `DTEND:${compactUtc(end)}`);
    }

    lines.push(`SUMMARY:${escapeText(feedSummary(entry))}`);
    const location = feedLocation(entry);
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    lines.push('TRANSP:TRANSPARENT'.replace('TRANSPARENT', entry.type === 'event' ? 'OPAQUE' : 'TRANSPARENT'));

    // A reminder at 9 AM the day before an event, and an hour before a timed appointment.
    if (entry.type === 'event' && entry.allDay) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Event tomorrow', 'TRIGGER:-PT15H', 'END:VALARM');
    } else if (!entry.allDay) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Starting soon', 'TRIGGER:-PT1H', 'END:VALARM');
    }
    lines.push('END:VEVENT');
    return lines;
}

export function buildIcs(entries: readonly CalendarEntry[], options: { now?: Date; name?: string } = {}): string {
    const stamp = compactUtc(options.now ?? new Date());
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Curated by Nat//Studio//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeText(options.name ?? 'Curated by Nat Studio')}`,
        'X-WR-TIMEZONE:America/New_York',
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
        ...entries.flatMap((entry) => eventLines(entry, stamp)),
        'END:VCALENDAR',
    ];
    return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}
