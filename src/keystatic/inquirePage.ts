import { fields, singleton } from '@keystatic/core';
import { seoFields, textItemLabel } from './fields';

// The Inquire page around the form. The form's own words are under "Inquiry form".
export const inquirePage = singleton({
    label: 'Inquire page',
    path: 'src/content/inquire-page',
    format: { data: 'json' },
    schema: {
        seo: seoFields(),
        hero: fields.object(
            {
                eyebrow: fields.text({
                    label: 'Small heading above the headline',
                    description: 'Shown in capital letters automatically. Type it normally.',
                    validation: { length: { min: 1, max: 40 } },
                }),
                title: fields.text({ label: 'Headline', validation: { length: { min: 1, max: 80 } } }),
                body: fields.text({ label: 'Text', multiline: true, validation: { length: { min: 1, max: 400 } } }),
                note: fields.text({
                    label: 'Small note',
                    description: 'Shown in italics under a thin line.',
                    multiline: true,
                    validation: { length: { min: 1, max: 200 } },
                }),
            },
            { label: 'Top of the page' },
        ),
        nextSteps: fields.object(
            {
                title: fields.text({ label: 'Heading', validation: { length: { min: 1, max: 60 } } }),
                steps: fields.array(
                    fields.text({ label: 'Step', multiline: true, validation: { length: { min: 1, max: 160 } } }),
                    {
                        label: 'Steps',
                        description: 'Exactly three, numbered automatically. Drag to reorder.',
                        itemLabel: (props) => textItemLabel(props.value),
                        validation: { length: { min: 3, max: 3 } },
                    },
                ),
            },
            {
                label: 'What happens next',
                description: 'Shown below the form, and still shown after someone sends an inquiry.',
            },
        ),
        thanksPage: fields.object(
            {
                title: fields.text({
                    label: 'Browser tab title',
                    description: 'This page only appears if someone sends the form from a browser that could not show the thank-you message in place. Google does not list it.',
                    validation: { length: { min: 1, max: 70 } },
                }),
            },
            { label: 'Thank-you page' },
        ),
    },
});
