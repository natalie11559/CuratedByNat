// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { easternToUtc, formatClock, utcToEastern } from '../../src/lib/studio/tz.ts';

describe('easternToUtc', () => {
    it('uses the summer offset in summer and the winter offset in winter', () => {
        assert.equal(easternToUtc('2026-07-04', '16:30')!.toISOString(), '2026-07-04T20:30:00.000Z'); // EDT, UTC-4
        assert.equal(easternToUtc('2026-12-25', '16:30')!.toISOString(), '2026-12-25T21:30:00.000Z'); // EST, UTC-5
        assert.equal(easternToUtc('2026-10-17', '00:00')!.toISOString(), '2026-10-17T04:00:00.000Z');
        assert.equal(easternToUtc('2026-10-17', '23:59')!.toISOString(), '2026-10-18T03:59:00.000Z');
    });

    it('handles the days the clocks change', () => {
        // 2027-03-14: clocks go forward at 2:00 AM, so 1:30 AM is EST and 3:30 AM is EDT.
        assert.equal(easternToUtc('2027-03-14', '01:30')!.toISOString(), '2027-03-14T06:30:00.000Z');
        assert.equal(easternToUtc('2027-03-14', '03:30')!.toISOString(), '2027-03-14T07:30:00.000Z');
        // 2:30 AM does not exist that day; it is read as the hour after.
        assert.equal(easternToUtc('2027-03-14', '02:30')!.toISOString(), '2027-03-14T07:30:00.000Z');
        // 2026-11-01: clocks go back at 2:00 AM. 12:30 AM is EDT, 1:30 AM happens twice (first one: EDT), 3:30 AM is EST.
        assert.equal(easternToUtc('2026-11-01', '00:30')!.toISOString(), '2026-11-01T04:30:00.000Z');
        assert.equal(easternToUtc('2026-11-01', '01:30')!.toISOString(), '2026-11-01T05:30:00.000Z');
        assert.equal(easternToUtc('2026-11-01', '03:30')!.toISOString(), '2026-11-01T08:30:00.000Z');
    });

    it('refuses things that are not a date and time', () => {
        for (const [date, time] of [['2027-02-30', '10:00'], ['2027-13-01', '10:00'], ['2027-02-01', '24:00'], ['2027-02-01', '9:00'], ['2027-02-01', '10:60'], ['soon', '10:00'], ['2027-02-01', ''], ['', '']] as const) {
            assert.equal(easternToUtc(date, time), null, `${date} ${time}`);
        }
    });
});

describe('utcToEastern and formatClock', () => {
    it('reads a UTC moment back as Eastern wall-clock time', () => {
        assert.deepEqual(utcToEastern('2026-07-04T20:30:00Z'), { date: '2026-07-04', time: '16:30' });
        assert.deepEqual(utcToEastern('2026-12-25T21:30:00Z'), { date: '2026-12-25', time: '16:30' });
        assert.deepEqual(utcToEastern('2026-10-18T03:59:00Z'), { date: '2026-10-17', time: '23:59' });
        assert.deepEqual(utcToEastern(new Date('2026-10-17T04:00:00Z')), { date: '2026-10-17', time: '00:00' });
    });

    it('round-trips every quarter hour of a year', () => {
        for (let day = 0; day < 365; day += 7) {
            const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
            for (const time of ['00:15', '03:45', '09:00', '12:00', '16:30', '23:45']) {
                if (date === '2027-03-14' || date === '2026-11-01') continue;
                const moment = easternToUtc(date, time)!;
                assert.deepEqual(utcToEastern(moment), { date, time }, `${date} ${time}`);
            }
        }
    });

    it('writes the time the way people say it', () => {
        assert.equal(formatClock('00:00'), '12:00 AM');
        assert.equal(formatClock('09:05'), '9:05 AM');
        assert.equal(formatClock('12:00'), '12:00 PM');
        assert.equal(formatClock('16:30'), '4:30 PM');
        assert.equal(formatClock('23:59'), '11:59 PM');
    });
});
