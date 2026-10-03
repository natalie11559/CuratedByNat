// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { saveGeneralSettings, deleteTemplate, getTemplate, isPurgeable, listDeletedCalendarItems, listDeletedFiles, listTemplates, purgeCalendarItem, purgeDate, purgeFile, purgeLead, restoreCalendarItem, saveTemplate } from '../../src/lib/studio/admin.ts';
import { addPayment, createBooking } from '../../src/lib/studio/bookings.ts';
import { createCalendarItem, listCalendarItems } from '../../src/lib/studio/calendarDb.ts';
import { clientsCsv, CSV_HEADINGS, listClients } from '../../src/lib/studio/clients.ts';
import { centsToNumber, csvCell, toCsv } from '../../src/lib/studio/csv.ts';
import { getFile, listFiles, removeFile, saveFile } from '../../src/lib/studio/files.ts';
import { syncUnlinkedInquiries } from '../../src/lib/studio/leads.ts';
import { changeStage, createLead, getLead, getSettings, listActivities, logActivity, softDeleteLead } from '../../src/lib/studio/queries.ts';
import { validateBookingInput, validateCalendarItem, validateLeadFields } from '../../src/lib/studio/validate.ts';
import { createTestD1 } from './helpers/d1-sqlite.ts';
import { FakeR2 } from './helpers/fake-r2.ts';

const NAT = 'hello@curatedbynat.com';
const at = (iso: string) => ({ actor: NAT, now: new Date(iso) });
const PDF = new TextEncoder().encode('%PDF-1.4 hello').buffer as ArrayBuffer;

async function lead(db: ReturnType<typeof createTestD1>, raw: Record<string, string | string[]>, when = '2026-10-01T14:00:00Z') {
    const checked = validateLeadFields(raw);
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
    return ((await createLead(db, checked.value, at(when))) as { id: string }).id;
}

describe('csv', () => {
    it('quotes every cell and doubles quotes', () => {
        assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
        assert.equal(csvCell(null), '""');
        assert.equal(csvCell(5), '"5"');
        assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
    });

    it('stops spreadsheet formulas from running', () => {
        for (const evil of ['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd']) {
            assert.ok(csvCell(evil).startsWith('"\''), evil);
        }
        assert.equal(csvCell('safe = fine'), '"safe = fine"');
        assert.equal(csvCell('(404) 555-0100'), '"(404) 555-0100"');
    });

    it('writes rows with Windows line endings and a mark so accents survive in Excel', () => {
        const text = toCsv([['a', 'b'], ['é', '1']]);
        assert.ok(text.startsWith('﻿"a","b"\r\n'));
        assert.ok(text.endsWith('"é","1"\r\n'));
    });

    it('writes money as plain numbers', () => {
        assert.equal(centsToNumber(125050), '1250.50');
        assert.equal(centsToNumber(30000), '300.00');
    });
});

describe('the Clients list', () => {
    async function setup() {
        const db = createTestD1();
        const ava = await lead(db, { first_name: 'Ava', last_name: 'Lee', email: 'ava@example.com', phone: '(404) 555-0100', event_date: '2027-06-01', celebrating: ['wedding'], source: 'instagram' }, '2026-10-01T14:00:00Z');
        const bea = await lead(db, { first_name: 'bea', last_name: 'Cho', email: 'bea@example.com', event_date: '2027-05-01', source: 'referral' }, '2026-10-02T14:00:00Z');
        const cy = await lead(db, { first_name: 'Cy', last_name: '=cmd|calc', email: 'cy@example.com', date_not_set: 'on' }, '2026-10-03T14:00:00Z');
        return { db, ava, bea, cy };
    }
    const names = async (db: ReturnType<typeof createTestD1>, filter: Parameters<typeof listClients>[1]) => (await listClients(db, filter)).map((client) => client.first_name);

    it('sorts by name, event date (undated last), date added and stage, either way', async () => {
        const { db, bea } = await setup();
        await changeStage(db, bea, 'consultation', at('2026-10-04T00:00:00Z'));
        assert.deepEqual(await names(db, { sort: 'name' }), ['Ava', 'bea', 'Cy']);
        assert.deepEqual(await names(db, { sort: 'name', dir: 'desc' }), ['Cy', 'bea', 'Ava']);
        assert.deepEqual(await names(db, { sort: 'event' }), ['bea', 'Ava', 'Cy']);
        assert.deepEqual(await names(db, { sort: 'event', dir: 'desc' }), ['Ava', 'bea', 'Cy']);
        assert.deepEqual(await names(db, { sort: 'created', dir: 'desc' }), ['Cy', 'bea', 'Ava']);
        assert.deepEqual(await names(db, { sort: 'stage' }), ['Ava', 'Cy', 'bea']);
        assert.deepEqual(await names(db, { sort: 'bogus' as never }), ['Ava', 'bea', 'Cy']);
    });

    it('searches and filters by stage, and leaves out deleted people', async () => {
        const { db, ava, bea } = await setup();
        assert.deepEqual(await names(db, { q: 'lee' }), ['Ava']);
        assert.deepEqual(await names(db, { q: '4045550100' }), ['Ava']);
        assert.deepEqual(await names(db, { q: "'; DROP TABLE leads;--" }), []);
        await changeStage(db, bea, 'delivered', at('2026-10-04T00:00:00Z'));
        assert.deepEqual(await names(db, { stage: 'delivered' }), ['bea']);
        await softDeleteLead(db, ava, at('2026-10-05T00:00:00Z'));
        assert.deepEqual(await names(db, {}), ['bea', 'Cy']);
    });

    it('adds up what each person has booked and paid', async () => {
        const { db, ava } = await setup();
        const input = validateBookingInput({ package_id: 'custom', custom_name: 'Day', custom_price: '500', retainer: '100' }, { packages: [], extras: [] });
        if (!input.ok) throw new Error('bad');
        const booking = await createBooking(db, ava, input.value, at('2026-10-05T00:00:00Z'));
        await addPayment(db, booking.id!, { amountCents: 15000, receivedOn: '2026-10-06', method: 'venmo', note: '' }, at('2026-10-06T00:00:00Z'));
        const [client] = await listClients(db, { q: 'ava' });
        assert.deepEqual([client!.total_cents, client!.paid_cents, client!.packages], [50000, 15000, 'Day']);
    });

    it('exports a spreadsheet with a header row, safe cells and plain-number money', async () => {
        const { db, ava } = await setup();
        const input = validateBookingInput({ package_id: 'custom', custom_name: 'Day', custom_price: '500' }, { packages: [], extras: [] });
        if (!input.ok) throw new Error('bad');
        const booking = await createBooking(db, ava, input.value, at('2026-10-05T00:00:00Z'));
        await addPayment(db, booking.id!, { amountCents: 15050, receivedOn: '2026-10-06', method: 'venmo', note: '' }, at('2026-10-06T00:00:00Z'));
        await logActivity(db, ava, { type: 'call' }, at('2026-10-07T16:00:00Z'));

        const csv = clientsCsv(await listClients(db, { sort: 'name' }));
        const rows = csv.replace('﻿', '').trimEnd().split('\r\n');
        assert.equal(rows[0], CSV_HEADINGS.map((heading) => `"${heading}"`).join(','));
        assert.equal(rows.length, 4);
        const avaRow = rows.find((row) => row.startsWith('"Ava"'))!;
        assert.ok(avaRow.includes('"Booked"') || avaRow.includes('"Contacted"'));
        assert.ok(avaRow.includes('"500.00","150.50","349.50"'), avaRow);
        assert.ok(avaRow.includes('"2027-06-01"'));
        assert.ok(avaRow.includes('"2026-10-07"'));
        assert.ok(rows.some((row) => row.includes(`"'=cmd|calc"`)), 'a formula in a name is neutralised');
    });
});

describe('settings and templates', () => {
    it('saves follow-up days and lost reasons where the rest of Studio reads them', async () => {
        const db = createTestD1();
        await saveGeneralSettings(db, { followUpDays: 8, lostReasons: ['Too far', 'Other'] }, at('2026-10-05T00:00:00Z'));
        assert.deepEqual(await getSettings(db), { followUpDays: 8, lostReasons: ['Too far', 'Other'] });
        assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'settings'").get()!.n, 1);
    });

    it('adds, edits and deletes templates, and keeps the four drafts that ship', async () => {
        const db = createTestD1();
        assert.equal((await listTemplates(db)).length, 4);
        const created = await saveTemplate(db, null, { name: 'Mine', subject: 'Hi {first_name}', body: 'Body', sortOrder: 99, isDraft: false }, at('2026-10-05T00:00:00Z'));
        assert.equal((await getTemplate(db, created.id!))!.name, 'Mine');
        await saveTemplate(db, created.id!, { name: 'Mine v2', subject: 'S', body: 'B', sortOrder: 1, isDraft: true }, at('2026-10-06T00:00:00Z'));
        assert.deepEqual([(await getTemplate(db, created.id!))!.name, (await getTemplate(db, created.id!))!.is_draft], ['Mine v2', 1]);
        assert.deepEqual(await deleteTemplate(db, created.id!, at('2026-10-07T00:00:00Z')), { ok: true });
        assert.equal(await getTemplate(db, created.id!), null);
        assert.deepEqual(await deleteTemplate(db, created.id!, at('2026-10-07T00:00:00Z')), { ok: false, error: 'not-found' });
        assert.deepEqual(await saveTemplate(db, 'nope', { name: 'x', subject: 'y', body: 'z', sortOrder: 0, isDraft: false }, at('2026-10-07T00:00:00Z')), { ok: false, error: 'not-found' });
    });
});

describe('Recently deleted', () => {
    it('is purgeable only after 30 Eastern days', () => {
        assert.equal(purgeDate('2026-10-01T14:00:00Z'), '2026-10-31');
        assert.equal(isPurgeable('2026-10-01T14:00:00Z', new Date('2026-10-30T23:00:00-04:00')), false);
        assert.equal(isPurgeable('2026-10-01T14:00:00Z', new Date('2026-10-31T00:30:00-04:00')), true);
        assert.equal(isPurgeable('2026-10-01T14:00:00Z', new Date('2026-12-01T00:00:00Z')), true);
    });

    it('erases a lead after 30 days along with their timeline, calendar items and website inquiry, and it does not come back', async () => {
        const db = createTestD1();
        const id = await lead(db, { first_name: 'Gone', email: 'gone@example.com' });
        db.raw.prepare("INSERT INTO inquiries (id, created_at, first_name, last_name, email, phone, celebrating, location, payload) VALUES ('inq-1', '2026-09-30T00:00:00Z', 'Gone', 'X', 'gone@example.com', '1', 'Wedding', 'GA', '{\"firstName\":\"Gone\",\"email\":\"gone@example.com\"}')").run();
        await syncUnlinkedInquiries(db);
        const linked = db.raw.prepare('SELECT lead_id FROM lead_inquiries WHERE inquiry_id = ?').get('inq-1') as { lead_id: string };
        const target = linked.lead_id;
        const item = validateCalendarItem({ type: 'consultation', lead_id: target, date: '2026-10-20', all_day: '1' });
        if (!item.ok) throw new Error('bad');
        await createCalendarItem(db, item.value, at('2026-10-02T00:00:00Z'));

        assert.deepEqual(await purgeLead(db, target, at('2026-10-10T00:00:00Z')), { ok: false, error: 'not-found' }); // not deleted yet
        await softDeleteLead(db, target, at('2026-10-02T12:00:00Z'));
        assert.deepEqual(await purgeLead(db, target, at('2026-10-20T00:00:00Z')), { ok: false, error: 'too-soon' });
        assert.deepEqual(await purgeLead(db, target, at('2026-11-05T00:00:00Z')), { ok: true });

        for (const table of ['leads', 'activities', 'calendar_items', 'lead_inquiries']) {
            assert.equal((db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'leads' ? 'id' : table === 'lead_inquiries' ? 'lead_id' : 'lead_id'} = ?`).get(target) as { n: number }).n, 0, table);
        }
        assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM inquiries WHERE id = 'inq-1'").get() as { n: number }).n, 0);
        assert.deepEqual(await syncUnlinkedInquiries(db), { linked: 0, failed: 0, remaining: 0 }); // nothing to bring back
        assert.equal(db.raw.prepare("SELECT action FROM audit_log WHERE entity = 'lead' AND action = 'purge'").all().length, 1);
        assert.ok(id);
    });

    it('keeps a lead that has a booking, a payment or a file', async () => {
        const db = createTestD1();
        const bucket = new FakeR2();
        const booked = await lead(db, { first_name: 'Booked', email: 'b@example.com' });
        const input = validateBookingInput({ package_id: 'custom', custom_name: 'Day', custom_price: '300' }, { packages: [], extras: [] });
        if (!input.ok) throw new Error('bad');
        await createBooking(db, booked, input.value, at('2026-10-02T00:00:00Z'));
        const filed = await lead(db, { first_name: 'Filed', email: 'f@example.com' });
        await saveFile(db, bucket, filed, { bytes: PDF, originalName: 'c.pdf', kind: 'contract' }, at('2026-10-02T00:00:00Z'));
        for (const target of [booked, filed]) {
            await softDeleteLead(db, target, at('2026-10-03T00:00:00Z'));
            assert.deepEqual(await purgeLead(db, target, at('2026-12-01T00:00:00Z')), { ok: false, error: 'has-records' });
            assert.ok(await getLead(db, target, { includeDeleted: true }));
        }
    });

    it('erases a plain file after 30 days but never a signed contract', async () => {
        const db = createTestD1();
        const bucket = new FakeR2();
        const id = await lead(db, { first_name: 'Ava', email: 'a@example.com' });
        const other = (await saveFile(db, bucket, id, { bytes: PDF, originalName: 'inspo.pdf', kind: 'other' }, at('2026-10-02T00:00:00Z'))) as { id: string };
        const contract = (await saveFile(db, bucket, id, { bytes: PDF, originalName: 'c.pdf', kind: 'contract' }, at('2026-10-02T00:00:00Z'))) as { id: string };
        const keyOf = async (fileId: string) => (await getFile(db, fileId))!.r2_key;
        const otherKey = await keyOf(other.id);
        const contractKey = await keyOf(contract.id);
        await removeFile(db, other.id, at('2026-10-03T00:00:00Z'));
        await removeFile(db, contract.id, at('2026-10-03T00:00:00Z'));
        assert.equal((await listDeletedFiles(db)).length, 2);

        assert.deepEqual(await purgeFile(db, bucket, other.id, at('2026-10-10T00:00:00Z')), { ok: false, error: 'too-soon' });
        assert.deepEqual(await purgeFile(db, bucket, other.id, at('2026-12-01T00:00:00Z')), { ok: true });
        assert.equal(bucket.objects.has(otherKey), false);
        assert.deepEqual(await purgeFile(db, bucket, contract.id, at('2027-12-01T00:00:00Z')), { ok: false, error: 'is-contract' });
        assert.equal(bucket.objects.has(contractKey), true);
        assert.equal((await listFiles(db, id)).length, 0);
    });

    it('lists deleted calendar items, restores them, and erases them after 30 days', async () => {
        const db = createTestD1();
        const parsed = validateCalendarItem({ type: 'personal', title: 'Dentist', date: '2026-10-20', all_day: '1' });
        if (!parsed.ok) throw new Error('bad');
        const created = await createCalendarItem(db, parsed.value, at('2026-10-02T00:00:00Z'));
        db.raw.prepare("UPDATE calendar_items SET deleted_at = '2026-10-03T00:00:00Z' WHERE id = ?").run(created.id!);
        assert.equal((await listDeletedCalendarItems(db)).length, 1);
        assert.deepEqual(await restoreCalendarItem(db, created.id!, at('2026-10-04T00:00:00Z')), { ok: true });
        assert.equal((await listCalendarItems(db)).length, 1);
        db.raw.prepare("UPDATE calendar_items SET deleted_at = '2026-10-03T00:00:00Z' WHERE id = ?").run(created.id!);
        assert.deepEqual(await purgeCalendarItem(db, created.id!, at('2026-10-10T00:00:00Z')), { ok: false, error: 'too-soon' });
        assert.deepEqual(await purgeCalendarItem(db, created.id!, at('2026-12-01T00:00:00Z')), { ok: true });
        assert.equal((await listDeletedCalendarItems(db)).length, 0);
    });

    it('records timeline entries for restored files', async () => {
        const db = createTestD1();
        const bucket = new FakeR2();
        const id = await lead(db, { first_name: 'Ava', email: 'a@example.com' });
        const file = (await saveFile(db, bucket, id, { bytes: PDF, originalName: 'x.pdf', kind: 'other' }, at('2026-10-02T00:00:00Z'))) as { id: string };
        await removeFile(db, file.id, at('2026-10-03T00:00:00Z'));
        assert.ok((await listActivities(db, id)).some((activity) => activity.body === 'Removed a file.'));
    });
});
