import { fields, singleton } from '@keystatic/core';
import { photoField, seoFields, textItemLabel } from './fields';

const eyebrowField = () =>
    fields.text({
        label: 'Small heading above the headline',
        description: 'Shown in capital letters automatically. Type it normally.',
        validation: { length: { min: 1, max: 60 } },
    });

const headlineField = () =>
    fields.text({
        label: 'Headline',
        validation: { length: { min: 1, max: 80 } },
    });

const buttonField = (destination: string) =>
    fields.text({
        label: 'Button text',
        description: `This button goes to ${destination}.`,
        validation: { length: { min: 1, max: 30 } },
    });

const paragraphsField = () =>
    fields.array(
        fields.text({ label: 'Paragraph', multiline: true, validation: { length: { min: 1, max: 600 } } }),
        {
            label: 'Text',
            description: 'One paragraph looks best here. Add a second only if you really need it.',
            itemLabel: (props) => textItemLabel(props.value),
            validation: { length: { min: 1, max: 3 } },
        },
    );

// The Home page, top to bottom. The layout is fixed; every word and photo is editable here.
// The four service cards come from "The four services" and the Instagram photos from
// "Instagram photos (Home page)". Button destinations are fixed in src/pages/index.astro.
export const home = singleton({
    label: 'Home page',
    path: 'src/content/home',
    format: { data: 'json' },
    schema: {
        seo: seoFields(),
        hero: fields.object(
            {
                eyebrow: eyebrowField(),
                titleStart: fields.text({
                    label: 'Headline, first line',
                    description: 'Shown in capital letters automatically. Example: Curated',
                    validation: { length: { min: 1, max: 20 } },
                }),
                titleScript: fields.text({
                    label: 'Headline, handwritten word',
                    description:
                        'Starts the second line in the pale pink handwritten font, exactly as you type it (keep it lowercase). Keep it to one short word, such as "by".',
                    validation: { length: { min: 1, max: 12 } },
                }),
                titleEnd: fields.text({
                    label: 'Headline, after the handwritten word',
                    description: 'Shown in capital letters automatically, right after the handwritten word. Example: Nat',
                    validation: { length: { min: 1, max: 20 } },
                }),
                buttonLabel: buttonField('the Inquire page'),
                photo: photoField({
                    label: 'Big photo behind the headline',
                    folder: 'home',
                    description:
                        'The headline sits in the middle of this photo on a soft dark shade. Photos without big bright white areas in the middle keep the words easiest to read. The two "Keep in view" choices in this box are for computers and tablets, where the photo is shown wide and short. Phones have their own choices in the next box.',
                    defaultVertical: 'upper',
                }),
                phoneFocus: fields.object(
                    {
                        focusVertical: fields.select({
                            label: 'Keep in view on phones (up and down)',
                            description: 'Phones show a tall, narrow slice of the same photo. Which part must stay visible?',
                            options: [
                                { label: 'Top', value: 'top' },
                                { label: 'Upper third (faces)', value: 'upper' },
                                { label: 'Middle', value: 'center' },
                                { label: 'Lower third', value: 'lower' },
                                { label: 'Bottom', value: 'bottom' },
                            ],
                            defaultValue: 'upper',
                        }),
                        focusHorizontal: fields.select({
                            label: 'Keep in view on phones (left and right)',
                            options: [
                                { label: 'Left', value: 'left' },
                                { label: 'Center', value: 'center' },
                                { label: 'Right', value: 'right' },
                            ],
                            defaultValue: 'center',
                        }),
                    },
                    {
                        label: 'Big photo on phones',
                        description: 'On computers the photo is cropped across the dress and bouquet; on phones it usually needs to show the face.',
                    },
                ),
            },
            { label: 'Top of the page (big photo and headline)' },
        ),
        intro: fields.object(
            {
                eyebrow: eyebrowField(),
                title: headlineField(),
                paragraphs: paragraphsField(),
                buttonLabel: buttonField('the About page'),
                photo: photoField({
                    label: 'Photo',
                    folder: 'home',
                    description: 'Shown as a tall 4:5 crop with a thin pink frame behind it.',
                    defaultVertical: 'upper',
                }),
            },
            { label: 'Introduction (photo left, text right)' },
        ),
        capturing: fields.object(
            {
                eyebrow: eyebrowField(),
                title: headlineField(),
                paragraphs: paragraphsField(),
                buttonLabel: buttonField('the "How it works" part of the Services page'),
                photo: photoField({
                    label: 'Photo',
                    folder: 'home',
                    description: 'Fills the right half of the screen on computers (wide 3:2 crop on phones).',
                    defaultVertical: 'lower',
                }),
            },
            { label: 'Capturing and curating (text left, photo right)' },
        ),
        servicesSection: fields.object(
            {
                eyebrow: eyebrowField(),
                title: headlineField(),
                buttonLabel: buttonField('the Services page'),
            },
            {
                label: 'Services',
                description: 'The heading and button around the four service cards. The cards themselves are edited under "The four services".',
            },
        ),
        closing: fields.object(
            {
                eyebrow: eyebrowField(),
                title: headlineField(),
                buttonLabel: buttonField('the Inquire page'),
            },
            {
                label: 'Closing banner (bottom of the page)',
                description:
                    'The photos sliding behind this banner are edited under "Menu, footer and social links", because the Services page shares them.',
            },
        ),
    },
});
