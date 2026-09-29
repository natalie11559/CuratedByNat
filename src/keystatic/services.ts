import { fields, singleton } from '@keystatic/core';
import { photoField, photoSlotWarning, textItemLabel } from './fields';

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
                    description:
                        'The card title on Home and the small heading above the section on Services. Shown in capital letters automatically, so type it normally. Example: Weddings.',
                    validation: { length: { min: 1, max: 40 } },
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
                    description:
                        "The list in this service's section on the Services page, under the heading set at the top of this page. One short sentence per item. Drag to reorder.",
                    itemLabel: (props) => textItemLabel(props.value),
                }),
                buttonLabel: fields.text({
                    label: 'Button text',
                    description: 'The button always goes to the inquiry form.',
                    validation: { length: { min: 1, max: 40 } },
                }),
                sectionPhoto: photoField({ label: 'Photo on the Services page (tall 4:5 crop)', folder: 'services' }),
                anchor: fields.select({
                    label: 'Link name (leave as is)',
                    description: 'Technical: the Home page card for this service jumps here using this name. Leave it as it is, and keep each service on a different one.',
                    options: [
                        { label: 'weddings', value: 'weddings' },
                        { label: 'bachelorette', value: 'bachelorette' },
                        { label: 'bridal-events', value: 'bridal-events' },
                        { label: 'celebrations', value: 'celebrations' },
                    ],
                    defaultValue: 'weddings',
                }),
            }),
            {
                label: 'Services',
                description: 'Keep exactly four. Drag to reorder.',
                itemLabel: (props) => {
                    const { name, cardText, title, description, buttonLabel, cardPhoto, sectionPhoto } = props.fields;
                    const label = name.value.trim() || 'New service';
                    const photoWarning = photoSlotWarning(cardPhoto) ?? photoSlotWarning(sectionPhoto);
                    if (photoWarning) return `${label} ${photoWarning}`;
                    const hasEmptyText = [name, cardText, title, description, buttonLabel].some((field) => !field.value.trim());
                    return hasEmptyText ? `${label} ⚠ Something is empty` : label;
                },
                validation: { length: { min: 4, max: 4 } },
            },
        ),
    },
});
