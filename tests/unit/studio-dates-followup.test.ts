// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    addDays,
    daysBetween,
    easternDate,
    formatDate,
    formatDateRange,
    formatMonth,
    formatShortDate,
    isIsoDate,
    relativeDays,
    todayEastern,
} from '../../src/lib/studio/dates.ts';
import { followUpStatus, type FollowUpLead } from '../../src/lib/studio/followup.ts';

describe('dates', () => {
    it('finds the Eastern calendar day, across midnight and daylight saving', () => {
        assert.equal(easternDate('2026-07-04T03:30:00Z'), '2026-07-03'); // 11:30 pm EDT the day before
        assert.equal(easternDate('2026-07-04T04:00:00Z'), '2026-07-04'); // midnight EDT
        assert.equal(easternDate('2026-12-25T04:59:00Z'), '2026-12-24'); // 11:59 pm EST
        assert.equal(easternDate('2026-12-25T05:00:00Z'), '2026-12-25');
        assert.equal(todayEastern(new Date('2026-03-08T06:59:59Z')), '2026-03-08'); // just before spring forward
    });

    it('counts calendar days, not hours', () => {
        assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2); // clocks change in between
        assert.equal(daysBetween('2026-11-01', '2026-11-02'), 1);
        assert.equal(daysBetween('2026-05-10', '2026-05-05'), -5);
        assert.equal(addDays('2026-02-27', 2), '2026-03-01');
        assert.equal(addDays('2027-12-31', 1), '2028-01-01');
    });

    it('validates real dates only', () => {
        assert.equal(isIsoDate('2027-02-28'), true);
        assert.equal(isIsoDate('2028-02-29'), true);
        assert.equal(isIsoDate('2027-02-29'), false);
        assert.equal(isIsoDate('2027-13-01'), false);
        assert.equal(isIsoDate('27-01-01'), false);
        assert.equal(isIsoDate(null), false);
    });

    it('writes dates in plain words', () => {
        assert.equal(formatDate('2027-05-15'), 'May 15, 2027');
        assert.equal(formatShortDate('2027-05-15'), 'Sat, May 15');
        assert.equal(formatShortDate('2028-01-02', 2027), 'Sun, Jan 2, 2028');
        assert.equal(formatDateRange('2027-06-06', '2027-06-08'), 'June 6 to June 8, 2027');
        assert.equal(formatDateRange('2027-12-30', '2028-01-02'), 'December 30, 2027 to January 2, 2028');
        assert.equal(formatDateRange('2027-06-06', null), 'June 6, 2027');
        assert.equal(formatMonth('2027-05'), 'May 2027');
    });

    it('describes how far away a day is', () => {
        assert.equal(relativeDays('2026-10-03', '2026-10-03'), 'Today');
        assert.equal(relativeDays('2026-10-04', '2026-10-03'), 'Tomorrow');
        assert.equal(relativeDays('2026-10-02', '2026-10-03'), 'Yesterday');
        assert.equal(relativeDays('2026-10-10', '2026-10-03'), 'In 7 days');
        assert.equal(relativeDays('2026-09-28', '2026-10-03'), '5 days ago');
    });
});

describe('followUpStatus', () => {
    const today = '2026-10-10';
    const base: FollowUpLead = { stage: 'contacted', created_at: '2026-10-01T15:00:00Z', last_contacted_at: null, next_follow_up_at: null };
    const check = (lead: Partial<FollowUpLead>, followUpDays = 5) => followUpStatus({ ...base, ...lead }, { followUpDays, today });

    it('flags a lead after five quiet days, counting from the last contact', () => {
        assert.equal(check({ last_contacted_at: '2026-10-06T14:00:00Z' }).due, false); // 4 days
        assert.deepEqual(check({ last_contacted_at: '2026-10-05T14:00:00Z' }), { due: true, reason: 'quiet', quietDays: 5 });
        assert.equal(check({ last_contacted_at: '2026-10-09T14:00:00Z' }).quietDays, 1);
    });

    it('counts from the inquiry when nobody has been in touch yet', () => {
        assert.deepEqual(check({ stage: 'new', created_at: '2026-10-04T12:00:00Z' }), { due: true, reason: 'quiet', quietDays: 6 });
        assert.equal(check({ stage: 'new', created_at: '2026-10-08T12:00:00Z' }).due, false);
    });

    it('makes the number of days a setting', () => {
        const lead = { last_contacted_at: '2026-10-07T14:00:00Z' };
        assert.equal(check(lead, 5).due, false);
        assert.equal(check(lead, 3).due, true);
        assert.equal(check(lead, 10).due, false);
    });

    it('uses the follow-up date Nat set instead of the quiet rule', () => {
        const quiet = { last_contacted_at: '2026-09-01T14:00:00Z' };
        assert.deepEqual(check({ ...quiet, next_follow_up_at: '2026-10-10' }), { due: true, reason: 'date', quietDays: 39 });
        assert.equal(check({ ...quiet, next_follow_up_at: '2026-10-01' }).reason, 'date');
        // A date still ahead holds the nudge back, however quiet it has been.
        assert.equal(check({ ...quiet, next_follow_up_at: '2026-10-11' }).due, false);
    });

    it('only nudges while the booking is still being won', () => {
        for (const stage of ['booked', 'event_done', 'delivered', 'lost']) {
            assert.equal(check({ stage, last_contacted_at: '2026-01-01T00:00:00Z', next_follow_up_at: '2026-01-02' }).due, false, stage);
        }
        for (const stage of ['new', 'contacted', 'consultation', 'packages_sent']) {
            assert.equal(check({ stage, last_contacted_at: '2026-01-01T00:00:00Z' }).due, true, stage);
        }
    });
});
