// The short banners Studio shows after something happens. Pages redirect with a code in the address
// (?notice=saved), never with the words themselves, so a link can only ever show these messages.

export const NOTICES: Record<string, string> = {
    'lead-added': 'Lead added.',
    saved: 'Saved.',
    moved: 'Moved.',
    'contact-logged': 'Logged.',
    'note-added': 'Note added.',
    'followup-set': 'Follow-up date saved.',
    'followup-cleared': 'Follow-up date cleared.',
    lost: 'Marked as lost.',
    reopened: 'Reopened.',
    deleted: 'Moved to Recently deleted.',
    restored: 'Restored.',
    imported: 'Your inquiries are up to date.',
    booked: 'Booked! Their details are below.',
    'booking-needed': 'Add the booking details below to mark them as booked.',
    'booking-saved': 'Booking saved.',
    'booking-removed': 'Booking removed.',
    'payment-added': 'Payment recorded.',
    'payment-removed': 'Payment removed.',
    'price-saved': 'Saved.',
    'price-hidden': 'Hidden. It stays on past bookings.',
    'price-shown': 'It is back on the list.',
    'file-added': 'File saved.',
    'file-removed': 'File removed. It is kept for 30 days in case you need it back.',
    'item-added': 'Added to your calendar.',
    'item-saved': 'Calendar item saved.',
    'item-removed': 'Calendar item removed.',
    'feed-reset': 'Done. Your old calendar link has stopped working. Use the new one below.',
};

export const ERRORS: Record<string, string> = {
    'not-found': "We couldn't find that.",
    'duplicate-email': 'Another open lead already uses that email.',
    invalid: "Something in that didn't look right. Please try again.",
    'wrong-origin': 'That request did not come from Studio. Please try again from the page.',
    'database-missing': "Studio's database isn't available right now.",
    'import-incomplete': "Some inquiries couldn't be added. They're still saved, and we'll keep trying.",
    'reason-needed': 'Pick a reason first.',
    'file-missing': 'Choose a file first.',
    'file-empty': 'That file is empty.',
    'file-type': 'Studio keeps PDFs and photos (JPG, PNG or HEIC). That file looks like something else.',
    'file-too-large': 'That file is over 25 MB. Try a smaller scan or photo.',
    'storage-missing': "File storage isn't available right now.",
};

/** Labels for the form boxes named in `?invalid=first_name,email`. */
export const FIELD_LABELS: Record<string, string> = {
    first_name: 'First name',
    last_name: 'Last name',
    partner_name: 'Partner',
    email: 'Email',
    phone: 'Phone',
    instagram: 'Instagram',
    source: 'Source',
    celebrating: 'What they are celebrating',
    event_date: 'Event date',
    end_date: 'End date',
    location: 'Location',
    in_georgia: 'In Georgia',
    venue: 'Venue',
    notes: 'Notes',
    next_follow_up_at: 'Follow-up date',
    package_id: 'Package',
    custom_name: 'Package name',
    custom_price: 'Package price',
    travel_fee: 'Travel fee',
    travel_note: 'Travel note',
    total: 'Total',
    retainer: 'Retainer',
    balance_due_date: 'Balance due date',
    amount: 'Amount',
    received_on: 'Date received',
    method: 'How it was paid',
    note: 'Note',
    name: 'Name',
    price: 'Price',
    details: "What's included",
    sort_order: 'Order',
    type: 'Kind',
    lead_id: 'Client',
    title: 'Title',
    date: 'Date',
    start_time: 'Start time',
    end_time: 'End time',
};

/** Extras are named extra_<id> in the booking form. */
function labelFor(field: string): string | undefined {
    return FIELD_LABELS[field] ?? (field.startsWith('extra_') ? 'Extras' : undefined);
}

const LEAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (value: string | null | undefined): value is string => typeof value === 'string' && LEAD_ID.test(value);

export interface Banner {
    kind: 'ok' | 'error';
    text: string;
    /** For "another lead already uses that email": where that lead is. */
    leadId?: string;
}

/** Reads ?notice= / ?error= / ?invalid= from an address. Unknown codes show nothing. */
export function bannerFrom(params: URLSearchParams): Banner | null {
    const error = params.get('error');
    if (error && ERRORS[error]) {
        const leadId = params.get('lead');
        return { kind: 'error', text: ERRORS[error]!, leadId: error === 'duplicate-email' && isId(leadId) ? leadId : undefined };
    }
    const invalid = (params.get('invalid') ?? '')
        .split(',')
        .map((field) => labelFor(field))
        .filter((label, index, all): label is string => Boolean(label) && all.indexOf(label) === index);
    if (invalid.length > 0) return { kind: 'error', text: `Please check: ${invalid.join(', ')}.` };
    const notice = params.get('notice');
    if (notice && NOTICES[notice]) return { kind: 'ok', text: NOTICES[notice]! };
    return null;
}
