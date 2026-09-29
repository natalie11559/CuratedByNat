// Inquiry validation shared by the browser script and the /api/inquiry endpoint, so both apply
// exactly the same rules. Plain TypeScript with no Astro or Keystatic runtime imports, so it also
// runs under `node --experimental-strip-types` for the unit tests.
import type { InquiryFormContent } from '../content';
import {
    CELEBRATIONS,
    END_DATE_CELEBRATIONS,
    FIELDS,
    GEORGIA_ANSWERS,
    MIN_PHONE_DIGITS,
    getField,
    type CelebrationValue,
    type FieldName,
    type GeorgiaValue,
} from './fields.ts';

/** Raw answers, as posted (strings, arrays of strings or booleans). Unknown keys are ignored. */
export type InquiryInput = Partial<Record<FieldName, unknown>>;

export type FieldErrors = Partial<Record<FieldName, string>>;

export interface ValidationMessages {
    firstName: string;
    lastName: string;
    emailRequired: string;
    emailFormat: string;
    phoneRequired: string;
    phoneFormat: string;
    inquirer: string;
    celebrating: string;
    eventDate: string;
    endDateOrder: string;
    inGeorgia: string;
    location: string;
    invalidDate: string;
    invalidOption: string;
    tooLong: string;
}

export interface ValidationRules {
    messages: ValidationMessages;
    /** The dropdown choices Nat currently has in the editor. Answers must match one of them. */
    options: {
        inquirer: readonly string[];
        photoVideo: readonly string[];
        foundVia: readonly string[];
    };
}

/** A cleaned, valid inquiry. Empty optional answers are empty strings. */
export interface InquirySubmission {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    instagram: string;
    inquirer: string;
    celebrating: CelebrationValue[];
    /** YYYY-MM-DD, or null when "My date isn't set yet" is checked. */
    eventDate: string | null;
    dateNotSet: boolean;
    /** YYYY-MM-DD, only for Bachelorette weekend or Celebration. */
    endDate: string | null;
    inGeorgia: GeorgiaValue;
    location: string;
    photoVideo: string;
    excitedAbout: string;
    anythingElse: string;
    foundVia: string;
}

export type ValidationResult = { ok: true; data: InquirySubmission } | { ok: false; errors: FieldErrors };

// Control characters (tab and line breaks are handled separately), zero-width spaces, byte order
// marks and bidirectional overrides, which can make text in an email look different from what it is.
const INVISIBLE_CHARACTERS =
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​‎‏‪-‮⁦-⁩﻿]/g;

// A plain address: no spaces or characters that need quoting, no leading, trailing or doubled dots,
// and a domain made of letters, digits and hyphens with a top-level domain of two or more letters.
const EMAIL_PATTERN =
    /^(?!\.)(?!.*\.\.)[^\s@<>()[\]\\,;:"]+(?<!\.)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const CELEBRATION_VALUES: readonly string[] = CELEBRATIONS.map((celebration) => celebration.value);
const GEORGIA_VALUES: readonly string[] = GEORGIA_ANSWERS.map((answer) => answer.value);

/** Trims text and strips control characters. Single-line answers also lose tabs and line breaks. */
export function cleanText(value: unknown, multiline = false): string {
    if (typeof value !== 'string') return '';
    let text = value.replace(/\r\n?/g, '\n');
    if (multiline) {
        text = text.replace(/\t/g, ' ').replace(INVISIBLE_CHARACTERS, '');
        text = text.replace(/[ ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    } else {
        text = text.replace(/[\t\n]+/g, ' ').replace(INVISIBLE_CHARACTERS, '').replace(/ {2,}/g, ' ');
    }
    return text.trim();
}

export function isValidEmail(value: string): boolean {
    return EMAIL_PATTERN.test(value);
}

export function countDigits(value: string): number {
    return (value.match(/[0-9]/g) ?? []).length;
}

/** True for a real calendar date written as YYYY-MM-DD (what <input type="date"> submits). */
export function isIsoDate(value: string): boolean {
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) return false;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isCelebration(value: string): value is CelebrationValue {
    return CELEBRATION_VALUES.includes(value);
}

export function isGeorgiaAnswer(value: string): value is GeorgiaValue {
    return GEORGIA_VALUES.includes(value);
}

function isChecked(value: unknown): boolean {
    return value === true || value === 'yes' || value === 'on' || value === 'true';
}

function toList(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return [value];
}

/** True when the End date question applies (Bachelorette weekend or Celebration is checked). */
export function allowsEndDate(celebrating: readonly string[]): boolean {
    return celebrating.some((value) => (END_DATE_CELEBRATIONS as readonly string[]).includes(value));
}

export function validateInquiry(input: InquiryInput, rules: ValidationRules): ValidationResult {
    const { messages } = rules;
    const errors: FieldErrors = {};

    const read = (name: FieldName) => cleanText(input[name], getField(name).kind === 'textarea');
    const isTooLong = (name: FieldName, value: string) => value.length > getField(name).maxLength;

    const requiredText = (name: FieldName, emptyMessage: string) => {
        const value = read(name);
        if (!value) errors[name] = emptyMessage;
        else if (isTooLong(name, value)) errors[name] = messages.tooLong;
        return value;
    };

    const optionalText = (name: FieldName) => {
        const value = read(name);
        if (isTooLong(name, value)) errors[name] = messages.tooLong;
        return value;
    };

    const choice = (name: FieldName, options: readonly string[], emptyMessage?: string) => {
        const value = read(name);
        const current = options.map((option) => cleanText(option));
        if (!value) {
            if (emptyMessage) errors[name] = emptyMessage;
        } else if (!current.includes(value)) {
            errors[name] = emptyMessage ?? messages.invalidOption;
        }
        return value;
    };

    const firstName = requiredText('firstName', messages.firstName);
    const lastName = requiredText('lastName', messages.lastName);

    const email = read('email');
    if (!email) errors.email = messages.emailRequired;
    else if (isTooLong('email', email)) errors.email = messages.tooLong;
    else if (!isValidEmail(email)) errors.email = messages.emailFormat;

    const phone = read('phone');
    if (!phone) errors.phone = messages.phoneRequired;
    else if (isTooLong('phone', phone)) errors.phone = messages.tooLong;
    else if (countDigits(phone) < MIN_PHONE_DIGITS) errors.phone = messages.phoneFormat;

    const instagram = optionalText('instagram');
    const inquirer = choice('inquirer', rules.options.inquirer, messages.inquirer);

    const checked = [...new Set(toList(input.celebrating).map((value) => cleanText(value)))].filter(Boolean);
    const celebrating = checked.filter(isCelebration);
    if (celebrating.length === 0 || celebrating.length !== checked.length) errors.celebrating = messages.celebrating;

    const dateNotSet = isChecked(input.dateNotSet);
    let eventDate: string | null = null;
    if (!dateNotSet) {
        const value = read('eventDate');
        if (!value) errors.eventDate = messages.eventDate;
        else if (!isIsoDate(value)) errors.eventDate = messages.invalidDate;
        else eventDate = value;
    }

    // End date is only asked for multi-day celebrations; anything sent otherwise is ignored.
    let endDate: string | null = null;
    if (allowsEndDate(celebrating)) {
        const value = read('endDate');
        if (value && !isIsoDate(value)) errors.endDate = messages.invalidDate;
        else if (value && eventDate && value < eventDate) errors.endDate = messages.endDateOrder;
        else if (value) endDate = value;
    }

    const inGeorgiaAnswer = read('inGeorgia');
    const inGeorgia = isGeorgiaAnswer(inGeorgiaAnswer) ? inGeorgiaAnswer : null;
    if (!inGeorgia) errors.inGeorgia = messages.inGeorgia;

    const location = requiredText('location', messages.location);
    const photoVideo = choice('photoVideo', rules.options.photoVideo);
    const excitedAbout = optionalText('excitedAbout');
    const anythingElse = optionalText('anythingElse');
    const foundVia = choice('foundVia', rules.options.foundVia);

    if (inGeorgia === null || Object.keys(errors).length > 0) {
        return { ok: false, errors };
    }

    return {
        ok: true,
        data: {
            firstName,
            lastName,
            email,
            phone,
            instagram,
            inquirer,
            celebrating,
            eventDate,
            dateNotSet,
            endDate,
            inGeorgia,
            location,
            photoVideo,
            excitedAbout,
            anythingElse,
            foundVia,
        },
    };
}

/** Anything with FormData's `get`/`getAll` (FormData in the browser, URLSearchParams on the server). */
export interface FormValues {
    get(name: string): unknown;
    getAll(name: string): unknown[];
}

export function inquiryInputFromForm(form: FormValues): InquiryInput {
    const input: InquiryInput = {};
    for (const field of FIELDS) {
        input[field.name] = field.kind === 'checkboxes' ? form.getAll(field.name) : (form.get(field.name) ?? undefined);
    }
    return input;
}

/** Validation settings from the words and choices Nat edits in Keystatic. */
export function rulesFromContent(copy: InquiryFormContent): ValidationRules {
    const questions = copy.fields;
    return {
        messages: {
            firstName: questions.firstName.error,
            lastName: questions.lastName.error,
            emailRequired: questions.email.error,
            emailFormat: questions.email.formatError,
            phoneRequired: questions.phone.error,
            phoneFormat: questions.phone.formatError,
            inquirer: questions.inquirer.error,
            celebrating: questions.celebrating.error,
            eventDate: questions.eventDate.error,
            endDateOrder: questions.endDate.orderError,
            inGeorgia: questions.inGeorgia.error,
            location: questions.location.error,
            invalidDate: copy.messages.invalidDate,
            invalidOption: copy.messages.invalidOption,
            tooLong: copy.messages.tooLong,
        },
        options: {
            inquirer: [...questions.inquirer.options],
            photoVideo: [...questions.photoVideo.options],
            foundVia: [...questions.foundVia.options],
        },
    };
}
