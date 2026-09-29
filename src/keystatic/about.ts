import { fields, singleton } from '@keystatic/core';
import { EMPTY_ITEM_LABEL, photoField, seoFields, textItemLabel } from './fields';

const eyebrowField = () =>
    fields.text({
        label: 'Small heading above the headline',
        description: 'Shown in capital letters automatically. Type it normally.',
        validation: { length: { min: 1, max: 40 } },
    });

const paragraphsField = (label: string, description: string) =>
    fields.array(
        fields.text({ label: 'Paragraph', multiline: true, validation: { length: { min: 1, max: 800 } } }),
        {
            label,
            description,
            itemLabel: (props) => textItemLabel(props.value),
            validation: { length: { min: 1, max: 4 } },
        },
    );

// The About page, top to bottom. The layout is fixed; every word and photo is editable here.
export const about = singleton({
    label: 'About page',
    path: 'src/content/about',
    format: { data: 'json' },
    schema: {
        seo: seoFields(),
        hero: fields.object(
            {
                eyebrow: eyebrowField(),
                title: fields.text({
                    label: 'Headline',
                    description: 'The main heading of the page.',
                    validation: { length: { min: 1, max: 80 } },
                }),
                subhead: fields.text({
                    label: 'Text under the headline',
                    multiline: true,
                    validation: { length: { min: 1, max: 200 } },
                }),
                photo: photoField({
                    label: 'Photo (tall 4:5 crop, shown on the right)',
                    folder: 'about',
                    defaultVertical: 'lower',
                }),
            },
            { label: 'Top of the page' },
        ),
        story: fields.object(
            {
                title: fields.text({ label: 'Heading', validation: { length: { min: 1, max: 80 } } }),
                paragraphs: paragraphsField('Your story', 'One to four paragraphs, in your own words. Drag to reorder.'),
                signature: fields.text({
                    label: 'Sign-off',
                    description: 'Shown in handwriting under your story.',
                    validation: { length: { min: 1, max: 30 } },
                }),
            },
            { label: 'How it started' },
        ),
        approach: fields.object(
            {
                eyebrow: eyebrowField(),
                title: fields.text({ label: 'Headline', validation: { length: { min: 1, max: 80 } } }),
                paragraphs: paragraphsField('Paragraphs', 'One to four paragraphs. Drag to reorder.'),
                photo: photoField({
                    label: 'Photo (tall 4:5 crop, shown on the left)',
                    folder: 'about',
                    defaultVertical: 'lower',
                }),
            },
            { label: 'My approach' },
        ),
        expect: fields.object(
            {
                title: fields.text({ label: 'Heading', validation: { length: { min: 1, max: 60 } } }),
                items: fields.array(
                    fields.object({
                        title: fields.text({ label: 'Short title', validation: { length: { min: 1, max: 40 } } }),
                        body: fields.text({
                            label: 'Text',
                            description: 'One short sentence.',
                            multiline: true,
                            validation: { length: { min: 1, max: 140 } },
                        }),
                    }),
                    {
                        label: 'Columns',
                        description: 'Exactly three, shown side by side (stacked on phones). Drag to reorder.',
                        itemLabel: (props) =>
                            props.fields.title.value.trim() && props.fields.body.value.trim() ? props.fields.title.value : EMPTY_ITEM_LABEL,
                        validation: { length: { min: 3, max: 3 } },
                    },
                ),
            },
            { label: 'What you can expect' },
        ),
        kindWords: fields.object(
            {
                title: fields.text({ label: 'Heading', validation: { length: { min: 1, max: 60 } } }),
                testimonials: fields.array(
                    fields.object({
                        quote: fields.text({
                            label: 'Quote',
                            description:
                                "Your client's exact words. Paste them just as they were written, without fixing spelling, capitals or punctuation. Leave out quotation marks; the page adds a decorative one.",
                            multiline: true,
                            validation: { length: { min: 1, max: 1500 } },
                        }),
                        name: fields.text({
                            label: "Client's name",
                            description: 'Shown under the quote. Only use a full name if your client is happy to be named.',
                            validation: { length: { min: 1, max: 60 } },
                        }),
                    }),
                    {
                        label: 'Quotes',
                        description:
                            "Exactly two, shown side by side (stacked on phones). These are your clients' exact words, so never edit them. Drag to reorder.",
                        itemLabel: (props) =>
                            props.fields.name.value.trim() && props.fields.quote.value.trim() ? props.fields.name.value : EMPTY_ITEM_LABEL,
                        validation: { length: { min: 2, max: 2 } },
                    },
                ),
                readMoreLabel: fields.text({
                    label: 'Button that opens a long quote',
                    description: 'Phones only: quotes longer than a few lines are shortened, with this button to show the rest.',
                    validation: { length: { min: 1, max: 20 } },
                }),
                readLessLabel: fields.text({
                    label: 'Button that shortens it again',
                    validation: { length: { min: 1, max: 20 } },
                }),
            },
            { label: 'Kind words' },
        ),
        closing: fields.object(
            {
                title: fields.text({ label: 'Headline', validation: { length: { min: 1, max: 80 } } }),
                body: fields.text({
                    label: 'Text under the headline',
                    multiline: true,
                    validation: { length: { min: 1, max: 200 } },
                }),
                buttonLabel: fields.text({
                    label: 'Button text',
                    description: 'This button goes to the Inquire page.',
                    validation: { length: { min: 1, max: 30 } },
                }),
            },
            { label: 'Closing invitation (bottom of the page)' },
        ),
    },
});
