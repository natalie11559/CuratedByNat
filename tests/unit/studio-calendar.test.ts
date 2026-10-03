// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    buildCalendarEntries,
    entriesByDay,
    entriesInRange,
    isMonth,
    monthGrid,
    shiftMonth,
    type CalendarItem,
    type CalendarLead,
} from '../../src/lib/studio/calendar.ts';
import { buildIcs, escapeText, feedSummary, foldLine } from '../../src/lib/studio/ics.ts';
import { easternToUtc } from '../../src/lib/studio/tz.ts';

function lead(overrides: Partial<CalendarLead> = {}): CalendarLead {
    return { id: 'lead-1', first_name: 'Emory', last_name: 'Morris', stage: 'booked', event_date: '2027-05-15', end_date: null, location: 'Atlanta, GA', next_follow_up_at: null, deleted_at: null, ...overrides };
}
function item(overrides: Partial<CalendarItem> = {}): CalendarItem {
    return { id: 'item-1', lead_id: null, type: 'personal', title: 'Dentist', starts_at: '2027-05-10', ends_at: null, all_day: 1, location: '', notes: '', ...overrides };
}
const keys = (entries: Array<{ key: string }>) => entries.map((entry) => entry.key);

describe('buildCalendarEntries', () => {
    it('puts a booked client\'s event, and the delivery that follows, on the calendar by themselves', () => {
        const entries = buildCalendarEntries({ leads: [lead()], items: [] });
        assert.deepEqual(
            entries.map((entry) => [entry.key, entry.type, entry.date, entry.endDate, entry.allDay, entry.auto]),
            [
                ['lead-event:lead-1', 'event', '2027-05-15', '2027-05-15', true, true],
                ['lead-delivery:lead-1', 'delivery', '2027-05-16', '2027-05-16', true, true],
            ],
        );
    });

    it('moves with the lead: change the date and the calendar follows', () => {
        const before = buildCalendarEntries({ leads: [lead()], items: [] });
        const after = buildCalendarEntries({ leads: [lead({ event_date: '2027-06-05', end_date: '2027-06-07' })], items: [] });
        assert.equal(before[0]!.date, '2027-05-15');
        assert.deepEqual([after[0]!.date, after[0]!.endDate, after[1]!.date], ['2027-06-05', '2027-06-07', '2027-06-08']);
    });

    it('only shows events for clients who have booked, and follow-ups for those still being won', () => {
        const entries = buildCalendarEntries({
            leads: [
                lead({ id: 'a', stage: 'new', event_date: '2027-05-15', next_follow_up_at: '2026-10-12' }),
                lead({ id: 'b', stage: 'lost', event_date: '2027-05-16', next_follow_up_at: '2026-10-13' }),
                lead({ id: 'c', stage: 'delivered', event_date: '2027-05-17', next_follow_up_at: '2026-10-14' }),
                lead({ id: 'd', stage: 'booked', event_date: null }),
                lead({ id: 'e', stage: 'booked', deleted_at: '2026-10-01T00:00:00Z' }),
            ],
            items: [],
        });
        assert.deepEqual(keys(entries).sort(), ['lead-event:c', 'lead-followup:a']);
    });

    it('turns timed items into Eastern dates and times, and all-day items into plain dates', () => {
        const start = easternToUtc('2026-10-17', '16:30')!.toISOString();
        const end = easternToUtc('2026-10-17', '17:30')!.toISOString();
        const entries = buildCalendarEntries({
            leads: [lead({ id: 'l', first_name: 'Ava', stage: 'new', event_date: null })],
            items: [
                item({ id: 't', lead_id: 'l', type: 'consultation', title: '', starts_at: start, ends_at: end, all_day: 0 }),
                item({ id: 'a', starts_at: '2026-10-17', ends_at: '2026-10-19' }),
            ],
        });
        const timed = entries.find((entry) => entry.key === 'item:t')!;
        const allDay = entries.find((entry) => entry.key === 'item:a')!;
        assert.deepEqual([timed.startTime, timed.endTime, timed.date, timed.allDay, timed.title], ['16:30', '17:30', '2026-10-17', false, 'Consultation with Ava']);
        assert.deepEqual([allDay.date, allDay.endDate, allDay.allDay, allDay.startTime], ['2026-10-17', '2026-10-19', true, null]);
        // On the same day the all-day item comes first.
        assert.deepEqual(keys(entries), ['item:a', 'item:t']);
    });

    it('hides the items of a deleted or unknown client', () => {
        const entries = buildCalendarEntries({
            leads: [lead({ id: 'gone', deleted_at: '2026-10-01T00:00:00Z', stage: 'new', event_date: null })],
            items: [item({ id: 'x', lead_id: 'gone' }), item({ id: 'y', lead_id: 'nobody' }), item({ id: 'z' })],
        });
        assert.deepEqual(keys(entries), ['item:z']);
    });

    it('sorts by day, all-day first, then by time', () => {
        const at = (time: string) => easternToUtc('2026-10-17', time)!.toISOString();
        const entries = buildCalendarEntries({
            leads: [],
            items: [
                item({ id: 'late', starts_at: at('18:00'), all_day: 0, title: 'Late' }),
                item({ id: 'early', starts_at: at('08:00'), all_day: 0, title: 'Early' }),
                item({ id: 'all', starts_at: '2026-10-17', title: 'All day' }),
                item({ id: 'next', starts_at: '2026-10-18', title: 'Next day' }),
            ],
        });
        assert.deepEqual(entries.map((entry) => entry.title), ['All day', 'Early', 'Late', 'Next day']);
    });
});

describe('days and months', () => {
    const entries = buildCalendarEntries({
        leads: [lead({ event_date: '2027-05-14', end_date: '2027-05-16' })],
        items: [item({ starts_at: '2027-05-15', title: 'Dentist' })],
    });

    it('lists a multi-day event on every day it covers', () => {
        const days = entriesByDay(entries, '2027-05-01', '2027-05-31');
        assert.deepEqual([...days.keys()], ['2027-05-14', '2027-05-15', '2027-05-16', '2027-05-17']);
        assert.deepEqual(days.get('2027-05-15')!.map((entry) => entry.title), ["Emory's event", 'Dentist']);
        assert.deepEqual(days.get('2027-05-14')!.map((entry) => entry.title), ["Emory's event"]);
        assert.equal(days.get('2027-05-17')![0]!.type, 'delivery');
    });

    it('cuts a range at its edges', () => {
        assert.deepEqual(keys(entriesInRange(entries, '2027-05-16', '2027-05-16')), ['lead-event:lead-1']);
        assert.deepEqual(keys(entriesInRange(entries, '2027-05-17', '2027-05-20')), ['lead-delivery:lead-1']);
        assert.deepEqual(entriesInRange(entries, '2027-06-01', '2027-06-30'), []);
        assert.deepEqual([...entriesByDay(entries, '2027-05-15', '2027-05-15').keys()], ['2027-05-15']);
    });

    it('lays out a month in weeks that start on Sunday', () => {
        const weeks = monthGrid('2027-05'); // May 1, 2027 is a Saturday
        assert.equal(weeks.length, 6);
        assert.ok(weeks.every((week) => week.length === 7));
        assert.deepEqual([weeks[0]![0]!.date, weeks[0]![6]!.date], ['2027-04-25', '2027-05-01']);
        assert.deepEqual([weeks[0]![5]!.inMonth, weeks[0]![6]!.inMonth], [false, true]);
        assert.equal(weeks.at(-1)![6]!.date, '2027-06-05');

        assert.equal(monthGrid('2026-02').length, 4); // Feb 2026 starts on a Sunday and has 28 days
        assert.equal(monthGrid('2027-02')[0]![0]!.date, '2027-01-31');
        assert.equal(monthGrid('2028-02').flat().filter((day) => day.inMonth).length, 29);
    });

    it('moves between months across year ends and validates month text', () => {
        assert.equal(shiftMonth('2026-12', 1), '2027-01');
        assert.equal(shiftMonth('2027-01', -1), '2026-12');
        assert.equal(shiftMonth('2026-05', 14), '2027-07');
        assert.equal(isMonth('2027-05'), true);
        for (const bad of ['2027-13', '2027-00', '27-05', '2027-5', '', null, undefined]) assert.equal(isMonth(bad as string), false);
    });
});

describe('the phone feed (.ics)', () => {
    const now = new Date('2026-10-03T12:00:00Z');
    const timedStart = easternToUtc('2026-10-17', '16:30')!.toISOString();
    const timedEnd = easternToUtc('2026-10-17', '17:15')!.toISOString();
    const entries = buildCalendarEntries({
        leads: [lead({ first_name: 'Emory', location: 'Atlanta, GA', event_date: '2027-05-14', end_date: '2027-05-16' }), lead({ id: 'lead-2', first_name: 'Lani', last_name: 'Pinckney', stage: 'consultation', next_follow_up_at: '2026-10-20', event_date: null })],
        items: [
            item({ id: 'c', lead_id: 'lead-2', type: 'consultation', title: 'Call Lani about 555-0100, pricing $500; bring contract', starts_at: timedStart, ends_at: timedEnd, all_day: 0, notes: 'Her number is 770-555-0188 and she can pay $300 retainer' }),
            item({ id: 'p', title: 'Dentist, with Dr. Lee; bring forms', location: '12 Home St, Decatur' }),
        ],
    });
    const ics = buildIcs(entries, { now });

    it('is a valid calendar file: CRLF lines, begin and end, and a stable id per entry', () => {
        assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
        assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
        assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false);
        assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, entries.length);
        assert.equal((ics.match(/END:VEVENT/g) ?? []).length, entries.length);
        const uids = [...ics.matchAll(/UID:(.+)\r\n/g)].map((match) => match[1]);
        assert.equal(new Set(uids).size, uids.length);
        assert.ok(uids.includes('lead-event:lead-1@curatedbynat.com'));
        assert.ok(ics.includes('DTSTAMP:20261003T120000Z'));
        assert.ok(ics.includes('X-WR-TIMEZONE:America/New_York'));
    });

    it('writes all-day dates as dates, with the end day one later', () => {
        assert.ok(ics.includes('DTSTART;VALUE=DATE:20270514\r\nDTEND;VALUE=DATE:20270517\r\n')); // 14th to 16th
        assert.ok(ics.includes('DTSTART;VALUE=DATE:20270517\r\nDTEND;VALUE=DATE:20270518\r\n')); // the delivery
    });

    it('writes timed items in UTC, converted from Eastern', () => {
        assert.ok(ics.includes('DTSTART:20261017T203000Z\r\nDTEND:20261017T211500Z\r\n')); // 4:30 PM EDT to 5:15 PM EDT
    });

    it('gives a one-hour slot to a timed item with no end', () => {
        const open = buildIcs(buildCalendarEntries({ leads: [], items: [item({ id: 'x', starts_at: timedStart, ends_at: null, all_day: 0 })] }), { now });
        assert.ok(open.includes('DTSTART:20261017T203000Z\r\nDTEND:20261017T213000Z\r\n'));
    });

    it('shows a client only as first name, kind of thing and city', () => {
        assert.ok(ics.includes('SUMMARY:Event: Emory\r\n'));
        assert.ok(ics.includes('SUMMARY:Consultation: Lani\r\n'));
        assert.ok(ics.includes('SUMMARY:Follow-up: Lani\r\n'));
        assert.ok(ics.includes('LOCATION:Atlanta\\, GA\r\n'));
        assert.equal(feedSummary(entries.find((entry) => entry.itemId === 'c')!), 'Consultation: Lani');
    });

    it('never includes surnames, titles about clients, notes, phone numbers or money', () => {
        const lower = ics.toLowerCase();
        for (const secret of ['Morris', 'Pinckney', '555', '770', '$', 'pricing', 'retainer', 'Her number', 'call lani about']) {
            assert.equal(lower.includes(secret.toLowerCase()), false, secret);
        }
        assert.equal(/mailto:|tel:|ATTENDEE|ORGANIZER|DESCRIPTION:(?!Event tomorrow|Starting soon)/.test(ics), false);
    });

    it('keeps the title of something that is not about a client, escaped', () => {
        assert.ok(ics.includes('SUMMARY:Dentist\\, with Dr. Lee\; bring forms\r\n'));
        assert.ok(ics.includes('LOCATION:12 Home St\\, Decatur\r\n'));
    });

    it('sets a reminder the morning before an event and an hour before an appointment', () => {
        assert.ok(ics.includes('TRIGGER:-PT15H'));
        assert.ok(ics.includes('TRIGGER:-PT1H'));
    });
});

describe('calendar file text rules', () => {
    it('escapes commas, semicolons, backslashes and line breaks', () => {
        assert.equal(escapeText('a, b; c \\ d\ne\r\nf'), 'a\\, b\; c \\\\ d\\ne\\nf');
    });

    it('folds long lines at 75 bytes without splitting a character', () => {
        const long = `SUMMARY:${'é'.repeat(80)}`;
        const folded = foldLine(long);
        const lines = folded.split('\r\n');
        assert.ok(lines.length > 1);
        for (const [index, line] of lines.entries()) {
            assert.ok(new TextEncoder().encode(line).length <= 75, `line ${index}`);
            if (index > 0) assert.ok(line.startsWith(' '));
        }
        assert.equal(lines.map((line, index) => (index === 0 ? line : line.slice(1))).join(''), long);
        assert.equal(foldLine('SHORT:line'), 'SHORT:line');
    });
});
