// Money in Studio is always whole cents (an integer), never a decimal number, so totals can't drift by a penny.
// There is no payment processing: this only records what was agreed and what has been received.

const MAX_CENTS = 10_000_000; // $100,000

/** "300", "$1,250.50" and "75.5" become cents. Anything else (negative, three decimals, letters) is null. */
export function parseDollars(input: string): number | null {
    const cleaned = input.trim().replace(/[$,\s]/g, '');
    const match = /^(\d*)(?:\.(\d{1,2}))?$/.exec(cleaned);
    if (!match || (match[1] === '' && match[2] === undefined)) return null;
    const cents = Number(match[1] || '0') * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
    return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

/** 30000 becomes "$300"; 125050 becomes "$1,250.50". */
export function formatCents(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    const absolute = Math.abs(cents);
    const whole = Math.floor(absolute / 100).toLocaleString('en-US');
    const fraction = absolute % 100;
    return `${sign}$${whole}${fraction === 0 ? '' : `.${String(fraction).padStart(2, '0')}`}`;
}

/** For a form box: 30000 becomes "300", 125050 becomes "1250.50". */
export function toDollarInput(cents: number): string {
    return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export interface PricedLine {
    priceCents: number;
    quantity: number;
}

/** Package plus extras plus travel. This is only the starting figure: Nat can type a different total. */
export function suggestedTotal(input: { packagePriceCents: number; extras: readonly PricedLine[]; travelFeeCents: number }): number {
    return input.packagePriceCents + input.travelFeeCents + input.extras.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
}

export type PaymentStatus = 'unpaid' | 'retainer_paid' | 'paid_in_full';

export interface BalanceSummary {
    totalCents: number;
    paidCents: number;
    /** Never negative; see `overpaidCents`. */
    balanceCents: number;
    overpaidCents: number;
    status: PaymentStatus;
}

/** The balance is always worked out from the payments, never stored. */
export function summarizePayments(input: { totalCents: number; retainerCents: number; paymentsCents: readonly number[] }): BalanceSummary {
    const paidCents = input.paymentsCents.reduce((sum, amount) => sum + amount, 0);
    const difference = input.totalCents - paidCents;
    const paidInFull = input.totalCents > 0 && difference <= 0;
    const status: PaymentStatus = paidInFull ? 'paid_in_full' : input.retainerCents > 0 && paidCents >= input.retainerCents ? 'retainer_paid' : 'unpaid';
    return {
        totalCents: input.totalCents,
        paidCents,
        balanceCents: Math.max(difference, 0),
        overpaidCents: Math.max(-difference, 0),
        status,
    };
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
    unpaid: 'Unpaid',
    retainer_paid: 'Retainer paid',
    paid_in_full: 'Paid in full',
};

export const PAYMENT_METHODS = [
    { id: 'venmo', label: 'Venmo' },
    { id: 'zelle', label: 'Zelle' },
    { id: 'cash', label: 'Cash' },
    { id: 'check', label: 'Check' },
    { id: 'card', label: 'Card' },
    { id: 'other', label: 'Other' },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['id'];
