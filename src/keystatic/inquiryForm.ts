import { fields, singleton } from '@keystatic/core';
import { textItemLabel } from './fields';

// Every word in the inquiry form. The questions themselves (their order, which are required,
// what kind of answer they take) are fixed in code so the form keeps working for Nat.

function question(description?: string) {
    return fields.text({
        label: 'Question',
        description,
        validation: { length: { min: 1, max: 140 } },
    });
}

function emptyMessage(description = 'Shown in red under the question if someone leaves it empty.') {
    return fields.text({
        label: 'Message if it is left empty',
        description,
        validation: { length: { min: 1, max: 160 } },
    });
}

function hint(example: string) {
    return fields.text({
        label: 'Hint inside the box',
        description: `Light grey example text shown until they start typing, like "${example}". Leave empty for none.`,
        validation: { length: { max: 80 } },
    });
}

function choiceList(label: string) {
    return fields.array(fields.text({ label: 'Choice', validation: { length: { min: 1, max: 120 } } }), {
        label,
        description: 'Add, remove, reword or drag to reorder the choices. Keep at least one.',
        itemLabel: (props) => textItemLabel(props.value),
        validation: { length: { min: 1, max: 15 } },
    });
}

function fixedChoice(label: string, description?: string) {
    return fields.text({ label, description, validation: { length: { min: 1, max: 120 } } });
}

function celebrationChoice(label: string) {
    return fields.object(
        {
            label: fixedChoice('Choice'),
            detail: fields.text({
                label: 'Small second line (optional)',
                description: 'Examples in smaller grey text under the choice. Leave empty for none.',
                validation: { length: { max: 120 } },
            }),
        },
        { label },
    );
}

export const inquiryForm = singleton({
    label: 'Inquiry form',
    path: 'src/content/inquiry-form',
    format: { data: 'json' },
    schema: {
        intro: fields.text({
            label: 'Line above the form',
            validation: { length: { min: 1, max: 140 } },
        }),
        optionalMarker: fields.text({
            label: 'Word shown after optional questions',
            description: 'Appears in grey after the question, like "Instagram handle (optional)".',
            validation: { length: { min: 1, max: 30 } },
        }),
        selectPlaceholder: fields.text({
            label: 'Dropdown text before a choice is picked',
            validation: { length: { min: 1, max: 40 } },
        }),
        fields: fields.object(
            {
                firstName: fields.object({ label: question(), error: emptyMessage() }, { label: '1. First name' }),
                lastName: fields.object({ label: question(), error: emptyMessage() }, { label: '2. Last name' }),
                email: fields.object(
                    {
                        label: question(),
                        error: emptyMessage(),
                        formatError: fields.text({
                            label: 'Message if the email does not look right',
                            validation: { length: { min: 1, max: 160 } },
                        }),
                    },
                    { label: '3. Email' },
                ),
                phone: fields.object(
                    {
                        label: question(),
                        error: emptyMessage(),
                        formatError: fields.text({
                            label: 'Message if the number is too short',
                            description: 'Shown when the number has fewer than 7 digits.',
                            validation: { length: { min: 1, max: 160 } },
                        }),
                    },
                    { label: '4. Phone' },
                ),
                instagram: fields.object(
                    { label: question('This question is optional.'), placeholder: hint('@yourhandle') },
                    { label: '5. Instagram handle' },
                ),
                inquirer: fields.object(
                    {
                        label: question(),
                        options: choiceList('Choices'),
                        error: emptyMessage('Shown in red under the question if nothing is picked.'),
                    },
                    { label: "6. Who's inquiring?" },
                ),
                celebrating: fields.object(
                    {
                        label: question(),
                        options: fields.object(
                            {
                                wedding: celebrationChoice('Wedding'),
                                bachelorette: celebrationChoice('Bachelorette weekend'),
                                bridalEvent: celebrationChoice('Bridal event'),
                                celebration: celebrationChoice('Celebration'),
                                notSure: celebrationChoice('Not sure yet'),
                            },
                            {
                                label: 'Choices',
                                description:
                                    'These five choices are fixed because the form uses them (Bachelorette weekend and Celebration show the End date question). You can reword each one.',
                            },
                        ),
                        error: emptyMessage('Shown in red under the choices if none is ticked.'),
                    },
                    { label: '7. What are you celebrating?' },
                ),
                eventDate: fields.object(
                    {
                        label: question(),
                        error: emptyMessage('Shown if there is no date and "My date isn\'t set yet" is not ticked.'),
                    },
                    { label: '8. Event date' },
                ),
                dateNotSet: fields.object(
                    { label: fixedChoice('Tick box text', 'Ticking it greys out the event date and makes it optional.') },
                    { label: "9. My date isn't set yet" },
                ),
                endDate: fields.object(
                    {
                        label: question('Only appears when Bachelorette weekend or Celebration is ticked. Optional.'),
                        orderError: fields.text({
                            label: 'Message if the end date is before the event date',
                            validation: { length: { min: 1, max: 160 } },
                        }),
                    },
                    { label: '10. End date' },
                ),
                inGeorgia: fields.object(
                    {
                        label: question(),
                        options: fields.object(
                            {
                                yes: fixedChoice('Choice: yes'),
                                destination: fixedChoice('Choice: destination', 'Picking this one shows the destination note below.'),
                                notSure: fixedChoice('Choice: not sure'),
                            },
                            { label: 'Choices', description: 'These three choices are fixed. You can reword each one.' },
                        ),
                        destinationNote: fields.text({
                            label: 'Destination note',
                            description: 'Shown under the question when someone picks the destination choice.',
                            multiline: true,
                            validation: { length: { min: 1, max: 200 } },
                        }),
                        error: emptyMessage('Shown in red under the question if nothing is picked.'),
                    },
                    { label: '11. Is your event in Georgia?' },
                ),
                location: fields.object(
                    { label: question(), placeholder: hint('City, venue name if you have one'), error: emptyMessage() },
                    { label: '12. City and venue' },
                ),
                photoVideo: fields.object(
                    { label: question('This question is optional.'), options: choiceList('Choices') },
                    { label: '13. Photographer or videographer' },
                ),
                excitedAbout: fields.object(
                    { label: question('This question is optional.') },
                    { label: '14. Most excited about' },
                ),
                anythingElse: fields.object(
                    { label: question('This question is optional.') },
                    { label: '15. Anything else' },
                ),
                foundVia: fields.object(
                    { label: question('This question is optional.'), options: choiceList('Choices') },
                    { label: '16. How did you find me?' },
                ),
            },
            { label: 'Questions' },
        ),
        messages: fields.object(
            {
                errorSummary: fields.text({
                    label: 'Message at the top when something is missing',
                    validation: { length: { min: 1, max: 160 } },
                }),
                invalidDate: fields.text({
                    label: 'Message if a date does not look right',
                    validation: { length: { min: 1, max: 160 } },
                }),
                invalidOption: fields.text({
                    label: 'Message if a dropdown choice no longer exists',
                    description: 'Rare. Shown if a choice was removed while someone had the form open.',
                    validation: { length: { min: 1, max: 160 } },
                }),
                tooLong: fields.text({
                    label: 'Message if an answer is too long',
                    validation: { length: { min: 1, max: 160 } },
                }),
                sendFailure: fields.text({
                    label: 'Message if the inquiry could not be sent',
                    description: 'Shown at the top of the form if something goes wrong. What they typed is kept.',
                    multiline: true,
                    validation: { length: { min: 1, max: 240 } },
                }),
                noJavaScript: fields.text({
                    label: 'Note for browsers with JavaScript turned off',
                    description: 'The spam check needs JavaScript, so the form cannot send without it.',
                    multiline: true,
                    validation: { length: { min: 1, max: 240 } },
                }),
            },
            { label: 'Other messages' },
        ),
        submit: fields.object(
            {
                label: fields.text({ label: 'Button text', validation: { length: { min: 1, max: 40 } } }),
                loadingLabel: fields.text({
                    label: 'Button text while sending',
                    validation: { length: { min: 1, max: 40 } },
                }),
            },
            { label: 'Send button' },
        ),
        success: fields.object(
            {
                heading: fields.text({ label: 'Headline', validation: { length: { min: 1, max: 60 } } }),
                body: fields.text({ label: 'Text', multiline: true, validation: { length: { min: 1, max: 300 } } }),
                buttonLabel: fields.text({
                    label: 'Button text',
                    description: 'The button opens your Instagram profile (set in "Menu, footer and social links").',
                    validation: { length: { min: 1, max: 30 } },
                }),
                signature: fields.text({
                    label: 'Signature',
                    description: 'Shown in the handwritten script font.',
                    validation: { length: { min: 1, max: 30 } },
                }),
            },
            {
                label: 'After sending',
                description: 'Replaces the form once an inquiry is sent. "What happens next" stays below it.',
            },
        ),
    },
});
