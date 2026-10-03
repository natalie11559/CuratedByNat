// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    addPayment,
    createBooking,
    deletePayment,
    getBookingsForLead,
    listBalancesDue,
    listExtras,
    listPackages,
    packageDetails,
    removeBooking,
    savePriceListItem,
    setPriceListItemActive,
    updateBooking,
} from '../../src/lib/studio/bookings.ts';
import { createLead, getLead, listActivities } from '../../src/lib/studio/queries.ts';
import {
    suggestedBalanceDueDate,
    validateBookingInput,
    validateLeadFields,
    validatePaymentInput,
    validatePriceListItem,
    type PackageOption,
} from '../../src/lib/studio/validate.ts';
import { createTestD1, type TestD1 } from './helpers/d1-sqlite.ts';

const NAT = 'hello@curatedbynat.com';
const at = (iso: string) => ({ actor: NAT, now: new Date(iso) });

// Made-up prices: the real ones are kept out of the repository.
async function setup() {
    const db = createTestD1();
    const lead = validateLeadFields({ first_name: 'Ava', email: 'ava@example.com', event_date: '2027-05-15' });
    if (!lead.ok) throw new Error('bad lead');
    const created = await createLead(db, lead.value, at('2026-10-01T14:00:00Z'));
    const leadId = (created as { id: string }).id;
    const item = (name: string, price: string, details = '') => {
        const checked = validatePriceListItem({ name, price, details });
        if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
        return checked.value;
    };
    const basic = (await savePriceListItem(db, 'package', null, item('Basic', '300', 'Six hours\nOne recap reel'), at('2026-10-01T14:00:00Z'))).id!;
    const plus = (await savePriceListItem(db, 'package', null, item('Plus', '500'), at('2026-10-01T14:00:00Z'))).id!;
    const hour = (await savePriceListItem(db, 'extra', null, item('Extra hour', '50'), at('2026-10-01T14:00:00Z'))).id!;
    const reel = (await savePriceListItem(db, 'extra', null, item('Extra reel', '75'), at('2026-10-01T14:00:00Z'))).id!;
    return { db, leadId, basic, plus, hour, reel };
}

async function lists(db: TestD1) {
    const toOption = (rows: Array<{ id: string; name: string; price_cents: number }>): PackageOption[] =>
        rows.map((row) => ({ id: row.id, name: row.name, priceCents: row.price_cents }));
    return { packages: toOption(await listPackages(db)), extras: toOption(await listExtras(db)) };
}

async function bookingInput(db: TestD1, raw: Record<string, string>) {
    const checked = validateBookingInput(raw, await lists(db));
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
    return checked.value;
}

describe('validateBookingInput', () => {
    it('copies the package price, adds extras and travel, and totals them when no total is typed', async () => {
        const { db, basic, hour, reel } = await setup();
        const input = await bookingInput(db, { package_id: basic, [`extra_${hour}`]: '2', [`extra_${reel}`]: '1', travel_fee: '40', travel_note: 'Savannah', retainer: '100' });
        assert.equal(input.packageName, 'Basic');
        assert.equal(input.packagePriceCents, 30000);
        assert.deepEqual(input.extras.map((extra) => [extra.name, extra.priceCents, extra.quantity]).sort(), [['Extra hour', 5000, 2], ['Extra reel', 7500, 1]]);
        assert.equal(input.totalCents, 30000 + 10000 + 7500 + 4000);
        assert.equal(input.retainerCents, 10000);
        assert.equal(input.travelFeeNote, 'Savannah');
    });

    it('uses a typed total over the suggested one', async () => {
        const { db, plus } = await setup();
        assert.equal((await bookingInput(db, { package_id: plus, total: '450' })).totalCents, 45000);
    });

    it('supports a custom package and none at all', async () => {
        const { db } = await setup();
        const custom = await bookingInput(db, { package_id: 'custom', custom_name: 'Elopement day', custom_price: '$275.50' });
        assert.deepEqual([custom.packageId, custom.packageName, custom.totalCents], [null, 'Elopement day', 27550]);
        const none = await bookingInput(db, { package_id: '', total: '120' });
        assert.deepEqual([none.packageId, none.packageName, none.totalCents], [null, '', 12000]);
    });

    it('reports what is wrong', async () => {
        const { db, basic, hour } = await setup();
        const errors = (raw: Record<string, string>) => {
            const checked = validateBookingInput(raw, { packages: [], extras: [] });
            return checked.ok ? {} : checked.errors;
        };
        assert.ok(errors({ package_id: 'nope' }).package_id);
        assert.ok(errors({ package_id: 'custom', custom_price: '10' }).custom_name);
        assert.ok(errors({ package_id: 'custom', custom_name: 'X', custom_price: 'free' }).custom_price);
        assert.ok(errors({ travel_fee: '-4' }).travel_fee);
        assert.ok(errors({ total: 'a lot' }).total);
        assert.ok(errors({ total: '100', retainer: '150' }).retainer);
        assert.ok(errors({ balance_due_date: '2027-02-30' }).balance_due_date);
        const withExtras = validateBookingInput({ package_id: basic, [`extra_${hour}`]: '99' }, await lists(db));
        assert.equal(withExtras.ok, false);
    });

    it('suggests the balance be due a month before the event', () => {
        assert.equal(suggestedBalanceDueDate('2027-05-15'), '2027-04-15');
        assert.equal(suggestedBalanceDueDate('2027-03-10'), '2027-02-08');
        assert.equal(suggestedBalanceDueDate(null), '');
    });
});

describe('booking a client', () => {
    it('records the booking, copies the prices, moves the lead to Booked and writes it on the timeline', async () => {
        const { db, leadId, basic, hour } = await setup();
        const input = await bookingInput(db, { package_id: basic, [`extra_${hour}`]: '1', retainer: '100', balance_due_date: '2027-04-15' });
        const result = await createBooking(db, leadId, input, at('2026-10-05T15:00:00Z'));
        assert.equal(result.ok, true);

        assert.equal((await getLead(db, leadId))!.stage, 'booked');
        const [booking] = await getBookingsForLead(db, leadId);
        assert.deepEqual(
            [booking!.package_name, booking!.package_price_cents, booking!.total_cents, booking!.retainer_cents, booking!.balance_due_date],
            ['Basic', 30000, 35000, 10000, '2027-04-15'],
        );
        assert.deepEqual(booking!.summary, { totalCents: 35000, paidCents: 0, balanceCents: 35000, overpaidCents: 0, status: 'unpaid' });
        assert.deepEqual(booking!.extras.map((extra) => [extra.name, extra.price_cents, extra.quantity]), [['Extra hour', 5000, 1]]);

        const bodies = (await listActivities(db, leadId)).map((activity) => activity.body);
        assert.ok(bodies.includes('Booked: Basic, total $350.'));
        assert.ok(bodies.includes('Booked.'));
    });

    it('does not move a lead backwards when booking an event that already happened', async () => {
        const { db, leadId, basic } = await setup();
        db.raw.prepare("UPDATE leads SET stage = 'delivered' WHERE id = ?").run(leadId);
        await createBooking(db, leadId, await bookingInput(db, { package_id: basic }), at('2026-10-05T15:00:00Z'));
        assert.equal((await getLead(db, leadId))!.stage, 'delivered');
    });

    it('keeps an existing booking unchanged when the package price changes later', async () => {
        const { db, leadId, basic } = await setup();
        await createBooking(db, leadId, await bookingInput(db, { package_id: basic }), at('2026-10-05T15:00:00Z'));
        const raise = validatePriceListItem({ name: 'Basic', price: '999' });
        if (!raise.ok) throw new Error('bad');
        await savePriceListItem(db, 'package', basic, raise.value, at('2026-10-06T15:00:00Z'));

        const [booking] = await getBookingsForLead(db, leadId);
        assert.equal(booking!.total_cents, 30000);
        assert.equal(booking!.package_price_cents, 30000);
        assert.equal((await listPackages(db)).find((row) => row.id === basic)!.price_cents, 99900);
    });

    it('allows more than one booking for a repeat client and can edit or remove one', async () => {
        const { db, leadId, basic, plus } = await setup();
        await createBooking(db, leadId, await bookingInput(db, { package_id: basic }), at('2026-10-05T15:00:00Z'));
        const second = await createBooking(db, leadId, await bookingInput(db, { package_id: plus }), at('2026-10-06T15:00:00Z'));
        assert.equal((await getBookingsForLead(db, leadId)).length, 2);

        assert.deepEqual(await updateBooking(db, second.id!, await bookingInput(db, { package_id: plus, total: '480' }), at('2026-10-07T15:00:00Z')), { ok: true });
        assert.equal((await getBookingsForLead(db, leadId)).find((booking) => booking.id === second.id)!.total_cents, 48000);

        assert.deepEqual(await removeBooking(db, second.id!, at('2026-10-08T15:00:00Z')), { ok: true });
        assert.equal((await getBookingsForLead(db, leadId)).length, 1);
        assert.deepEqual(await removeBooking(db, second.id!, at('2026-10-08T15:00:00Z')), { ok: false, error: 'not-found' });
    });

    it('refuses to book someone who does not exist', async () => {
        const { db, basic } = await setup();
        assert.deepEqual(await createBooking(db, 'missing', await bookingInput(db, { package_id: basic }), at('2026-10-05T15:00:00Z')), { ok: false, error: 'not-found' });
    });
});

describe('payments', () => {
    async function booked() {
        const context = await setup();
        const booking = await createBooking(context.db, context.leadId, await bookingInput(context.db, { package_id: context.plus, retainer: '100' }), at('2026-10-05T15:00:00Z'));
        return { ...context, bookingId: booking.id! };
    }
    const payment = (raw: Record<string, string>) => {
        const checked = validatePaymentInput(raw, '2026-10-10');
        if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
        return checked.value;
    };

    it('works out the balance and status from the payments received', async () => {
        const { db, leadId, bookingId } = await booked();
        await addPayment(db, bookingId, payment({ amount: '100', method: 'venmo', received_on: '2026-10-06' }), at('2026-10-06T15:00:00Z'));
        let [booking] = await getBookingsForLead(db, leadId);
        assert.deepEqual([booking!.summary.balanceCents, booking!.summary.status], [40000, 'retainer_paid']);

        await addPayment(db, bookingId, payment({ amount: '400.00', method: 'zelle' }), at('2026-10-07T15:00:00Z'));
        [booking] = await getBookingsForLead(db, leadId);
        assert.deepEqual([booking!.summary.balanceCents, booking!.summary.paidCents, booking!.summary.status], [0, 50000, 'paid_in_full']);
        assert.deepEqual(booking!.payments.map((entry) => [entry.amount_cents, entry.method, entry.actor_email]), [[10000, 'venmo', NAT], [40000, 'zelle', NAT]]);
    });

    it('removing a payment brings the balance back, and records who did it', async () => {
        const { db, leadId, bookingId } = await booked();
        await addPayment(db, bookingId, payment({ amount: '500' }), at('2026-10-06T15:00:00Z'));
        const [paid] = await getBookingsForLead(db, leadId);
        assert.equal(paid!.summary.status, 'paid_in_full');

        assert.deepEqual(await deletePayment(db, paid!.payments[0]!.id, at('2026-10-07T15:00:00Z')), { ok: true });
        const [after] = await getBookingsForLead(db, leadId);
        assert.deepEqual([after!.summary.balanceCents, after!.summary.status, after!.payments.length], [50000, 'unpaid', 0]);
        const audit = db.raw.prepare("SELECT action, actor_email FROM audit_log WHERE entity = 'payment' ORDER BY at").all().map((row) => ({ ...row }));
        assert.deepEqual(audit, [{ action: 'create', actor_email: NAT }, { action: 'delete', actor_email: NAT }]);
        assert.deepEqual(await deletePayment(db, paid!.payments[0]!.id, at('2026-10-07T15:00:00Z')), { ok: false, error: 'not-found' });
    });

    it('refuses an amount that is not money', () => {
        for (const amount of ['', '0', '-5', 'abc', '1.999']) {
            assert.equal(validatePaymentInput({ amount }, '2026-10-10').ok, false, amount);
        }
        assert.equal(validatePaymentInput({ amount: '5', method: 'barter' }, '2026-10-10').ok, false);
        assert.equal(validatePaymentInput({ amount: '5', received_on: '2026-02-30' }, '2026-10-10').ok, false);
        const today = validatePaymentInput({ amount: '5' }, '2026-10-10');
        assert.equal(today.ok && today.value.receivedOn, '2026-10-10');
    });

    it('writes payments on the timeline', async () => {
        const { db, leadId, bookingId } = await booked();
        await addPayment(db, bookingId, payment({ amount: '150.50', method: 'cash' }), at('2026-10-06T15:00:00Z'));
        const bodies = (await listActivities(db, leadId)).map((activity) => activity.body);
        assert.ok(bodies.includes('Payment received: $150.50 by cash.'));
    });
});

describe('balances due', () => {
    it('lists unpaid balances due within two weeks or overdue, soonest first', async () => {
        const { db, leadId, basic } = await setup();
        const second = validateLeadFields({ first_name: 'Bea', email: 'bea@example.com' });
        if (!second.ok) throw new Error('bad');
        const beaId = ((await createLead(db, second.value, at('2026-10-01T14:00:00Z'))) as { id: string }).id;
        const third = validateLeadFields({ first_name: 'Cy', email: 'cy@example.com' });
        if (!third.ok) throw new Error('bad');
        const cyId = ((await createLead(db, third.value, at('2026-10-01T14:00:00Z'))) as { id: string }).id;

        await createBooking(db, leadId, await bookingInput(db, { package_id: basic, balance_due_date: '2026-10-30' }), at('2026-10-02T00:00:00Z'));
        const beaBooking = await createBooking(db, beaId, await bookingInput(db, { package_id: basic, balance_due_date: '2026-10-05' }), at('2026-10-02T00:00:00Z'));
        await createBooking(db, cyId, await bookingInput(db, { package_id: basic, balance_due_date: '2026-10-12' }), at('2026-10-02T00:00:00Z'));
        const cyPaid = (await getBookingsForLead(db, cyId))[0]!;
        await addPayment(db, cyPaid.id, { amountCents: 30000, receivedOn: '2026-10-03', method: 'venmo', note: '' }, at('2026-10-03T00:00:00Z'));

        const due = await listBalancesDue(db, '2026-10-10');
        assert.deepEqual(due.map((row) => [row.firstName, row.dueDate, row.balanceCents]), [['Bea', '2026-10-05', 30000]]);

        // Ava's is 20 days away, then inside the two-week window a week later.
        assert.equal((await listBalancesDue(db, '2026-10-10', 14)).some((row) => row.firstName === 'Ava'), false);
        assert.equal((await listBalancesDue(db, '2026-10-17', 14)).some((row) => row.firstName === 'Ava'), true);
        assert.ok(beaBooking.ok);
    });

    it('leaves out lost leads and removed bookings', async () => {
        const { db, leadId, basic } = await setup();
        const booking = await createBooking(db, leadId, await bookingInput(db, { package_id: basic, balance_due_date: '2026-10-05' }), at('2026-10-02T00:00:00Z'));
        assert.equal((await listBalancesDue(db, '2026-10-10')).length, 1);
        db.raw.prepare("UPDATE leads SET stage = 'lost' WHERE id = ?").run(leadId);
        assert.equal((await listBalancesDue(db, '2026-10-10')).length, 0);
        db.raw.prepare("UPDATE leads SET stage = 'booked' WHERE id = ?").run(leadId);
        await removeBooking(db, booking.id!, at('2026-10-03T00:00:00Z'));
        assert.equal((await listBalancesDue(db, '2026-10-10')).length, 0);
    });
});

describe('price lists', () => {
    it('adds, edits and hides packages and extras', async () => {
        const { db, basic, hour } = await setup();
        const packages = await listPackages(db);
        assert.deepEqual(packages.map((row) => [row.name, row.price_cents]), [['Basic', 30000], ['Plus', 50000]]);
        assert.deepEqual(packageDetails(packages[0]!), ['Six hours', 'One recap reel']);

        assert.deepEqual(await setPriceListItemActive(db, 'package', basic, false, at('2026-10-02T00:00:00Z')), { ok: true });
        assert.deepEqual((await listPackages(db)).map((row) => row.name), ['Plus']);
        assert.equal((await listPackages(db, { includeInactive: true })).length, 2);
        assert.deepEqual(await setPriceListItemActive(db, 'extra', hour, false, at('2026-10-02T00:00:00Z')), { ok: true });
        assert.deepEqual((await listExtras(db)).map((row) => row.name), ['Extra reel']);
        assert.deepEqual(await setPriceListItemActive(db, 'extra', 'nope', false, at('2026-10-02T00:00:00Z')), { ok: false, error: 'not-found' });
    });

    it('validates a price list item', () => {
        assert.equal(validatePriceListItem({ name: '', price: '5' }).ok, false);
        assert.equal(validatePriceListItem({ name: 'X', price: 'free' }).ok, false);
        assert.equal(validatePriceListItem({ name: 'X', price: '5', sort_order: '-1' }).ok, false);
        assert.equal(validatePriceListItem({ name: 'X', price: '5', details: Array(31).fill('line').join('\n') }).ok, false);
        const ok = validatePriceListItem({ name: ' The Classic ', price: '$300', details: ' a \n\n b ', active: '0' });
        assert.deepEqual(ok.ok && ok.value, { name: 'The Classic', priceCents: 30000, details: ['a', 'b'], sortOrder: 0, active: false });
    });
});
