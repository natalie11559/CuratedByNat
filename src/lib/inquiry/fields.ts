// The inquiry form's structure (content doc section 4, design spec 6.12 and 9.4).
// Words Nat can change (labels, options, messages) live in src/content/inquiry-form.json.
// This file holds what must stay fixed: field names, input types, rules and layout.
// It has no Astro or Keystatic imports so Node's test runner can load it directly.

/** "What are you celebrating?" choices. `value` is what the form submits and never changes. */
export const CELEBRATIONS = [
    { value: 'wedding', copyKey: 'wedding' },
    { value: 'bachelorette', copyKey: 'bachelorette' },
    { value: 'bridal-event', copyKey: 'bridalEvent' },
    { value: 'celebration', copyKey: 'celebration' },
    { value: 'not-sure', copyKey: 'notSure' },
] as const;

export type CelebrationValue = (typeof CELEBRATIONS)[number]['value'];
export type CelebrationCopyKey = (typeof CELEBRATIONS)[number]['copyKey'];

/** "Is your event in Georgia?" choices. */
export const GEORGIA_ANSWERS = [
    { value: 'yes', copyKey: 'yes' },
    { value: 'destination', copyKey: 'destination' },
    { value: 'not-sure', copyKey: 'notSure' },
] as const;

export type GeorgiaValue = (typeof GEORGIA_ANSWERS)[number]['value'];
export type GeorgiaCopyKey = (typeof GEORGIA_ANSWERS)[number]['copyKey'];

/** Picking this answer shows the destination note under the Georgia question. */
export const DESTINATION_ANSWER: GeorgiaValue = 'destination';

/** The End date question only appears (and is only accepted) for these multi-day celebrations. */
export const END_DATE_CELEBRATIONS: readonly CelebrationValue[] = ['bachelorette', 'celebration'];

export const MIN_PHONE_DIGITS = 7;

export type FieldName =
    | 'firstName'
    | 'lastName'
    | 'email'
    | 'phone'
    | 'instagram'
    | 'inquirer'
    | 'celebrating'
    | 'eventDate'
    | 'dateNotSet'
    | 'endDate'
    | 'inGeorgia'
    | 'location'
    | 'photoVideo'
    | 'excitedAbout'
    | 'anythingElse'
    | 'foundVia';

export type FieldKind = 'text' | 'email' | 'tel' | 'date' | 'select' | 'checkboxes' | 'checkbox' | 'textarea';

export interface FieldDefinition {
    name: FieldName;
    kind: FieldKind;
    /** Shows the "(optional)" marker when false. Event date is required unless "My date isn't set yet" is checked. */
    required: boolean;
    /** Characters allowed after trimming. Also rendered as the input's maxlength. */
    maxLength: number;
    /** Desktop grid width (design spec 9.4 pairs). Everything is full width on phones. */
    layout: 'half' | 'full';
    autocomplete?: string;
}

/** Every question, in form order. */
export const FIELDS: readonly FieldDefinition[] = [
    { name: 'firstName', kind: 'text', required: true, maxLength: 80, layout: 'half', autocomplete: 'given-name' },
    { name: 'lastName', kind: 'text', required: true, maxLength: 80, layout: 'half', autocomplete: 'family-name' },
    { name: 'email', kind: 'email', required: true, maxLength: 254, layout: 'half', autocomplete: 'email' },
    { name: 'phone', kind: 'tel', required: true, maxLength: 40, layout: 'half', autocomplete: 'tel' },
    { name: 'instagram', kind: 'text', required: false, maxLength: 60, layout: 'half', autocomplete: 'off' },
    { name: 'inquirer', kind: 'select', required: true, maxLength: 200, layout: 'half' },
    { name: 'celebrating', kind: 'checkboxes', required: true, maxLength: 40, layout: 'full' },
    { name: 'eventDate', kind: 'date', required: true, maxLength: 10, layout: 'half' },
    { name: 'endDate', kind: 'date', required: false, maxLength: 10, layout: 'half' },
    { name: 'dateNotSet', kind: 'checkbox', required: false, maxLength: 10, layout: 'full' },
    { name: 'inGeorgia', kind: 'select', required: true, maxLength: 40, layout: 'half' },
    { name: 'location', kind: 'text', required: true, maxLength: 200, layout: 'half', autocomplete: 'off' },
    { name: 'photoVideo', kind: 'select', required: false, maxLength: 200, layout: 'full' },
    { name: 'excitedAbout', kind: 'textarea', required: false, maxLength: 2000, layout: 'full' },
    { name: 'anythingElse', kind: 'textarea', required: false, maxLength: 2000, layout: 'full' },
    { name: 'foundVia', kind: 'select', required: false, maxLength: 200, layout: 'half' },
];

export function getField(name: FieldName): FieldDefinition {
    const field = FIELDS.find((candidate) => candidate.name === name);
    if (!field) throw new Error(`Unknown inquiry field: ${name}`);
    return field;
}

export function fieldId(name: FieldName): string {
    return `inquiry-${name}`;
}

export function errorId(name: FieldName): string {
    return `inquiry-${name}-error`;
}

/** Spam protection fields that are not questions. */
export const HONEYPOT_FIELD = 'website';
export const STARTED_AT_FIELD = 'startedAt';
export const SUBMITTED_AT_FIELD = 'submittedAt';
export const TURNSTILE_FIELD = 'cf-turnstile-response';

/** Anything sent sooner than this after the page loaded is treated as a bot and quietly dropped. */
export const MIN_FILL_MILLISECONDS = 3000;
