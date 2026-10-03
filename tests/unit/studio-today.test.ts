// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LeadRow } from '../../src/lib/studio/queries.ts';
import { bannerFrom } from '../../src/lib/studio/messages.ts';
import { buildToday, quietLabel } from '../../src/lib/studio/today.ts';

const today = '2026-10-10';
let counter = 0;
function lead(overrides: Partial<LeadRow> = {}): LeadRow {
    counter += 1;
    return {
        id: `lead-${counter}`,
        created_at: '2026-10-09T12:00:00Z',
        updated_at: '2026-10-09T12:00:00Z',
        first_name: `Lead${counter}`,
        last_name: '',
        partner_name: '',
        email: '',
        email_key: '',
        phone: '',
        instagram: '',
        inquirer_role: '',
        source: 'website',
        found_via: '',
        celebrating: '[]',
        event_date: null,
        end_date: null,
        date_not_set: 0,
        location: '',
        in_georgia: '',
        venue: '',
        photo_video: '',
        excited_about: '',
        anything_else: '',
        stage: 'new',
        stage_before_lost: null,
        lost_reason: null,
        last_contacted_at: null,
        next_follow_up_at: null,
        notes: '',
        deleted_at: null,
        ...overrides,
    };
}
const names = (leads: Array<{ first_name: string } | { lead: { first_name: string } }>) =>
    leads.map((entry) => ('lead' in entry ? entry.lead.first_name : entry.first_name));

describe('buildToday', () => {
    it('separates leads who need a nudge from fresh ones', () => {
        const fresh = lead({ first_name: 'Fresh' });
        const stale = lead({ first_name: 'Stale', created_at: '2026-10-01T12:00:00Z' });
        const contacted = lead({ first_name: 'Quiet', stage: 'contacted', last_contacted_at: '2026-10-02T12:00:00Z' });
        const recent = lead({ first_name: 'Recent', stage: 'contacted', last_contacted_at: '2026-10-09T12:00:00Z' });
        const result = buildToday([fresh, stale, contacted, recent], { today, followUpDays: 5 });
        assert.deepEqual(names(result.needsFollowUp), ['Stale', 'Quiet']); // most overdue first
        assert.deepEqual(names(result.newInquiries), ['Fresh']);
    });

    it('does not list a lead in both New and Needs follow-up', () => {
        const overdueNew = lead({ first_name: 'Old', created_at: '2026-10-01T12:00:00Z' });
        const result = buildToday([overdueNew], { today, followUpDays: 5 });
        assert.equal(result.newInquiries.length, 0);
        assert.equal(result.needsFollowUp.length, 1);
    });

    it('ignores deleted, lost, delivered and booked leads for nudges', () => {
        const leads = [
            lead({ deleted_at: '2026-10-05T00:00:00Z', created_at: '2026-09-01T00:00:00Z' }),
            lead({ stage: 'lost', created_at: '2026-09-01T00:00:00Z' }),
            lead({ stage: 'delivered', created_at: '2026-09-01T00:00:00Z' }),
            lead({ stage: 'booked', created_at: '2026-09-01T00:00:00Z' }),
        ];
        const result = buildToday(leads, { today, followUpDays: 5 });
        assert.deepEqual([result.needsFollowUp.length, result.newInquiries.length], [0, 0]);
    });

    it('shows follow-ups and events in the coming seven days, soonest first', () => {
        const leads = [
            lead({ first_name: 'FollowTomorrow', stage: 'contacted', last_contacted_at: '2026-10-09T12:00:00Z', next_follow_up_at: '2026-10-11' }),
            lead({ first_name: 'FollowLater', stage: 'contacted', last_contacted_at: '2026-10-09T12:00:00Z', next_follow_up_at: '2026-10-17' }),
            lead({ first_name: 'FollowTooFar', stage: 'contacted', last_contacted_at: '2026-10-09T12:00:00Z', next_follow_up_at: '2026-10-18' }),
            lead({ first_name: 'Wedding', stage: 'booked', event_date: '2026-10-17' }),
            lead({ first_name: 'WeddingNextMonth', stage: 'booked', event_date: '2026-11-17' }),
            lead({ first_name: 'WeekendAwayNow', stage: 'booked', event_date: '2026-10-09', end_date: '2026-10-11' }),
            lead({ first_name: 'EventOver', stage: 'booked', event_date: '2026-10-01', end_date: '2026-10-02' }),
            lead({ first_name: 'InquiryWithDate', stage: 'new', event_date: '2026-10-12' }),
        ];
        const result = buildToday(leads, { today, followUpDays: 5 });
        assert.deepEqual(
            result.thisWeek.map((item) => [item.lead.first_name, item.kind, item.date]),
            [
                ['WeekendAwayNow', 'event', '2026-10-10'],
                ['FollowTomorrow', 'follow-up', '2026-10-11'],
                ['Wedding', 'event', '2026-10-17'],
                ['FollowLater', 'follow-up', '2026-10-17'],
            ],
        );
    });
});

describe('quietLabel', () => {
    it('describes how long it has been in plain words', () => {
        assert.equal(quietLabel(0, true), 'Contacted today');
        assert.equal(quietLabel(0, false), 'Inquired today');
        assert.equal(quietLabel(1, true), 'Last contact 1 day ago');
        assert.equal(quietLabel(6, true), 'Last contact 6 days ago');
        assert.equal(quietLabel(6, false), 'No contact yet, inquired 6 days ago');
    });
});

describe('bannerFrom', () => {
    const banner = (query: string) => bannerFrom(new URLSearchParams(query));

    it('shows only messages it knows', () => {
        assert.deepEqual(banner('notice=saved'), { kind: 'ok', text: 'Saved.' });
        assert.equal(banner('notice=<script>alert(1)</script>'), null);
        assert.equal(banner('error=made-up'), null);
        assert.equal(banner(''), null);
    });

    it('lists the boxes to check using their labels, ignoring unknown names', () => {
        assert.deepEqual(banner('invalid=first_name,email,hacker'), { kind: 'error', text: 'Please check: First name, Email.' });
    });

    it('links to the clashing lead only for a real id', () => {
        const id = '123e4567-e89b-42d3-a456-426614174000';
        assert.equal(banner(`error=duplicate-email&lead=${id}`)?.leadId, id);
        assert.equal(banner('error=duplicate-email&lead=javascript:alert(1)')?.leadId, undefined);
        assert.equal(banner(`error=not-found&lead=${id}`)?.leadId, undefined);
    });
});
