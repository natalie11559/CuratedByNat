// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatCents, parseDollars, suggestedTotal, summarizePayments, toDollarInput } from '../../src/lib/studio/money.ts';

describe('parseDollars', () => {
    it('reads dollars the way people type them', () => {
        assert.equal(parseDollars('300'), 30000);
        assert.equal(parseDollars('$300'), 30000);
        assert.equal(parseDollars(' $1,250.50 '), 125050);
        assert.equal(parseDollars('75.5'), 7550);
        assert.equal(parseDollars('0'), 0);
        assert.equal(parseDollars('0.05'), 5);
        assert.equal(parseDollars('.5'), 50);
        assert.equal(parseDollars('007'), 700);
        assert.equal(parseDollars('100000'), 10_000_000);
    });

    it('refuses anything that is not a clean amount', () => {
        for (const bad of ['', ' ', '-5', '1.234', '12abc', 'abc', '1e3', '$', '.', '1,2,3.4.5', '100000.01', '99999999999999999999']) {
            assert.equal(parseDollars(bad), null, JSON.stringify(bad));
        }
    });

    it('does not lose pennies to floating point', () => {
        assert.equal((parseDollars('0.1') ?? NaN) + (parseDollars('0.2') ?? NaN), parseDollars('0.3'));
        assert.equal(parseDollars('19.99'), 1999);
        assert.equal(parseDollars('1.15'), 115);
    });
});

describe('formatCents and toDollarInput', () => {
    it('shows cents only when there are some', () => {
        assert.equal(formatCents(30000), '$300');
        assert.equal(formatCents(125050), '$1,250.50');
        assert.equal(formatCents(5), '$0.05');
        assert.equal(formatCents(0), '$0');
        assert.equal(formatCents(-2500), '-$25');
        assert.equal(formatCents(100000000), '$1,000,000');
    });

    it('round-trips through a form box', () => {
        for (const cents of [0, 5, 7550, 30000, 125050]) assert.equal(parseDollars(toDollarInput(cents)), cents);
        assert.equal(toDollarInput(30000), '300');
        assert.equal(toDollarInput(125050), '1250.50');
    });
});

describe('suggestedTotal', () => {
    it('adds the package, extras with quantities, and travel', () => {
        assert.equal(
            suggestedTotal({
                packagePriceCents: 50000,
                extras: [
                    { priceCents: 7500, quantity: 1 },
                    { priceCents: 5000, quantity: 3 },
                ],
                travelFeeCents: 4000,
            }),
            50000 + 7500 + 15000 + 4000,
        );
        assert.equal(suggestedTotal({ packagePriceCents: 0, extras: [], travelFeeCents: 0 }), 0);
    });
});

describe('summarizePayments', () => {
    const sum = (totalCents: number, retainerCents: number, ...paymentsCents: number[]) => summarizePayments({ totalCents, retainerCents, paymentsCents });

    it('calculates the balance from the payments', () => {
        assert.deepEqual(sum(50000, 10000, 10000, 15000), { totalCents: 50000, paidCents: 25000, balanceCents: 25000, overpaidCents: 0, status: 'retainer_paid' });
    });

    it('moves from unpaid to retainer paid to paid in full', () => {
        assert.equal(sum(50000, 10000).status, 'unpaid');
        assert.equal(sum(50000, 10000, 9999).status, 'unpaid');
        assert.equal(sum(50000, 10000, 10000).status, 'retainer_paid');
        assert.equal(sum(50000, 10000, 10000, 40000).status, 'paid_in_full');
        assert.equal(sum(50000, 0, 1).status, 'unpaid');
    });

    it('handles overpayment and zero totals', () => {
        assert.deepEqual(sum(30000, 0, 35000), { totalCents: 30000, paidCents: 35000, balanceCents: 0, overpaidCents: 5000, status: 'paid_in_full' });
        assert.equal(sum(0, 0).status, 'unpaid');
        assert.equal(sum(0, 0).balanceCents, 0);
    });
});
