// Run with: npm run test:unit (node --experimental-strip-types --test tests/unit/)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { FIELDS, getField } from '../../src/lib/inquiry/fields.ts';
import {
    cleanText,
    countDigits,
    inquiryInputFromForm,
    isIsoDate,
    isValidEmail,
    rulesFromContent,
    validateInquiry,
    type InquiryInput,
} from '../../src/lib/inquiry/validate.ts';

const content = JSON.parse(readFileSync(new URL('../../src/content/inquiry-form.json', import.meta.url), 'utf8'));
const rules = rulesFromContent(content);

function validInput(overrides: InquiryInput = {}): InquiryInput {
    return {
        firstName: 'Sarah',
        lastName: 'Smith',
        email: 'sarah@example.com',
        phone: '(404) 555-0134',
        instagram: '@sarahsmith',
        inquirer: 'The bride or couple',
        celebrating: ['wedding'],
        eventDate: '2027-06-06',
        inGeorgia: 'yes',
        location: 'Athens, The Foundry',
        photoVideo: 'Photographer only',
        excitedAbout: 'The first look',
        anythingElse: '',
        foundVia: 'Instagram',
        ...overrides,
    };
}

function errorsFor(input: InquiryInput) {
    const result = validateInquiry(input, rules);
    return result.ok ? {} : result.errors;
}

describe('rulesFromContent', () => {
    it('reads every message and option list from the Keystatic content', () => {
        for (const [key, message] of Object.entries(rules.messages)) {
            assert.equal(typeof message, 'string', `${key} should be a string`);
            assert.ok(message.length > 0, `${key} should not be empty`);
        }
        assert.deepEqual(rules.options.inquirer, content.fields.inquirer.options);
        assert.deepEqual(rules.options.photoVideo, content.fields.photoVideo.options);
        assert.deepEqual(rules.options.foundVia, content.fields.foundVia.options);
    });

    it('uses the spec 6.12 error copy', () => {
        assert.equal(rules.messages.firstName, 'Please add your first name.');
        assert.equal(rules.messages.emailFormat, 'That email looks a little off. Try name@example.com.');
        assert.equal(rules.messages.celebrating, "Pick at least one, even if it's Not sure yet.");
        assert.equal(rules.messages.eventDate, "Please add a date, or check My date isn't set yet.");
        assert.equal(rules.messages.location, "Please add a city, even if the venue isn't booked.");
    });
});

describe('validateInquiry', () => {
    it('accepts a complete inquiry and returns cleaned data', () => {
        const result = validateInquiry(validInput({ firstName: '  Sarah  ' }), rules);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.data.firstName, 'Sarah');
        assert.deepEqual(result.data.celebrating, ['wedding']);
        assert.equal(result.data.eventDate, '2027-06-06');
        assert.equal(result.data.dateNotSet, false);
        assert.equal(result.data.endDate, null);
        assert.equal(result.data.inGeorgia, 'yes');
    });

    it('flags every empty required field with its own message', () => {
        const errors = errorsFor({});
        assert.deepEqual(errors, {
            firstName: rules.messages.firstName,
            lastName: rules.messages.lastName,
            email: rules.messages.emailRequired,
            phone: rules.messages.phoneRequired,
            inquirer: rules.messages.inquirer,
            celebrating: rules.messages.celebrating,
            eventDate: rules.messages.eventDate,
            inGeorgia: rules.messages.inGeorgia,
            location: rules.messages.location,
        });
    });

    it('treats whitespace-only answers as empty', () => {
        assert.equal(errorsFor(validInput({ firstName: '   ', location: '\n\t' })).firstName, rules.messages.firstName);
        assert.equal(errorsFor(validInput({ location: '\n\t ' })).location, rules.messages.location);
    });

    it('checks the email format', () => {
        assert.equal(errorsFor(validInput({ email: 'sarah@gmail' })).email, rules.messages.emailFormat);
        assert.equal(errorsFor(validInput({ email: 'sarah gmail.com' })).email, rules.messages.emailFormat);
        assert.equal(errorsFor(validInput({ email: 'sarah@gmail.com' })).email, undefined);
    });

    it('needs at least 7 digits in the phone number', () => {
        assert.equal(errorsFor(validInput({ phone: '555-123' })).phone, rules.messages.phoneFormat);
        assert.equal(errorsFor(validInput({ phone: '555-1234' })).phone, undefined);
        assert.equal(errorsFor(validInput({ phone: '+1 (404) 555-0134' })).phone, undefined);
        assert.equal(countDigits('+1 (404) 555-0134'), 11);
    });

    it('makes the event date optional when "My date isn\'t set yet" is checked', () => {
        const result = validateInquiry(validInput({ eventDate: '', dateNotSet: 'yes' }), rules);
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.data.eventDate, null);
            assert.equal(result.data.dateNotSet, true);
        }
        // A date sent alongside the checkbox is ignored, as the field is disabled in the form.
        const ignored = validateInquiry(validInput({ eventDate: '2027-06-06', dateNotSet: true }), rules);
        assert.equal(ignored.ok && ignored.data.eventDate, null);
    });

    it('rejects dates that are not real calendar dates', () => {
        assert.equal(errorsFor(validInput({ eventDate: '2027-02-30' })).eventDate, rules.messages.invalidDate);
        assert.equal(errorsFor(validInput({ eventDate: 'June 6' })).eventDate, rules.messages.invalidDate);
        assert.equal(isIsoDate('2028-02-29'), true);
        assert.equal(isIsoDate('2027-02-29'), false);
    });

    it('only accepts an end date for Bachelorette weekend or Celebration', () => {
        const wedding = validateInquiry(validInput({ celebrating: ['wedding'], endDate: '2027-06-08' }), rules);
        assert.equal(wedding.ok && wedding.data.endDate, null);

        const bachelorette = validateInquiry(validInput({ celebrating: ['bachelorette'], endDate: '2027-06-08' }), rules);
        assert.equal(bachelorette.ok && bachelorette.data.endDate, '2027-06-08');

        const celebration = validateInquiry(validInput({ celebrating: ['celebration'], endDate: '2027-06-06' }), rules);
        assert.equal(celebration.ok && celebration.data.endDate, '2027-06-06');
    });

    it('rejects an end date before the event date', () => {
        const errors = errorsFor(validInput({ celebrating: ['bachelorette'], endDate: '2027-06-05' }));
        assert.equal(errors.endDate, rules.messages.endDateOrder);
    });

    it('needs at least one known celebration', () => {
        assert.equal(errorsFor(validInput({ celebrating: [] })).celebrating, rules.messages.celebrating);
        assert.equal(errorsFor(validInput({ celebrating: ['quinceanera'] })).celebrating, rules.messages.celebrating);
        assert.equal(errorsFor(validInput({ celebrating: ['wedding', 'made-up'] })).celebrating, rules.messages.celebrating);
        const single = validateInquiry(validInput({ celebrating: 'not-sure' }), rules);
        assert.equal(single.ok && single.data.celebrating.join(), 'not-sure');
        const duplicates = validateInquiry(validInput({ celebrating: ['wedding', 'wedding', 'bridal-event'] }), rules);
        assert.deepEqual(duplicates.ok && duplicates.data.celebrating, ['wedding', 'bridal-event']);
    });

    it('only accepts dropdown answers that match a current choice', () => {
        assert.equal(errorsFor(validInput({ inquirer: 'The groom' })).inquirer, rules.messages.inquirer);
        assert.equal(errorsFor(validInput({ inGeorgia: 'Yes' })).inGeorgia, rules.messages.inGeorgia);
        assert.equal(errorsFor(validInput({ inGeorgia: 'destination' })).inGeorgia, undefined);
        assert.equal(errorsFor(validInput({ photoVideo: 'Drone only' })).photoVideo, rules.messages.invalidOption);
        assert.equal(errorsFor(validInput({ foundVia: 'Billboard' })).foundVia, rules.messages.invalidOption);
        assert.equal(errorsFor(validInput({ photoVideo: '', foundVia: '' })).photoVideo, undefined);
    });

    it('follows the choices Nat has in the editor', () => {
        const edited = { ...rules, options: { ...rules.options, inquirer: ['The groom'] } };
        assert.equal(validateInquiry(validInput({ inquirer: 'The groom' }), edited).ok, true);
        assert.equal(validateInquiry(validInput({ inquirer: 'The bride or couple' }), edited).ok, false);
    });

    it('caps the length of every text answer', () => {
        for (const field of FIELDS.filter((candidate) => ['text', 'textarea', 'tel'].includes(candidate.kind))) {
            const tooLong = 'a'.repeat(field.maxLength + 1);
            const value = field.name === 'phone' ? '5'.repeat(field.maxLength + 1) : tooLong;
            assert.equal(errorsFor(validInput({ [field.name]: value }))[field.name], rules.messages.tooLong, field.name);
        }
        const longEmail = `${'a'.repeat(250)}@example.com`;
        assert.equal(errorsFor(validInput({ email: longEmail })).email, rules.messages.tooLong);
        assert.equal(errorsFor(validInput({ anythingElse: 'a'.repeat(getField('anythingElse').maxLength) })).anythingElse, undefined);
    });

    it('ignores values that are not text', () => {
        const errors = errorsFor(validInput({ firstName: 42, lastName: { name: 'Smith' }, email: ['a@b.co'] }));
        assert.equal(errors.firstName, rules.messages.firstName);
        assert.equal(errors.lastName, rules.messages.lastName);
        assert.equal(errors.email, rules.messages.emailRequired);
    });

    it('strips control characters from answers', () => {
        const result = validateInquiry(
            validInput({
                firstName: 'Sa\u0000rah‮',
                location: 'Athens,\nGA',
                anythingElse: 'Line one\r\nLine two\u0007\n\n\n\nLine three',
            }),
            rules,
        );
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.data.firstName, 'Sarah');
        assert.equal(result.data.location, 'Athens, GA');
        assert.equal(result.data.anythingElse, 'Line one\nLine two\n\nLine three');
    });
});

describe('isValidEmail', () => {
    it('accepts ordinary addresses', () => {
        for (const email of ['name@example.com', 'first.last+tag@mail.co.uk', "o'brien@example.org", 'x@sub.example.com']) {
            assert.equal(isValidEmail(email), true, email);
        }
    });

    it('rejects addresses Resend could not use as a reply-to', () => {
        for (const email of ['bad@example', 'two..dots@example.com', '.lead@example.com', 'trail.@example.com', 'x@-bad.com', 'sp ace@example.com', 'a<b@example.com', 'x@example.c', 'x@example.com.']) {
            assert.equal(isValidEmail(email), false, email);
        }
    });
});

describe('cleanText', () => {
    it('keeps emoji and accented letters', () => {
        assert.equal(cleanText('Zoë 👰‍♀️'), 'Zoë 👰‍♀️');
    });

    it('returns an empty string for anything that is not a string', () => {
        assert.equal(cleanText(undefined), '');
        assert.equal(cleanText(null), '');
        assert.equal(cleanText(12), '');
    });
});

describe('inquiryInputFromForm', () => {
    it('reads a plain form post the same way as the enhanced form', () => {
        const params = new URLSearchParams();
        const input = validInput({ celebrating: undefined, dateNotSet: undefined });
        for (const [name, value] of Object.entries(input)) {
            if (typeof value === 'string') params.append(name, value);
        }
        params.append('celebrating', 'bachelorette');
        params.append('celebrating', 'celebration');
        params.append('dateNotSet', 'yes');
        params.append('website', 'ignored');

        const parsed = inquiryInputFromForm(params);
        assert.deepEqual(parsed.celebrating, ['bachelorette', 'celebration']);
        assert.equal(parsed.dateNotSet, 'yes');
        assert.equal('website' in parsed, false);

        const result = validateInquiry(parsed, rules);
        assert.equal(result.ok, true);
        assert.equal(result.ok && result.data.dateNotSet, true);
    });
});
