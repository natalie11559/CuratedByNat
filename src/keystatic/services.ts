import { fields, singleton } from '@keystatic/core';
import { photoField } from './fields';

// The four services. Each appears as a card on Home and as a full section on Services.
export const services = singleton({
    label: 'The four services',
    path: 'src/content/services',
    format: { data: 'json' },
    schema: {
        listTitle: fields.text({
            label: 'Heading above each "what you receive" list',
            validation: { length: { min: 1 } },
        }),
        items: fields.array(
            fields.object({
                name: fields.text({
                    label: 'Service name',
                    description: 'The card title on Home and the small heading above the section on Services. Example: Weddings.',
                    validation: { length: { min: 1, max: 40 } },
                }),
                anchor: fields.select({
                    label: 'Link name (leave as is)',
                    description: 'Buttons on the Home page jump to this service using this name. Each service needs a different one.',
                    options: [
                        { label: 'weddings', value: 'weddings' },
                        { label: 'bachelorette', value: 'bachelorette' },
                        { label: 'bridal-events', value: 'bridal-events' },
                        { label: 'celebrations', value: 'celebrations' },
                    ],
                    defaultValue: 'weddings',
                }),
                cardText: fields.text({
                    label: 'Card text on the Home page',
                    description: 'One short line.',
                    multiline: true,
                    validation: { length: { min: 1, max: 120 } },
                }),
                cardPhoto: photoField({ label: 'Card photo on the Home page (wide 3:2 crop)', folder: 'services' }),
                title: fields.text({
                    label: 'Headline on the Services page',
                    validation: { length: { min: 1, max: 90 } },
                }),
                description: fields.text({
                    label: 'Description on the Services page',
                    multiline: true,
                    validation: { length: { min: 1 } },
                }),
                receives: fields.array(fields.text({ label: 'Item', multiline: true, validation: { length: { min: 1 } } }), {
                    label: 'What you receive',
                    itemLabel: (props) => props.value || 'New item',
                }),
                buttonLabel: fields.text({
                    label: 'Button text',
                    description: 'The button always goes to the inquiry form.',
                    validation: { length: { min: 1, max: 40 } },
                }),
                sectionPhoto: photoField({ label: 'Photo on the Services page (tall 4:5 crop)', folder: 'services' }),
            }),
            {
                label: 'Services',
                description: 'Keep exactly four. Drag to reorder.',
                itemLabel: (props) => props.fields.name.value || 'New service',
                validation: { length: { min: 4, max: 4 } },
            },
        ),
    },
});
