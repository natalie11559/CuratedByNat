// Checks what Nat types into Studio's forms. Every API route runs the same checks on the server, whatever the
// browser did. Messages are short and kind, because they show up as a banner on a phone.
import { isValidEmail } from '../inquiry/validate.ts';
import { isIsoDate } from './dates.ts';
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
