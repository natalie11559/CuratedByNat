// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
    commonLines,
    describeExtras,
    describePackages,
    fillTemplate,
    joinNaturally,
    mailtoLink,
    PLACEHOLDERS,
    templateValues,
    type PriceLine,
} from '../../src/lib/studio/templates.ts';
import { validateGeneralSettings, validateTemplate } from '../../src/lib/studio/validate.ts';
import { createTestD1 } from './helpers/d1-sqlite.ts';

const packages: PriceLine[] = [
    { name: 'Basic', priceCents: 30000, details: ['6 hours of coverage', 'One reel', 'Raw footage included'] },
    { name: 'Plus', priceCents: 50000, details: ['8 hours of coverage', 'Two reels', 'Raw footage included'] },
];
const lead = { first_name: 'Ava', last_name: 'Lee', partner_name: '', event_date: '2027-05-15', end_date: null, celebrating: ['wedding', 'bachelorette'], location: 'Atlanta, GA', venue: 'The Foundry' };

describe('fillTemplate', () => {
    it('fills known details', () => {
        const values = templateValues({ lead, packages, extras: [] });
        const filled = fillTemplate('Hi {first_name}! See you {event_date} in {location} for your {celebrating}.', values);
        assert.equal(filled.text, 'Hi Ava! See you May 15, 2027 in Atlanta, GA for your wedding and bachelorette weekend.');
        assert.deepEqual([filled.usedFallbacks, filled.unknown], [[], []]);
    });

    it('uses natural stand-ins for details that are not known yet, and says so', () => {
        const values = templateValues({ lead: { ...lead, event_date: null, celebrating: ['not-sure'], location: '' }, packages, extras: [] });
        const filled = fillTemplate('Is {event_date} still the plan for your {celebrating} at {location}?', values);
        assert.equal(filled.text, 'Is your date still the plan for your celebration at the location we talked about?');
        assert.deepEqual(filled.usedFallbacks, ['event_date', 'celebrating', 'location']);
    });

    it('leaves placeholders it does not know exactly as typed and reports them', () => {
        const filled = fillTemplate('Hi {first_name} {nickname} {first_name}', { first_name: 'Ava' });
        assert.equal(filled.text, 'Hi Ava {nickname} Ava');
        assert.deepEqual(filled.unknown, ['nickname']);
    });

    it('does not run anything or reach for other fields', () => {
        const filled = fillTemplate('{constructor} {__proto__} {toString} ${x} {{first_name}}', { first_name: 'Ava' });
        assert.equal(filled.text, '{constructor} {__proto__} {toString} ${x} {Ava}');
    });

    it('never reads a client detail into the wrong place', () => {
        const values = templateValues({ lead: { ...lead, first_name: '{last_name}' }, packages, extras: [] });
        // A name that looks like a placeholder is just text; it is not filled a second time.
        assert.equal(fillTemplate('Hi {first_name}', values).text, 'Hi {last_name}');
    });
});

describe('packages and extras text', () => {
    it('lists each package with its price and what is special to it, and the shared lines once', () => {
        assert.deepEqual(commonLines(packages), ['Raw footage included']);
        assert.equal(describePackages(packages), 'Basic ($300): 6 hours of coverage, One reel\nPlus ($500): 8 hours of coverage, Two reels');
        const values = templateValues({ lead, packages, extras: [] });
        assert.equal(values.included_in_all, 'raw footage included');
    });

    it('finds nothing in common with a single package', () => {
        assert.deepEqual(commonLines([packages[0]!]), []);
        assert.equal(describePackages([packages[0]!]), 'Basic ($300): 6 hours of coverage, One reel, Raw footage included');
    });

    it('lists extras with their prices', () => {
        assert.equal(describeExtras([{ name: 'Extra hour', priceCents: 5000, details: [] }, { name: 'Proposal', priceCents: 7550, details: [] }]), 'Extra hour: $50\nProposal: $75.50');
    });

    it('joins words the way people say them', () => {
        assert.equal(joinNaturally([]), '');
        assert.equal(joinNaturally(['wedding']), 'wedding');
        assert.equal(joinNaturally(['a', 'b']), 'a and b');
        assert.equal(joinNaturally(['a', 'b', 'c']), 'a, b and c');
    });
});

describe('mailtoLink', () => {
    it('opens a message with the subject and body filled in', () => {
        const link = mailtoLink('ava@example.com', 'Hi & hello', 'Line one\nLine two, 50% sure?');
        assert.equal(link, 'mailto:ava@example.com?subject=Hi%20%26%20hello&body=Line%20one%0D%0ALine%20two%2C%2050%25%20sure%3F');
    });

    it('cannot be bent into adding extra headers', () => {
        const link = mailtoLink('ava@example.com', 'x&bcc=evil@example.com', 'y\r\nBcc: evil@example.com');
        assert.equal(link.includes('&bcc='), false);
        assert.equal(link.split('?').length, 2);
        assert.equal((link.match(/&body=/g) ?? []).length, 1);
    });
});

describe('the starter templates', () => {
    const db = createTestD1();
    const rows = db.raw.prepare('SELECT * FROM templates ORDER BY sort_order').all() as Array<{ id: string; name: string; subject: string; body: string; is_draft: number }>;

    it('are four drafts with the names Nat asked for', () => {
        assert.deepEqual(rows.map((row) => row.name), ['Thanks for inquiring', 'Packages and availability', 'Following up', 'Booking confirmed']);
        assert.ok(rows.every((row) => row.is_draft === 1));
        assert.ok(rows.every((row) => /^[0-9a-f-]{36}$/.test(row.id)));
    });

    it('use only placeholders Studio knows, so nothing is left blank', () => {
        const known = new Set(PLACEHOLDERS.map((entry) => entry.name));
        for (const row of rows) {
            for (const match of `${row.subject}\n${row.body}`.matchAll(/\{([a-z_]+)\}/g)) assert.ok(known.has(match[1]!), `${row.name}: {${match[1]}}`);
        }
    });

    it('read well with every detail filled in and with none', () => {
        const full = templateValues({ lead, packages, extras: [{ name: 'Extra hour', priceCents: 5000, details: [] }] });
        const empty = templateValues({ lead: { ...lead, first_name: 'Ava', event_date: null, celebrating: [], location: '', venue: '' }, packages: [], extras: [] });
        for (const row of rows) {
            for (const values of [full, empty]) {
                const text = fillTemplate(`${row.subject}\n\n${row.body}`, values);
                assert.deepEqual(text.unknown, [], row.name);
                assert.equal(/\{[a-z_]+\}/.test(text.text), false, row.name);
            }
        }
    });

    it('are in Nat\'s voice: warm, no em dashes, no prices, no unfinished text', () => {
        for (const row of rows) {
            const text = `${row.subject}\n${row.body}`;
            assert.equal(/[—–]/.test(text), false, `${row.name} has a dash`);
            assert.equal(/\$\d/.test(text), false, `${row.name} has a price`);
            assert.equal(/TODO|lorem|xxx/i.test(text), false, row.name);
            assert.ok(text.includes('Nat'), row.name);
        }
    });

    it('keep the travel-fee line on the packages email', () => {
        const packagesEmail = rows.find((row) => row.name === 'Packages and availability')!;
        assert.ok(packagesEmail.body.includes('Travel fees may apply for locations outside my local service area.'));
    });

    it('migration file carries no real prices', () => {
        const sql = readFileSync(new URL('../../migrations/0007_studio_templates.sql', import.meta.url), 'utf8');
        assert.equal(/\$\s?\d/.test(sql), false);
    });
});

describe('validateTemplate and validateGeneralSettings', () => {
    it('needs a name, a subject and a message', () => {
        const bad = validateTemplate({ name: '', subject: '', body: '' });
        assert.equal(bad.ok, false);
        const good = validateTemplate({ name: ' Hello ', subject: 'Hi {first_name}', body: 'Body', is_draft: '1', sort_order: '5' });
        assert.deepEqual(good.ok && good.value, { name: 'Hello', subject: 'Hi {first_name}', body: 'Body', sortOrder: 5, isDraft: true });
        assert.equal(validateTemplate({ name: 'x', subject: 'y', body: 'z'.repeat(8001) }).ok, false);
    });

    it('keeps follow-up days between 1 and 60 and 1 to 12 distinct reasons', () => {
        const good = validateGeneralSettings({ follow_up_days: '7', lost_reasons: 'Too expensive\n  Went elsewhere \n\nToo expensive' });
        assert.deepEqual(good.ok && good.value, { followUpDays: 7, lostReasons: ['Too expensive', 'Went elsewhere'] });
        for (const days of ['0', '61', '2.5', 'many', '']) assert.equal(validateGeneralSettings({ follow_up_days: days, lost_reasons: 'x' }).ok, false, days);
        assert.equal(validateGeneralSettings({ follow_up_days: '5', lost_reasons: '' }).ok, false);
        assert.equal(validateGeneralSettings({ follow_up_days: '5', lost_reasons: Array.from({ length: 13 }, (_, i) => `r${i}`).join('\n') }).ok, false);
    });
});
