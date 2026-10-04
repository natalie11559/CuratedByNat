import { fields, singleton } from '@keystatic/core';
import { decorativePhotoField } from './fields';

// Things that appear on every page: menu, social links, footer, and the closing banner slideshow.
export const site = singleton({
    label: 'Menu, footer and social links',
    path: 'src/content/site',
    format: { data: 'json' },
    schema: {
        navigation: fields.object(
            {
                home: fields.text({ label: 'Home link', validation: { length: { min: 1, max: 20 } } }),
                about: fields.text({ label: 'About link', validation: { length: { min: 1, max: 20 } } }),
                services: fields.text({ label: 'Services link', validation: { length: { min: 1, max: 20 } } }),
                inquire: fields.text({ label: 'Inquire link', validation: { length: { min: 1, max: 20 } } }),
                mobileButton: fields.text({
                    label: 'Button in the phone menu',
                    validation: { length: { min: 1, max: 30 } },
                }),
            },
            { label: 'Menu' },
        ),
        social: fields.object(
            {
                instagramUrl: fields.url({ label: 'Instagram profile link', validation: { isRequired: true } }),
                instagramHandle: fields.text({
                    label: 'Instagram handle',
                    description: 'Shown in the footer, the phone menu and under the Follow along button on Home. Type it in lowercase. Example: @curated.bynat',
                    validation: { length: { min: 1 } },
                }),
                tiktokUrl: fields.url({ label: 'TikTok profile link', validation: { isRequired: true } }),
                tiktokHandle: fields.text({ label: 'TikTok handle', validation: { length: { min: 1 } } }),
            },
            { label: 'Social links' },
        ),
        footer: fields.object(
            {
                tagline: fields.text({ label: 'Tagline', validation: { length: { min: 1, max: 60 } } }),
                locationLine: fields.text({ label: 'Location line', multiline: true, validation: { length: { min: 1, max: 160 } } }),
                buttonLabel: fields.text({ label: 'Button text', validation: { length: { min: 1, max: 30 } } }),
                legal: fields.text({ label: 'Copyright line', validation: { length: { min: 1, max: 60 } } }),
            },
            { label: 'Footer' },
        ),
        closingPhotos: fields.array(
            fields.object(
                {
                    name: fields.text({
                        label: 'Short name (only you see this)',
                        description: 'Helps you recognise the photo in this list, for example "Bride on the porch".',
                    }),
                    ...decorativePhotoField({ label: 'Photo', folder: 'site' }).fields,
                },
                { label: 'Slideshow photo' },
            ),
            {
                label: 'Closing banner slideshow photos',
                description:
                    'The photos that slide slowly behind "Inquire now" at the bottom of Home and Services. Use 4 to 12 photos. Drag to reorder. These are the backup: with "Instagram feed (automatic photos)" switched on, your latest Instagram posts slide here instead. Text sits on top, so busy or very bright photos are harder to read over.',
                itemLabel: (props) =>
                    props.fields.image.value ? props.fields.name.value.trim() || 'Slideshow photo' : '⚠ Needs a photo',
                validation: { length: { min: 4, max: 12 } },
            },
        ),
    },
});
