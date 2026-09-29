import { fields, singleton } from '@keystatic/core';
import { EMPTY_ITEM_LABEL, seoFields, textItemLabel } from './fields';

// The Services page around the four service sections. The services themselves (headlines,
// descriptions, "What you receive" lists and photos) are edited under "The four services".
export const servicesPage = singleton({
    label: 'Services page',
    path: 'src/content/services-page',
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
                title: fields.text({
                    label: 'Headline',
                    description: 'The main heading of the page.',
                    validation: { length: { min: 1, max: 80 } },
                }),
                body: fields.text({
                    label: 'Text under the headline',
                    multiline: true,
                    validation: { length: { min: 1, max: 500 } },
                }),
            },
            {
                label: 'Top of the page',
                description: 'The four services follow right after this, in the order set under "The four services".',
            },
        ),
        extras: fields.object(
            {
                title: fields.text({ label: 'Heading', validation: { length: { min: 1, max: 60 } } }),
                body: fields.text({
                    label: 'Text under the heading',
                    multiline: true,
                    validation: { length: { min: 1, max: 300 } },
                }),
                items: fields.array(
                    fields.text({ label: 'Extra', validation: { length: { min: 1, max: 40 } } }),
                    {
                        label: 'Extras list',
                        description: 'Each one shows in its own small box. Keep them short, and leave prices out: they come with your packages. Drag to reorder.',
                        itemLabel: (props) => textItemLabel(props.value),
                        validation: { length: { min: 1, max: 8 } },
                    },
                ),
            },
            { label: 'Extras', description: 'Shown below the four services.' },
        ),
        howItWorks: fields.object(
            {
                title: fields.text({
                    label: 'Heading',
                    description: 'The "How it works" button on the Home page jumps to this section.',
                    validation: { length: { min: 1, max: 60 } },
                }),
                steps: fields.array(
                    fields.object({
                        title: fields.text({
                            label: 'Step name',
                            description: 'A few words, shown in large type. Example: Inquire.',
                            validation: { length: { min: 1, max: 30 } },
                        }),
                        body: fields.text({
                            label: 'Step text',
                            description: 'One or two short sentences.',
                            multiline: true,
                            validation: { length: { min: 1, max: 160 } },
                        }),
                    }),
                    {
                        label: 'Steps',
                        description: 'Exactly five, numbered automatically. Drag to reorder.',
                        itemLabel: (props) =>
                            props.fields.title.value.trim() && props.fields.body.value.trim() ? props.fields.title.value : EMPTY_ITEM_LABEL,
                        validation: { length: { min: 5, max: 5 } },
                    },
                ),
            },
            { label: 'How it works' },
        ),
        testimonial: fields.object(
            {
                quote: fields.text({
                    label: 'Quote',
                    description:
                        "Your client's exact words. Paste them just as they were written and don't edit them, not even the spelling or punctuation. Leave out the quotation marks: the site adds a large one above the quote.",
                    multiline: true,
                    validation: { length: { min: 1, max: 1200 } },
                }),
                name: fields.text({
                    label: 'Client name',
                    description: 'Shown in capital letters automatically. Type it normally.',
                    validation: { length: { min: 1, max: 60 } },
                }),
            },
            { label: 'Client quote', description: 'Shown right after How it works.' },
        ),
        goodToKnow: fields.object(
            {
                label: fields.text({
                    label: 'Small heading',
                    description: 'Shown in capital letters automatically. Type it normally.',
                    validation: { length: { min: 1, max: 40 } },
                }),
                items: fields.array(
                    fields.text({ label: 'Line', multiline: true, validation: { length: { min: 1, max: 200 } } }),
                    {
                        label: 'Lines',
                        description: 'Exactly three short lines, shown side by side on a computer and stacked on a phone.',
                        itemLabel: (props) => textItemLabel(props.value),
                        validation: { length: { min: 3, max: 3 } },
                    },
                ),
            },
            { label: 'Good to know' },
        ),
        closing: fields.object(
            {
                title: fields.text({ label: 'Headline', validation: { length: { min: 1, max: 60 } } }),
                body: fields.text({
                    label: 'Text under the headline',
                    multiline: true,
                    validation: { length: { min: 1, max: 160 } },
                }),
                buttonLabel: fields.text({
                    label: 'Button text',
                    description: 'This button goes to the inquiry form.',
                    validation: { length: { min: 1, max: 30 } },
                }),
            },
            {
                label: 'Closing banner at the bottom',
                description: 'The photos sliding behind it are changed under "Menu, footer and social links".',
            },
        ),
    },
});
