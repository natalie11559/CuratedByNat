// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeInstagram, validateFollowUpDate, validateLeadFields, type RawInput } from '../../src/lib/studio/validate.ts';

const good: RawInput = { first_name: ' Ava ', source: 'instagram', celebrating: ['wedding', 'bachelorette'], event_date: '2027-05-15' };

function errorsOf(raw: RawInput) {
    const result = validateLeadFields(raw);
    assert.equal(result.ok, false);
    return result.ok ? {} : result.errors;
}

describe('validateLeadFields', () => {
    it('accepts a lead with just a first name and cleans the rest', () => {
        const result = validateLeadFields({ first_name: ' Ava ' });
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.value.first_name, 'Ava');
            assert.equal(result.value.source, 'other');
            assert.deepEqual(result.value.celebrating, []);
            assert.equal(result.value.event_date, null);
        }
    });

    it('keeps good values', () => {
        const result = validateLeadFields({ ...good, email: 'ava@example.com', phone: '(404) 555-0100', instagram: '@Ava.Co', in_georgia: 'yes', notes: 'Met at a showcase' });
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.value.instagram, 'Ava.Co');
            assert.deepEqual(result.value.celebrating, ['wedding', 'bachelorette']);
            assert.equal(result.value.event_date, '2027-05-15');
            assert.equal(result.value.in_georgia, 'yes');
        }
    });

    it('needs a first name', () => {
        assert.match(errorsOf({ first_name: '   ' }).first_name!, /first name/);
        assert.ok(errorsOf({ first_name: 'x'.repeat(81) }).first_name);
    });

    it('checks the email, the Instagram handle, the source and the choices', () => {
        assert.ok(errorsOf({ ...good, instagram: '...' }).instagram);
        assert.ok(errorsOf({ ...good, email: 'nope' }).email);
        assert.ok(errorsOf({ ...good, instagram: 'not a handle!' }).instagram);
        assert.ok(errorsOf({ ...good, source: 'carrier-pigeon' }).source);
        assert.ok(errorsOf({ ...good, celebrating: ['wedding', 'made-up'] }).celebrating);
        assert.ok(errorsOf({ ...good, in_georgia: 'maybe' }).in_georgia);
    });

    it('checks dates', () => {
        assert.ok(errorsOf({ ...good, event_date: '2027-02-30' }).event_date);
        assert.ok(errorsOf({ ...good, end_date: '2027-05-10' }).end_date);
        assert.match(errorsOf({ first_name: 'Ava', end_date: '2027-05-10' }).end_date!, /start date/);
    });

    it('ignores dates when "date not set" is ticked', () => {
        const result = validateLeadFields({ ...good, end_date: '2027-05-17', date_not_set: 'on' });
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.value.event_date, null);
            assert.equal(result.value.end_date, null);
            assert.equal(result.value.date_not_set, true);
        }
    });

    it('limits long text', () => {
        assert.ok(errorsOf({ ...good, notes: 'x'.repeat(5001) }).notes);
        assert.ok(errorsOf({ ...good, location: 'x'.repeat(201) }).location);
    });

    it('drops repeated choices', () => {
        const result = validateLeadFields({ ...good, celebrating: ['wedding', 'wedding'] });
        assert.equal(result.ok && result.value.celebrating.length, 1);
    });
});

describe('normalizeInstagram', () => {
    it('reduces handles, links and mentions to the bare handle', () => {
        for (const input of ['@curated.bynat', 'curated.bynat', 'https://www.instagram.com/curated.bynat/', 'instagram.com/curated.bynat?igsh=x', ' @curated.bynat ']) {
            assert.equal(normalizeInstagram(input), 'curated.bynat', input);
        }
        assert.equal(normalizeInstagram(''), '');
    });
});

describe('validateFollowUpDate', () => {
    it('allows a real date or none', () => {
        assert.deepEqual(validateFollowUpDate({ next_follow_up_at: '2026-10-12' }), { ok: true, value: '2026-10-12' });
        assert.deepEqual(validateFollowUpDate({ next_follow_up_at: '' }), { ok: true, value: null });
        assert.equal(validateFollowUpDate({ next_follow_up_at: '2026-10-32' }).ok, false);
    });
});
