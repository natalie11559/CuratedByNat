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
};

export const ERRORS: Record<string, string> = {
    'not-found': "We couldn't find that.",
    'duplicate-email': 'Another open lead already uses that email.',
    invalid: "Something in that didn't look right. Please try again.",
    'wrong-origin': 'That request did not come from Studio. Please try again from the page.',
    'database-missing': "Studio's database isn't available right now.",
    'import-incomplete': "Some inquiries couldn't be added. They're still saved, and we'll keep trying.",
    'reason-needed': 'Pick a reason first.',
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
};

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
        .map((field) => FIELD_LABELS[field])
        .filter((label): label is string => Boolean(label));
    if (invalid.length > 0) return { kind: 'error', text: `Please check: ${invalid.join(', ')}.` };
    const notice = params.get('notice');
    if (notice && NOTICES[notice]) return { kind: 'ok', text: NOTICES[notice]! };
    return null;
}
