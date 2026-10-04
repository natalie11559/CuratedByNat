// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { D1Database } from '../../src/lib/cloudflare.ts';
import type { InquirySubmission } from '../../src/lib/inquiry/validate.ts';
import {
    countUnlinkedInquiries,
    emailKey,
    linkInquiryToLead,
    submissionFromPayload,
    syncUnlinkedInquiries,
    tryLinkInquiry,
} from '../../src/lib/studio/leads.ts';
import { createTestD1, type TestD1 } from './helpers/d1-sqlite.ts';

function submission(overrides: Partial<InquirySubmission> = {}): InquirySubmission {
    return {
        firstName: 'Emory',
        lastName: 'Morris',
        email: 'Emory@Example.com',
        phone: '(404) 555-0100',
        instagram: '@emory',
        inquirer: "I'm the bride",
        celebrating: ['wedding'],
        eventDate: '2027-05-15',
        dateNotSet: false,
        endDate: null,
        inGeorgia: 'yes',
        location: 'Atlanta, GA',
        photoVideo: 'We have a photographer',
        excitedAbout: 'The getting-ready moments',
        anythingElse: '',
        foundVia: 'Instagram',
        ...overrides,
    };
}

let counter = 0;
/** Saves an inquiry row the way the live form does, and returns it as the lead step receives it. */
async function saveInquiry(db: TestD1, input: Partial<InquirySubmission> = {}, createdAt = '2026-09-01T12:00:00.000Z') {
    counter += 1;
    const id = `inq-${counter}`;
    const data = submission(input);
    await db
        .prepare(
            `INSERT INTO inquiries (id, created_at, first_name, last_name, email, phone, celebrating, event_date, end_date, location, payload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(id, createdAt, data.firstName, data.lastName, data.email, data.phone, 'Wedding', data.eventDate, data.endDate, data.location, JSON.stringify(data))
        .run();
    return { id, createdAt, submission: data };
}

const count = (db: TestD1, table: string, where = '1=1') =>
    (db.raw.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).get() as { total: number }).total;

describe('linkInquiryToLead', () => {
    it('creates a new lead from an inquiry, with every answer mapped', async () => {
        const db = createTestD1();
        const inquiry = await saveInquiry(db);
        const result = await linkInquiryToLead(db, inquiry);
        assert.equal(result.created, true);

        const lead = db.raw.prepare('SELECT * FROM leads WHERE id = ?').get(result.leadId) as Record<string, unknown>;
        assert.equal(lead.first_name, 'Emory');
        assert.equal(lead.last_name, 'Morris');
        assert.equal(lead.email, 'Emory@Example.com');
        assert.equal(lead.email_key, 'emory@example.com');
        assert.equal(lead.phone, '(404) 555-0100');
        assert.equal(lead.instagram, 'emory'); // stored as a plain handle, without the @
        assert.equal(lead.inquirer_role, "I'm the bride");
        assert.equal(lead.source, 'website');
        assert.equal(lead.found_via, 'Instagram');
        assert.equal(lead.celebrating, '["wedding"]');
        assert.equal(lead.event_date, '2027-05-15');
        assert.equal(lead.date_not_set, 0);
        assert.equal(lead.location, 'Atlanta, GA');
        assert.equal(lead.in_georgia, 'yes');
        assert.equal(lead.photo_video, 'We have a photographer');
        assert.equal(lead.excited_about, 'The getting-ready moments');
        assert.equal(lead.stage, 'new');
        assert.equal(lead.created_at, inquiry.createdAt);
        assert.equal(lead.last_contacted_at, null);

        assert.equal(count(db, 'lead_inquiries', `lead_id = '${result.leadId}' AND inquiry_id = '${inquiry.id}'`), 1);
        const activity = db.raw.prepare('SELECT type, body, actor_email FROM activities WHERE lead_id = ?').get(result.leadId);
        assert.deepEqual({ ...activity }, { type: 'system', body: 'Inquiry received through the website.', actor_email: '' });
    });

    it('keeps "date not set" leads without a date', async () => {
        const db = createTestD1();
        const { leadId } = await linkInquiryToLead(db, await saveInquiry(db, { eventDate: null, dateNotSet: true }));
        const lead = db.raw.prepare('SELECT event_date, date_not_set FROM leads WHERE id = ?').get(leadId);
        assert.deepEqual({ ...lead }, { event_date: null, date_not_set: 1 });
    });

    it('adds a repeat inquiry from the same email to the open lead instead of duplicating it', async () => {
        const db = createTestD1();
        const first = await linkInquiryToLead(db, await saveInquiry(db, { phone: '' }));
        db.raw.prepare("UPDATE leads SET stage = 'consultation', location = 'Savannah, GA' WHERE id = ?").run(first.leadId);

        const second = await linkInquiryToLead(
            db,
            await saveInquiry(db, { email: '  EMORY@example.com ', phone: '(404) 555-0199', location: 'Elsewhere', eventDate: '2027-06-01' }),
        );

        assert.deepEqual(second, { leadId: first.leadId, created: false });
        assert.equal(count(db, 'leads'), 1);
        assert.equal(count(db, 'lead_inquiries', `lead_id = '${first.leadId}'`), 2);
        assert.equal(count(db, 'activities', `lead_id = '${first.leadId}'`), 2);

        const lead = db.raw.prepare('SELECT phone, location, event_date, stage FROM leads').get();
        // The blank phone is filled in; what was already there (including Nat's corrections) is kept.
        assert.deepEqual({ ...lead }, { phone: '(404) 555-0199', location: 'Savannah, GA', event_date: '2027-05-15', stage: 'consultation' });
    });

    it('starts a new lead when the earlier one is delivered, lost or deleted', async () => {
        for (const change of ["stage = 'delivered'", "stage = 'lost'", "deleted_at = '2026-09-02T00:00:00Z'"]) {
            const db = createTestD1();
            const first = await linkInquiryToLead(db, await saveInquiry(db));
            db.raw.prepare(`UPDATE leads SET ${change} WHERE id = ?`).run(first.leadId);
            const second = await linkInquiryToLead(db, await saveInquiry(db));
            assert.equal(second.created, true, change);
            assert.notEqual(second.leadId, first.leadId);
            assert.equal(count(db, 'leads'), 2);
        }
    });

    it('is safe to run twice for the same inquiry', async () => {
        const db = createTestD1();
        const inquiry = await saveInquiry(db);
        const first = await linkInquiryToLead(db, inquiry);
        const second = await linkInquiryToLead(db, inquiry);
        assert.deepEqual(second, { leadId: first.leadId, created: false });
        assert.equal(count(db, 'leads'), 1);
        assert.equal(count(db, 'activities'), 1);
    });

    it('recovers when another inquiry from the same address created the lead a moment earlier', async () => {
        const db = createTestD1();
        const first = await linkInquiryToLead(db, await saveInquiry(db));

        // A database that claims there is no open lead the first time it is asked, as in a real race.
        let lied = false;
        const racing: D1Database = {
            batch: (statements) => db.batch(statements),
            prepare(query) {
                const statement = db.prepare(query);
                if (!lied && query.includes('FROM leads') && query.includes('email_key')) {
                    lied = true;
                    return { ...statement, bind: () => ({ ...statement, first: async () => null }) as never };
                }
                return statement;
            },
        };
        const second = await linkInquiryToLead(racing, await saveInquiry(db));
        assert.deepEqual(second, { leadId: first.leadId, created: false });
        assert.equal(count(db, 'leads'), 1);
        assert.equal(lied, true);
    });

    it('the database itself refuses two open leads with one email', async () => {
        const db = createTestD1();
        await linkInquiryToLead(db, await saveInquiry(db));
        assert.throws(() =>
            db.raw
                .prepare("INSERT INTO leads (id, created_at, updated_at, first_name, email_key) VALUES ('x', 'a', 'a', 'Dup', 'emory@example.com')")
                .run(),
        );
    });
});

describe('tryLinkInquiry', () => {
    it('never throws: a broken lead step leaves the inquiry alone and reports false', async () => {
        // Studio's tables have not been created yet (the migration was not applied).
        const db = createTestD1({ migrations: ['0001_inquiries.sql'] });
        const inquiry = await saveInquiry(db);
        const logs: string[] = [];
        assert.equal(await tryLinkInquiry(db, inquiry, (message) => logs.push(message)), false);

        assert.equal(count(db, 'inquiries', `id = '${inquiry.id}'`), 1);
        assert.equal(logs.length, 1);
        assert.ok(logs[0]!.includes(inquiry.id));
        // No client details in the log line.
        assert.equal(logs[0]!.includes('Emory'), false);
        assert.equal(logs[0]!.includes('example.com'), false);
    });

    it('reports true when it works', async () => {
        const db = createTestD1();
        assert.equal(await tryLinkInquiry(db, await saveInquiry(db)), true);
    });
});

describe('syncUnlinkedInquiries (backfill and retry)', () => {
    it('imports every existing inquiry once, merging repeat emails, and is idempotent', async () => {
        const db = createTestD1();
        await saveInquiry(db, { email: 'a@example.com', firstName: 'Ava' }, '2026-08-01T10:00:00.000Z');
        await saveInquiry(db, { email: 'A@example.com ', firstName: 'Ava' }, '2026-08-05T10:00:00.000Z');
        await saveInquiry(db, { email: 'b@example.com', firstName: 'Bea' }, '2026-08-03T10:00:00.000Z');
        assert.equal(await countUnlinkedInquiries(db), 3);

        const first = await syncUnlinkedInquiries(db);
        assert.deepEqual(first, { linked: 3, failed: 0, remaining: 0 });
        assert.equal(count(db, 'leads'), 2);
        assert.equal(count(db, 'lead_inquiries'), 3);

        const second = await syncUnlinkedInquiries(db);
        assert.deepEqual(second, { linked: 0, failed: 0, remaining: 0 });
        assert.equal(count(db, 'leads'), 2);
        assert.equal(count(db, 'activities'), 3);

        // The original dates are kept, so the pipeline shows when people really inquired.
        const ava = db.raw.prepare("SELECT created_at FROM leads WHERE email_key = 'a@example.com'").get() as { created_at: string };
        assert.equal(ava.created_at, '2026-08-01T10:00:00.000Z');
    });

    it('retries an inquiry whose lead step failed earlier', async () => {
        const db = createTestD1();
        const inquiry = await saveInquiry(db);
        assert.equal(await countUnlinkedInquiries(db), 1);
        const result = await syncUnlinkedInquiries(db);
        assert.equal(result.linked, 1);
        assert.equal(count(db, 'lead_inquiries', `inquiry_id = '${inquiry.id}'`), 1);
    });

    it('skips a payload it cannot read, keeps it flagged and carries on with the rest', async () => {
        const db = createTestD1();
        db.raw
            .prepare("INSERT INTO inquiries (id, created_at, first_name, last_name, email, phone, celebrating, location, payload) VALUES ('bad', '2026-01-01T00:00:00Z', 'x', 'y', 'z@example.com', '1', 'Wedding', 'GA', 'not json')")
            .run();
        await saveInquiry(db);
        const logs: string[] = [];
        const result = await syncUnlinkedInquiries(db, { log: (message) => logs.push(message) });
        assert.deepEqual(result, { linked: 1, failed: 1, remaining: 1 });
        assert.match(logs[0]!, /Inquiry bad/);
    });
});

describe('payload reading', () => {
    it('is forgiving about older or partial payloads', () => {
        const parsed = submissionFromPayload(JSON.stringify({ firstName: ' Ava ', celebrating: ['wedding', 3], eventDate: 'soon' }));
        assert.equal(parsed?.firstName, 'Ava');
        assert.deepEqual(parsed?.celebrating, ['wedding']);
        assert.equal(parsed?.eventDate, null);
        assert.equal(parsed?.email, '');
        assert.equal(submissionFromPayload('[]'), null);
        assert.equal(submissionFromPayload('nope'), null);
    });

    it('normalises email for matching', () => {
        assert.equal(emailKey('  Hello@Example.COM '), 'hello@example.com');
    });
});

describe('Instagram handles from the website form', () => {
    it('are stored as plain handles, and anything else is left out', async () => {
        const { instagramHandle } = await import('../../src/lib/studio/leads.ts');
        assert.equal(instagramHandle('@emory.co'), 'emory.co');
        assert.equal(instagramHandle('https://www.instagram.com/emory.co/?igsh=1'), 'emory.co');
        for (const bad of ['', '../../evil', 'a b', 'x@evil.com/path', 'javascript:alert(1)', 'a'.repeat(40), '@']) {
            assert.equal(instagramHandle(bad), '', bad);
        }
    });

    it('arrive on the lead cleaned up', async () => {
        const db = createTestD1();
        const messy = await saveInquiry(db, { instagram: 'javascript:alert(1)' });
        const result = await linkInquiryToLead(db, messy);
        assert.equal((db.raw.prepare('SELECT instagram FROM leads WHERE id = ?').get(result.leadId) as { instagram: string }).instagram, '');
        const tidy = await saveInquiry(db, { email: 'other@example.com', instagram: '@Other.Handle' });
        const second = await linkInquiryToLead(db, tidy);
        assert.equal((db.raw.prepare('SELECT instagram FROM leads WHERE id = ?').get(second.leadId) as { instagram: string }).instagram, 'Other.Handle');
    });
});
