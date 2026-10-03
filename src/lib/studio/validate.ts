// Checks what Nat types into Studio's forms. Every API route runs the same checks on the server, whatever the
// browser did. Messages are short and kind, because they show up as a banner on a phone.
import { isValidEmail } from '../inquiry/validate.ts';
import { CALENDAR_TYPES, type CalendarType } from './calendar.ts';
import { addDays, isIsoDate } from './dates.ts';
import { parseDollars, PAYMENT_METHODS, suggestedTotal, type PaymentMethod } from './money.ts';
import { easternToUtc } from './tz.ts';
import { CELEBRATING, SOURCES, type CelebratingId, type SourceId } from './vocab.ts';

export type RawInput = Record<string, string | string[] | undefined>;
export type Errors = Record<string, string>;
export type Checked<T> = { ok: true; value: T } | { ok: false; errors: Errors };

export function str(raw: RawInput, key: string): string {
    const value = raw[key];
    return (Array.isArray(value) ? value[0] : value)?.toString().replace(/\r\n/g, '\n').trim() ?? '';
}

export function list(raw: RawInput, key: string): string[] {
    const value = raw[key];
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

export function tooLong(value: string, max: number): boolean {
    return value.length > max;
}

/** "@Emory.Co", "instagram.com/emory.co/" and "emory.co" all become "emory.co". */
export function normalizeInstagram(value: string): string {
    return value
        .trim()
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/^instagram\.com\//i, '')
        .replace(/^@/, '')
        .replace(/[/?#].*$/, '');
}

export const IN_GEORGIA_VALUES = ['', 'yes', 'destination', 'not-sure'] as const;

/** The details of a lead that Nat can type or correct. */
export interface LeadFields {
    first_name: string;
    last_name: string;
    partner_name: string;
    email: string;
    phone: string;
    instagram: string;
    source: SourceId;
    celebrating: CelebratingId[];
    event_date: string | null;
    end_date: string | null;
    date_not_set: boolean;
    location: string;
    in_georgia: (typeof IN_GEORGIA_VALUES)[number];
    venue: string;
    notes: string;
}

export function validateLeadFields(raw: RawInput): Checked<LeadFields> {
    const errors: Errors = {};

    const firstName = str(raw, 'first_name');
    if (!firstName) errors.first_name = 'Add a first name so you can find them later.';
    else if (tooLong(firstName, 80)) errors.first_name = 'That first name is too long.';

    const lastName = str(raw, 'last_name');
    if (tooLong(lastName, 80)) errors.last_name = 'That last name is too long.';
    const partnerName = str(raw, 'partner_name');
    if (tooLong(partnerName, 80)) errors.partner_name = 'That name is too long.';

    const email = str(raw, 'email');
    if (email && (tooLong(email, 254) || !isValidEmail(email))) errors.email = "That email doesn't look right.";

    const phone = str(raw, 'phone');
    if (tooLong(phone, 40)) errors.phone = 'That phone number is too long.';

    const instagram = normalizeInstagram(str(raw, 'instagram'));
    if (!/^[A-Za-z0-9._]{0,30}$/.test(instagram)) errors.instagram = "That doesn't look like an Instagram handle.";

    const source = (str(raw, 'source') || 'other') as SourceId;
    if (!SOURCES.some((entry) => entry.id === source)) errors.source = 'Pick where this lead came from.';

    const celebrating = list(raw, 'celebrating').filter((value, index, all) => all.indexOf(value) === index);
    if (celebrating.some((value) => !CELEBRATING.some((entry) => entry.id === value))) {
        errors.celebrating = 'Pick from the choices shown.';
    }

    const dateNotSet = str(raw, 'date_not_set') === '1' || str(raw, 'date_not_set') === 'on';
    let eventDate: string | null = str(raw, 'event_date') || null;
    let endDate: string | null = str(raw, 'end_date') || null;
    if (dateNotSet) {
        eventDate = null;
        endDate = null;
    } else {
        if (eventDate && !isIsoDate(eventDate)) errors.event_date = "That date doesn't look right.";
        if (endDate && !isIsoDate(endDate)) errors.end_date = "That date doesn't look right.";
        if (endDate && !eventDate) errors.end_date = 'Add the start date first.';
        if (eventDate && endDate && !errors.event_date && !errors.end_date && endDate < eventDate) {
            errors.end_date = 'The end date comes before the start date.';
        }
    }

    const location = str(raw, 'location');
    if (tooLong(location, 200)) errors.location = 'That is too long.';
    const venue = str(raw, 'venue');
    if (tooLong(venue, 200)) errors.venue = 'That is too long.';
    const inGeorgia = str(raw, 'in_georgia') as LeadFields['in_georgia'];
    if (!IN_GEORGIA_VALUES.includes(inGeorgia)) errors.in_georgia = 'Pick from the choices shown.';
    const notes = str(raw, 'notes');
    if (tooLong(notes, 5000)) errors.notes = 'Those notes are too long.';

    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return {
        ok: true,
        value: {
            first_name: firstName,
            last_name: lastName,
            partner_name: partnerName,
            email,
            phone,
            instagram,
            source,
            celebrating: celebrating as CelebratingId[],
            event_date: eventDate,
            end_date: endDate,
            date_not_set: dateNotSet,
            location,
            in_georgia: inGeorgia,
            venue,
            notes,
        },
    };
}

export function validateFollowUpDate(raw: RawInput): Checked<string | null> {
    const value = str(raw, 'next_follow_up_at');
    if (!value) return { ok: true, value: null };
    return isIsoDate(value) ? { ok: true, value } : { ok: false, errors: { next_follow_up_at: "That date doesn't look right." } };
}

// ---- Bookings, payments and price lists ---------------------------------------------------------------

export interface PackageOption {
    id: string;
    name: string;
    priceCents: number;
}

export interface BookingExtraInput {
    extraId: string | null;
    name: string;
    priceCents: number;
    quantity: number;
}

/** What goes into a booking. Prices are copied from the price lists here, not looked up later. */
export interface BookingInput {
    packageId: string | null;
    packageName: string;
    packagePriceCents: number;
    extras: BookingExtraInput[];
    travelFeeCents: number;
    travelFeeNote: string;
    totalCents: number;
    retainerCents: number;
    balanceDueDate: string | null;
    notes: string;
}

function money(raw: RawInput, key: string, errors: Errors, message: string, allowBlank = true): number | null {
    const text = str(raw, key);
    if (text === '') return allowBlank ? null : (errors[key] = message, null);
    const cents = parseDollars(text);
    if (cents === null) errors[key] = message;
    return cents;
}

/**
 * Reads the booking form. `packages` and `extras` are the current price lists; the chosen prices are copied.
 * A blank total means "package + extras + travel". Extras are named `extra_<id>` and carry a quantity.
 */
export function validateBookingInput(
    raw: RawInput,
    lists: { packages: readonly PackageOption[]; extras: readonly PackageOption[] },
): Checked<BookingInput> {
    const errors: Errors = {};

    const packageId = str(raw, 'package_id');
    let packageName = '';
    let packagePriceCents = 0;
    if (packageId && packageId !== 'custom') {
        const chosen = lists.packages.find((entry) => entry.id === packageId);
        if (!chosen) errors.package_id = 'Pick a package from the list.';
        else {
            packageName = chosen.name;
            packagePriceCents = chosen.priceCents;
        }
    } else if (packageId === 'custom') {
        packageName = str(raw, 'custom_name');
        if (!packageName) errors.custom_name = 'Name this package.';
        else if (tooLong(packageName, 100)) errors.custom_name = 'That name is too long.';
        packagePriceCents = money(raw, 'custom_price', errors, "That price doesn't look right.", false) ?? 0;
    }

    const extras: BookingExtraInput[] = [];
    for (const extra of lists.extras) {
        const quantityText = str(raw, `extra_${extra.id}`);
        if (quantityText === '' || quantityText === '0') continue;
        const quantity = Number(quantityText);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
            errors[`extra_${extra.id}`] = 'Use a whole number from 1 to 20.';
            continue;
        }
        extras.push({ extraId: extra.id, name: extra.name, priceCents: extra.priceCents, quantity });
    }

    const travelFeeCents = money(raw, 'travel_fee', errors, "That travel fee doesn't look right.") ?? 0;
    const travelFeeNote = str(raw, 'travel_note');
    if (tooLong(travelFeeNote, 200)) errors.travel_note = 'That note is too long.';

    const typedTotal = money(raw, 'total', errors, "That total doesn't look right.");
    const retainerCents = money(raw, 'retainer', errors, "That retainer doesn't look right.") ?? 0;

    const balanceDueDate = str(raw, 'balance_due_date') || null;
    if (balanceDueDate && !isIsoDate(balanceDueDate)) errors.balance_due_date = "That date doesn't look right.";

    const notes = str(raw, 'notes');
    if (tooLong(notes, 5000)) errors.notes = 'Those notes are too long.';

    const totalCents = typedTotal ?? suggestedTotal({ packagePriceCents, extras, travelFeeCents });
    if (!errors.total && !errors.retainer && retainerCents > totalCents) errors.retainer = 'The retainer is more than the total.';

    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return {
        ok: true,
        value: {
            packageId: packageId && packageId !== 'custom' ? packageId : null,
            packageName,
            packagePriceCents,
            extras,
            travelFeeCents,
            travelFeeNote,
            totalCents,
            retainerCents,
            balanceDueDate,
            notes,
        },
    };
}

/** The balance is normally due a month before the event. */
export function suggestedBalanceDueDate(eventDate: string | null): string {
    return eventDate && isIsoDate(eventDate) ? addDays(eventDate, -30) : '';
}

export interface PaymentInput {
    amountCents: number;
    receivedOn: string;
    method: PaymentMethod;
    note: string;
}

export function validatePaymentInput(raw: RawInput, today: string): Checked<PaymentInput> {
    const errors: Errors = {};
    const amountCents = parseDollars(str(raw, 'amount'));
    if (amountCents === null || amountCents <= 0) errors.amount = 'Enter the amount received, like 150 or 150.50.';

    const receivedOn = str(raw, 'received_on') || today;
    if (!isIsoDate(receivedOn)) errors.received_on = "That date doesn't look right.";

    const method = (str(raw, 'method') || 'other') as PaymentMethod;
    if (!PAYMENT_METHODS.some((entry) => entry.id === method)) errors.method = 'Pick from the choices shown.';

    const note = str(raw, 'note');
    if (tooLong(note, 200)) errors.note = 'That note is too long.';

    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return { ok: true, value: { amountCents: amountCents!, receivedOn, method, note } };
}

export interface PriceListInput {
    name: string;
    priceCents: number;
    /** Packages only: the "what's included" lines. */
    details: string[];
    sortOrder: number;
    active: boolean;
}

/** One package or extra from the settings forms. */
export function validatePriceListItem(raw: RawInput): Checked<PriceListInput> {
    const errors: Errors = {};
    const name = str(raw, 'name');
    if (!name) errors.name = 'Give it a name.';
    else if (tooLong(name, 100)) errors.name = 'That name is too long.';

    const priceCents = parseDollars(str(raw, 'price'));
    if (priceCents === null) errors.price = "That price doesn't look right.";

    const details = str(raw, 'details')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (details.length > 30 || details.some((line) => tooLong(line, 200))) errors.details = 'Keep it to 30 short lines.';

    const sortOrder = str(raw, 'sort_order') === '' ? 0 : Number(str(raw, 'sort_order'));
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) errors.sort_order = 'Use a whole number from 0 to 999.';

    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return {
        ok: true,
        value: { name, priceCents: priceCents!, details, sortOrder, active: str(raw, 'active') !== '0' },
    };
}

// ---- Calendar items ----------------------------------------------------------------------------------

/** A calendar item ready to save. */
export interface CalendarItemInput {
    type: CalendarType;
    title: string;
    leadId: string | null;
    /** All-day: YYYY-MM-DD. Timed: a UTC moment. */
    startsAt: string;
    endsAt: string | null;
    allDay: boolean;
    location: string;
    notes: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the calendar item form. Times are typed in Eastern time. A title is needed unless the item is about a client,
 * in which case it defaults to something like "Consultation with Ava".
 */
export function validateCalendarItem(raw: RawInput): Checked<CalendarItemInput> {
    const errors: Errors = {};

    const type = str(raw, 'type') as CalendarType;
    if (!CALENDAR_TYPES.some((entry) => entry.id === type)) errors.type = 'Pick what kind of item it is.';

    const leadId = str(raw, 'lead_id') || null;
    if (leadId && !UUID.test(leadId)) errors.lead_id = 'Pick someone from the list.';

    const title = str(raw, 'title');
    if (tooLong(title, 120)) errors.title = 'That title is too long.';
    if (!title && !leadId) errors.title = 'Give it a title.';

    const date = str(raw, 'date');
    if (!isIsoDate(date)) errors.date = 'Pick a date.';

    const allDay = str(raw, 'all_day') === '1' || str(raw, 'all_day') === 'on';
    const endDate = str(raw, 'end_date') || null;
    if (endDate && !isIsoDate(endDate)) errors.end_date = "That date doesn't look right.";
    if (endDate && !errors.date && !errors.end_date && endDate < date) errors.end_date = 'The end date comes before the start.';

    let startsAt = date;
    let endsAt: string | null = null;
    if (allDay) {
        endsAt = endDate && endDate !== date ? endDate : null;
    } else if (!errors.date) {
        const startTime = str(raw, 'start_time');
        const start = easternToUtc(date, startTime);
        if (!start) errors.start_time = 'Pick a start time.';
        else startsAt = start.toISOString();

        const endTime = str(raw, 'end_time');
        if (endTime && !errors.end_date) {
            const end = easternToUtc(endDate ?? date, endTime);
            if (!end) errors.end_time = "That time doesn't look right.";
            else if (start && end <= start) errors.end_time = 'The end comes before the start.';
            else endsAt = end.toISOString();
        }
    }

    const location = str(raw, 'location');
    if (tooLong(location, 200)) errors.location = 'That is too long.';
    const notes = str(raw, 'notes');
    if (tooLong(notes, 5000)) errors.notes = 'Those notes are too long.';

    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return { ok: true, value: { type, title, leadId, startsAt, endsAt, allDay, location, notes } };
}

// ---- Reply templates ---------------------------------------------------------------------------------

export interface TemplateInput {
    name: string;
    subject: string;
    body: string;
    sortOrder: number;
    isDraft: boolean;
}

export function validateTemplate(raw: RawInput): Checked<TemplateInput> {
    const errors: Errors = {};
    const name = str(raw, 'name');
    if (!name) errors.name = 'Give the template a name.';
    else if (tooLong(name, 80)) errors.name = 'That name is too long.';
    const subject = str(raw, 'subject');
    if (!subject) errors.subject = 'Add a subject line.';
    else if (tooLong(subject, 200)) errors.subject = 'That subject is too long.';
    const body = str(raw, 'body');
    if (!body) errors.body = 'Add the message.';
    else if (tooLong(body, 8000)) errors.body = 'That message is too long.';
    const sortOrder = str(raw, 'sort_order') === '' ? 0 : Number(str(raw, 'sort_order'));
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) errors.sort_order = 'Use a whole number from 0 to 999.';

    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return { ok: true, value: { name, subject, body, sortOrder, isDraft: str(raw, 'is_draft') === '1' } };
}

export interface GeneralSettingsInput {
    followUpDays: number;
    lostReasons: string[];
}

export function validateGeneralSettings(raw: RawInput): Checked<GeneralSettingsInput> {
    const errors: Errors = {};
    const followUpDays = Number(str(raw, 'follow_up_days'));
    if (!Number.isInteger(followUpDays) || followUpDays < 1 || followUpDays > 60) errors.follow_up_days = 'Use a whole number from 1 to 60.';

    const reasons = str(raw, 'lost_reasons')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line, index, all) => all.indexOf(line) === index);
    if (reasons.length === 0 || reasons.length > 12 || reasons.some((line) => tooLong(line, 60))) {
        errors.lost_reasons = 'Add between 1 and 12 reasons, one per line.';
    }

    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return { ok: true, value: { followUpDays, lostReasons: reasons } };
}
