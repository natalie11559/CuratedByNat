import { fields, singleton } from '@keystatic/core';
import { photoField, photoSlotWarning } from './fields';

// The "See it in action" section on the Home page: text, a Follow along button and four photos.
// The button, the handle and every photo link to the Instagram profile link set under
// "Menu, footer and social links".
export const instagram = singleton({
    label: 'Instagram photos (Home page)',
    path: 'src/content/instagram',
    format: { data: 'json' },
    schema: {
        eyebrow: fields.text({
            label: 'Small heading above the headline',
            description: 'Shown in capital letters automatically. Type it normally.',
            validation: { length: { min: 1, max: 60 } },
        }),
        title: fields.text({
            label: 'Headline',
            validation: { length: { min: 1, max: 80 } },
        }),
        body: fields.text({
            label: 'Text under the headline',
            description: 'One or two short sentences.',
            multiline: true,
            validation: { length: { min: 1, max: 300 } },
        }),
        buttonLabel: fields.text({
            label: 'Button text',
            description: 'This button opens your Instagram profile in a new tab.',
            validation: { length: { min: 1, max: 30 } },
        }),
        tiles: fields.array(photoField({ label: 'Photo', folder: 'instagram' }), {
            label: 'Photos',
            description: 'Exactly four, shown side by side as tall 2:3 crops (two by two on phones). Each one opens your Instagram profile. Drag to reorder.',
            itemLabel: (props) => photoSlotWarning(props) ?? props.fields.alt.value,
            validation: { length: { min: 4, max: 4 } },
        }),
    },
});
