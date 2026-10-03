// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createCalendarItem,
    deleteCalendarItem,
    getCalendarItem,
    getFeedToken,
    listCalendarItems,
    loadCalendar,
    resetFeedToken,
    tokensMatch,
    updateCalendarItem,
} from '../../src/lib/studio/calendarDb.ts';
import { createLead, changeStage, setFollowUp, softDeleteLead } from '../../src/lib/studio/queries.ts';
import { validateCalendarItem, validateLeadFields } from '../../src/lib/studio/validate.ts';
import { createTestD1 } from './helpers/d1-sqlite.ts';

const NAT = 'hello@curatedbynat.com';
const at = (iso: string) => ({ actor: NAT, now: new Date(iso) });

function input(raw: Record<string, string>) {
    const checked = validateCalendarItem(raw);
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
    return checked.value;
}

async function setup() {
    const db = createTestD1();
    const lead = validateLeadFields({ first_name: 'Ava', email: 'ava@example.com', event_date: '2027-05-15', location: 'Atlanta, GA' });
    if (!lead.ok) throw new Error('bad');
    const leadId = ((await createLead(db, lead.value, at('2026-10-01T14:00:00Z'))) as { id: string }).id;
    return { db, leadId };
}

describe('validateCalendarItem', () => {
    it('reads an all-day item', () => {
        assert.deepEqual(input({ type: 'personal', title: ' Dentist ', date: '2026-10-17', all_day: 'on' }), {
            type: 'personal', title: 'Dentist', leadId: null, startsAt: '2026-10-17', endsAt: null, allDay: true, location: '', notes: '',
        });
        assert.equal(input({ type: 'event', title: 'Trip', date: '2026-10-17', all_day: '1', end_date: '2026-10-19' }).endsAt, '2026-10-19');
    });

    it('turns Eastern times into UTC moments', () => {
        const item = input({ type: 'consultation', title: 'Call', date: '2026-10-17', start_time: '16:30', end_time: '17:15' });
        assert.deepEqual([item.startsAt, item.endsAt, item.allDay], ['2026-10-17T20:30:00.000Z', '2026-10-17T21:15:00.000Z', false]);
        const overnight = input({ type: 'event', title: 'Late', date: '2026-10-17', start_time: '22:00', end_date: '2026-10-18', end_time: '02:00' });
        assert.equal(overnight.endsAt, '2026-10-18T06:00:00.000Z');
    });

    it('lets a client item go without a title but not anything else', () => {
        const lead = '123e4567-e89b-42d3-a456-426614174000';
        assert.equal(input({ type: 'consultation', lead_id: lead, date: '2026-10-17', start_time: '10:00' }).title, '');
        const errors = (raw: Record<string, string>) => {
            const checked = validateCalendarItem(raw);
            return checked.ok ? {} : checked.errors;
        };
        assert.ok(errors({ type: 'personal', date: '2026-10-17', all_day: 'on' }).title);
        assert.ok(errors({ type: 'nope', title: 'x', date: '2026-10-17', all_day: 'on' }).type);
        assert.ok(errors({ type: 'personal', title: 'x', date: '2026-02-30', all_day: 'on' }).date);
        assert.ok(errors({ type: 'personal', title: 'x', date: '2026-10-17' }).start_time);
        assert.ok(errors({ type: 'personal', title: 'x', date: '2026-10-17', start_time: '10:00', end_time: '09:00' }).end_time);
        assert.ok(errors({ type: 'personal', title: 'x', date: '2026-10-17', all_day: 'on', end_date: '2026-10-10' }).end_date);
        assert.ok(errors({ type: 'personal', title: 'x', date: '2026-10-17', all_day: 'on', lead_id: 'not-an-id' }).lead_id);
        assert.ok(errors({ type: 'personal', title: 'x'.repeat(121), date: '2026-10-17', all_day: 'on' }).title);
    });
});

describe('calendar items', () => {
    it('creates, edits and deletes an item and leaves a trail', async () => {
        const { db, leadId } = await setup();
        const created = await createCalendarItem(db, input({ type: 'consultation', title: 'Planning call', lead_id: leadId, date: '2026-10-17', start_time: '16:30' }), at('2026-10-02T10:00:00Z'));
        assert.equal(created.ok, true);
        const id = created.id!;
        assert.equal((await getCalendarItem(db, id))!.title, 'Planning call');

        assert.deepEqual(await updateCalendarItem(db, id, input({ type: 'consultation', title: 'Planning call (moved)', lead_id: leadId, date: '2026-10-18', start_time: '10:00' }), at('2026-10-03T10:00:00Z')), { ok: true });
        assert.equal((await getCalendarItem(db, id))!.starts_at, '2026-10-18T14:00:00.000Z');

        assert.deepEqual(await deleteCalendarItem(db, id, at('2026-10-04T10:00:00Z')), { ok: true });
        assert.equal(await getCalendarItem(db, id), null);
        assert.deepEqual(await deleteCalendarItem(db, id, at('2026-10-04T10:00:00Z')), { ok: false, error: 'not-found' });

        const audit = db.raw.prepare("SELECT action, actor_email FROM audit_log WHERE entity = 'calendar_item' ORDER BY rowid").all().map((row) => ({ ...row }));
        assert.deepEqual(audit, [{ action: 'create', actor_email: NAT }, { action: 'update', actor_email: NAT }, { action: 'delete', actor_email: NAT }]);
    });

    it('refuses an item for a client that does not exist', async () => {
        const { db } = await setup();
        const result = await createCalendarItem(db, input({ type: 'consultation', lead_id: '123e4567-e89b-42d3-a456-426614174000', date: '2026-10-17', all_day: 'on' }), at('2026-10-02T10:00:00Z'));
        assert.deepEqual(result, { ok: false, error: 'not-found' });
    });

    it('combines items with dates from the leads, and follows the lead when it changes', async () => {
        const { db, leadId } = await setup();
        await createCalendarItem(db, input({ type: 'personal', title: 'Dentist', date: '2026-10-17', all_day: 'on' }), at('2026-10-02T10:00:00Z'));
        assert.deepEqual((await loadCalendar(db)).map((entry) => entry.key.split(':')[0]), ['item']);

        await changeStage(db, leadId, 'booked', at('2026-10-03T10:00:00Z'));
        const booked = await loadCalendar(db);
        assert.deepEqual(booked.filter((entry) => entry.auto).map((entry) => [entry.type, entry.date]), [['event', '2027-05-15'], ['delivery', '2027-05-16']]);

        db.raw.prepare("UPDATE leads SET event_date = '2027-06-12' WHERE id = ?").run(leadId);
        assert.deepEqual((await loadCalendar(db)).filter((entry) => entry.type === 'event').map((entry) => entry.date), ['2027-06-12']);

        await softDeleteLead(db, leadId, at('2026-10-04T10:00:00Z'));
        assert.deepEqual((await loadCalendar(db)).map((entry) => entry.key.split(':')[0]), ['item']);
    });

    it('shows a follow-up date, then drops it once the lead is booked', async () => {
        const { db, leadId } = await setup();
        await setFollowUp(db, leadId, '2026-10-20', at('2026-10-02T10:00:00Z'));
        assert.deepEqual((await loadCalendar(db)).map((entry) => [entry.type, entry.date]), [['follow_up', '2026-10-20']]);
        await changeStage(db, leadId, 'booked', at('2026-10-03T10:00:00Z'));
        assert.equal((await loadCalendar(db)).some((entry) => entry.type === 'follow_up'), false);
        assert.equal((await listCalendarItems(db)).length, 0);
    });
});

describe('the feed secret', () => {
    it('is made once, long and random, then stays the same', async () => {
        const { db } = await setup();
        const first = await getFeedToken(db);
        assert.match(first, /^[A-Za-z0-9_-]{43}$/);
        assert.equal(await getFeedToken(db), first);
    });

    it('can be reset, and the old one stops matching', async () => {
        const { db } = await setup();
        const old = await getFeedToken(db);
        const fresh = await resetFeedToken(db, NAT, new Date('2026-10-05T00:00:00Z'));
        assert.notEqual(fresh, old);
        assert.equal(await getFeedToken(db), fresh);
        assert.equal(await tokensMatch(old, fresh), false);
        assert.equal(await tokensMatch(fresh, fresh), true);
        const audit = db.raw.prepare("SELECT actor_email, action FROM audit_log WHERE entity = 'calendar_feed'").all().map((row) => ({ ...row }));
        assert.ok(audit.some((row) => (row as { actor_email: string }).actor_email === NAT));
    });

    it('replaces a damaged value', async () => {
        const { db } = await setup();
        db.raw.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('calendar_feed_token', 'oops', 'x')").run();
        assert.match(await getFeedToken(db), /^[A-Za-z0-9_-]{43}$/);
    });

    it('compares secrets without caring about length or content', async () => {
        assert.equal(await tokensMatch('', 'abc'), false);
        assert.equal(await tokensMatch('abc', 'abcd'), false);
        assert.equal(await tokensMatch('abc', 'abc'), true);
        assert.equal(await tokensMatch('é', 'e'), false);
    });
});
