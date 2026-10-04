// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    celebratingOf,
    changeStage,
    createLead,
    fullName,
    getLead,
    getSettings,
    listActivities,
    listLeads,
    logActivity,
    markLost,
    reopenLead,
    restoreLead,
    setFollowUp,
    softDeleteLead,
    stageCounts,
    updateLead,
} from '../../src/lib/studio/queries.ts';
import { validateLeadFields, type LeadFields } from '../../src/lib/studio/validate.ts';
import { createTestD1 } from './helpers/d1-sqlite.ts';

const NAT = 'hello@curatedbynat.com';
const at = (iso: string) => ({ actor: NAT, now: new Date(iso) });

function fields(overrides: Record<string, string | string[]> = {}): LeadFields {
    const result = validateLeadFields({ first_name: 'Ava', last_name: 'Lee', email: 'ava@example.com', phone: '(404) 555-0100', source: 'instagram', celebrating: ['wedding'], event_date: '2027-05-15', ...overrides });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.value;
}

async function newLead(db: ReturnType<typeof createTestD1>, overrides: Record<string, string | string[]> = {}, when = '2026-10-01T14:00:00Z') {
    const created = await createLead(db, fields(overrides), at(when));
    assert.equal(created.ok, true);
    return (created as { id: string }).id;
}

describe('creating and editing leads', () => {
    it('adds a lead by hand in the New stage with a first note on its timeline', async () => {
        const db = createTestD1();
        const id = await newLead(db);
        const lead = (await getLead(db, id))!;
        assert.equal(lead.stage, 'new');
        assert.equal(lead.source, 'instagram');
        assert.equal(lead.email_key, 'ava@example.com');
        assert.deepEqual(celebratingOf(lead), ['wedding']);
        assert.equal(fullName(lead), 'Ava Lee');
        const activities = await listActivities(db, id);
        assert.deepEqual(activities.map((a) => [a.type, a.body, a.actor_email]), [['system', 'Added by hand.', NAT]]);
    });

    it('refuses a second open lead with the same email and says which one', async () => {
        const db = createTestD1();
        const first = await newLead(db);
        const second = await createLead(db, fields({ first_name: 'Other', email: 'AVA@example.com' }), at('2026-10-02T00:00:00Z'));
        assert.deepEqual(second, { ok: false, error: 'duplicate-email', conflictLeadId: first });
    });

    it('edits details, and refuses a change that would clash with another open lead', async () => {
        const db = createTestD1();
        const ava = await newLead(db);
        const bea = await newLead(db, { first_name: 'Bea', email: 'bea@example.com' });
        assert.deepEqual(await updateLead(db, ava, fields({ phone: '555-1212', location: 'Savannah' }), at('2026-10-03T00:00:00Z')), { ok: true });
        assert.equal((await getLead(db, ava))!.location, 'Savannah');
        assert.deepEqual(await updateLead(db, bea, fields({ first_name: 'Bea', email: 'ava@example.com' }), at('2026-10-03T00:00:00Z')), {
            ok: false,
            error: 'duplicate-email',
            conflictLeadId: ava,
        });
        assert.deepEqual(await updateLead(db, 'missing', fields(), at('2026-10-03T00:00:00Z')), { ok: false, error: 'not-found' });
    });
});

describe('stages', () => {
    it('moves a lead and writes it on the timeline with who did it', async () => {
        const db = createTestD1();
        const id = await newLead(db);
        assert.deepEqual(await changeStage(db, id, 'consultation', at('2026-10-02T10:00:00Z')), { ok: true });
        const lead = (await getLead(db, id))!;
        assert.equal(lead.stage, 'consultation');
        const [latest] = await listActivities(db, id);
        assert.deepEqual([latest!.type, latest!.body, latest!.actor_email], ['stage_change', 'Moved from New to Consultation.', NAT]);
    });

    it('rejects unknown stages and does nothing when the stage is unchanged', async () => {
        const db = createTestD1();
        const id = await newLead(db);
        assert.deepEqual(await changeStage(db, id, 'lost', at('2026-10-02T10:00:00Z')), { ok: false, error: 'invalid' });
        assert.deepEqual(await changeStage(db, id, 'new', at('2026-10-02T10:00:00Z')), { ok: true });
        assert.equal((await listActivities(db, id)).length, 1);
    });

    it('marks a lead lost with a reason, remembers where it was, and reopens it there', async () => {
        const db = createTestD1();
        const id = await newLead(db);
        await changeStage(db, id, 'packages_sent', at('2026-10-02T10:00:00Z'));
        assert.deepEqual(await markLost(db, id, '  ', at('2026-10-03T10:00:00Z')), { ok: false, error: 'invalid' });
        assert.deepEqual(await markLost(db, id, 'Over budget', at('2026-10-03T10:00:00Z')), { ok: true });
        const lost = (await getLead(db, id))!;
        assert.deepEqual([lost.stage, lost.lost_reason, lost.stage_before_lost], ['lost', 'Over budget', 'packages_sent']);

        assert.deepEqual(await reopenLead(db, id, at('2026-10-04T10:00:00Z')), { ok: true });
        const back = (await getLead(db, id))!;
        assert.deepEqual([back.stage, back.lost_reason, back.stage_before_lost], ['packages_sent', null, null]);
    });

    it('cannot reopen a lost lead when someone else now holds the same email', async () => {
        const db = createTestD1();
        const first = await newLead(db);
        await markLost(db, first, 'No response', at('2026-10-03T10:00:00Z'));
        const second = await newLead(db, { first_name: 'Ava again' });
        assert.deepEqual(await reopenLead(db, first, at('2026-10-04T10:00:00Z')), { ok: false, error: 'duplicate-email', conflictLeadId: second });
    });

    it('counts leads in each stage, leaving out deleted ones', async () => {
        const db = createTestD1();
        const a = await newLead(db);
        await newLead(db, { first_name: 'Bea', email: 'bea@example.com' });
        const c = await newLead(db, { first_name: 'Cy', email: 'cy@example.com' });
        await changeStage(db, c, 'booked', at('2026-10-02T10:00:00Z'));
        await softDeleteLead(db, a, at('2026-10-02T10:00:00Z'));
        assert.deepEqual(await stageCounts(db), { new: 1, booked: 1 });
    });
});

describe('logging contact', () => {
    it('updates last contacted, moves a New lead to Contacted and clears a follow-up that has come', async () => {
        const db = createTestD1();
        const id = await newLead(db);
        await setFollowUp(db, id, '2026-10-05', at('2026-10-02T10:00:00Z'));
        assert.deepEqual(await logActivity(db, id, { type: 'call', body: 'Left a voicemail' }, at('2026-10-05T18:00:00Z')), { ok: true });

        const lead = (await getLead(db, id))!;
        assert.equal(lead.last_contacted_at, '2026-10-05T18:00:00.000Z');
        assert.equal(lead.stage, 'contacted');
        assert.equal(lead.next_follow_up_at, null);
        const types = (await listActivities(db, id)).map((a) => a.type);
        assert.deepEqual(types.sort(), ['call', 'stage_change', 'system']);
    });

    it('keeps a follow-up date that is still ahead and leaves other stages alone', async () => {
        const db = createTestD1();
        const id = await newLead(db);
        await changeStage(db, id, 'consultation', at('2026-10-02T10:00:00Z'));
        await setFollowUp(db, id, '2026-10-20', at('2026-10-02T10:00:00Z'));
        await logActivity(db, id, { type: 'text' }, at('2026-10-06T18:00:00Z'));
        const lead = (await getLead(db, id))!;
        assert.equal(lead.stage, 'consultation');
        assert.equal(lead.next_follow_up_at, '2026-10-20');
    });

    it('a note is not contact', async () => {
        const db = createTestD1();
        const id = await newLead(db);
        await logActivity(db, id, { type: 'note', body: 'Wants a sunset first look' }, at('2026-10-06T18:00:00Z'));
        const lead = (await getLead(db, id))!;
        assert.equal(lead.last_contacted_at, null);
        assert.equal(lead.stage, 'new');
    });

    it('rejects empty notes, system types and unknown leads', async () => {
        const db = createTestD1();
        const id = await newLead(db);
        assert.deepEqual(await logActivity(db, id, { type: 'note', body: '  ' }, at('2026-10-06T18:00:00Z')), { ok: false, error: 'invalid' });
        assert.deepEqual(await logActivity(db, id, { type: 'system', body: 'x' }, at('2026-10-06T18:00:00Z')), { ok: false, error: 'invalid' });
        assert.deepEqual(await logActivity(db, id, { type: 'stage_change', body: 'x' }, at('2026-10-06T18:00:00Z')), { ok: false, error: 'invalid' });
        assert.deepEqual(await logActivity(db, 'missing', { type: 'call' }, at('2026-10-06T18:00:00Z')), { ok: false, error: 'not-found' });
    });
});

describe('deleting', () => {
    it('hides a lead, records who did it, and restores it', async () => {
        const db = createTestD1();
        const id = await newLead(db);
        await softDeleteLead(db, id, at('2026-10-02T10:00:00Z'));
        assert.equal(await getLead(db, id), null);
        assert.equal((await getLead(db, id, { includeDeleted: true }))!.deleted_at, '2026-10-02T10:00:00.000Z');
        assert.equal((await listLeads(db)).length, 0);
        assert.equal((await listLeads(db, { deleted: true })).length, 1);

        const audit = db.raw.prepare("SELECT actor_email, action, entity FROM audit_log WHERE entity_id = ?").get(id);
        assert.deepEqual({ ...audit }, { actor_email: NAT, action: 'delete', entity: 'lead' });

        assert.deepEqual(await restoreLead(db, id, at('2026-10-03T10:00:00Z')), { ok: true });
        assert.equal((await getLead(db, id))!.deleted_at, null);
    });

    it('frees the email for a new lead while deleted, and then refuses to restore over it', async () => {
        const db = createTestD1();
        const first = await newLead(db);
        await softDeleteLead(db, first, at('2026-10-02T10:00:00Z'));
        const second = await newLead(db, { first_name: 'Replacement' });
        assert.deepEqual(await restoreLead(db, first, at('2026-10-03T10:00:00Z')), { ok: false, error: 'duplicate-email', conflictLeadId: second });
    });
});

describe('searching and filtering', () => {
    async function setup() {
        const db = createTestD1();
        const ava = await newLead(db, { first_name: 'Ava', last_name: 'Lee', email: 'ava@example.com', phone: '(404) 555-0100', source: 'instagram', celebrating: ['wedding'], event_date: '2027-05-15', instagram: '@avalee' });
        const bea = await newLead(db, { first_name: 'Bea', last_name: 'Cho', email: 'bea@example.com', phone: '770.555.0199', source: 'referral', celebrating: ['bachelorette', 'celebration'], event_date: '2027-06-01' }, '2026-10-02T14:00:00Z');
        const cy = await newLead(db, { first_name: 'Cy', last_name: '100%_sure', email: 'cy@example.com', phone: '', source: 'tiktok', celebrating: ['wedding'], date_not_set: 'on' }, '2026-10-03T14:00:00Z');
        return { db, ava, bea, cy };
    }

    it('finds people by name, email, phone and Instagram', async () => {
        const { db, ava, bea } = await setup();
        const names = async (q: string) => (await listLeads(db, { q })).map((lead) => lead.first_name);
        assert.deepEqual(await names('ava'), ['Ava']);
        assert.deepEqual(await names('Lee'), ['Ava']);
        assert.deepEqual(await names('ava lee'), ['Ava']);
        assert.deepEqual(await names('bea@example'), ['Bea']);
        assert.deepEqual(await names('404 555'), ['Ava']); // digits are matched against the phone number
        assert.deepEqual(await names('4045550100'), ['Ava']);
        assert.deepEqual(await names('555-0199'), ['Bea']);
        assert.deepEqual(await names('avalee'), ['Ava']);
        assert.equal(ava.length > 0 && bea.length > 0, true);
    });

    it('treats % and _ in a search as plain characters', async () => {
        const { db } = await setup();
        assert.deepEqual((await listLeads(db, { q: '%_s' })).map((lead) => lead.first_name), ['Cy']);
        assert.deepEqual((await listLeads(db, { q: '%' })).map((lead) => lead.first_name), ['Cy']);
    });

    it('does not run search text as SQL', async () => {
        const { db } = await setup();
        assert.deepEqual(await listLeads(db, { q: "'; DROP TABLE leads; --" }), []);
        assert.equal((await listLeads(db)).length, 3);
    });

    it('filters by stage, celebrating type, source and event month', async () => {
        const { db, bea } = await setup();
        await changeStage(db, bea, 'consultation', at('2026-10-04T00:00:00Z'));
        const names = async (filter: Parameters<typeof listLeads>[1]) => (await listLeads(db, filter)).map((lead) => lead.first_name);
        assert.deepEqual(await names({ stage: 'consultation' }), ['Bea']);
        assert.deepEqual(await names({ celebrating: 'wedding' }), ['Ava', 'Cy']);
        assert.deepEqual(await names({ celebrating: 'celebration' }), ['Bea']);
        assert.deepEqual(await names({ source: 'tiktok' }), ['Cy']);
        assert.deepEqual(await names({ month: '2027-06' }), ['Bea']);
        assert.deepEqual(await names({ celebrating: 'wedding', month: '2027-05' }), ['Ava']);
    });

    it('lists leads by event date, with undated leads last', async () => {
        const { db } = await setup();
        assert.deepEqual((await listLeads(db)).map((lead) => lead.first_name), ['Ava', 'Bea', 'Cy']);
    });
});

describe('settings', () => {
    it('reads the defaults and survives bad values', async () => {
        const db = createTestD1();
        assert.deepEqual(await getSettings(db), {
            followUpDays: 5,
            lostReasons: ['Booked someone else', 'Over budget', 'Date unavailable', 'No response', 'Not a fit', 'Other'],
        });
        db.raw.prepare("UPDATE settings SET value = '\"seven\"' WHERE key = 'follow_up_days'").run();
        db.raw.prepare("UPDATE settings SET value = '[]' WHERE key = 'lost_reasons'").run();
        assert.equal((await getSettings(db)).followUpDays, 5);
        assert.equal((await getSettings(db)).lostReasons.length, 6);
        db.raw.prepare("UPDATE settings SET value = '3' WHERE key = 'follow_up_days'").run();
        assert.equal((await getSettings(db)).followUpDays, 3);
    });
});
