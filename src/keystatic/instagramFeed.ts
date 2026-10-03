import { fields, singleton } from '@keystatic/core';

// Settings for the photos that come from Nat's Instagram account by themselves. The photos she picked by
// hand (Instagram photos, and the closing banner slideshow under "Menu, footer and social links") stay as
// the backup, and are used whenever the automatic photos are switched off or unavailable.
export const instagramFeed = singleton({
    label: 'Instagram feed (automatic photos)',
    path: 'src/content/instagram-feed-settings',
    format: { data: 'json' },
    schema: {
        homeSource: fields.select({
            label: 'Instagram section on Home',
            description: 'Where the four photos in "More of my work, over on Instagram" come from.',
            options: [
                { label: 'My latest Instagram posts (updates by itself)', value: 'latest' },
                { label: 'The photos I picked (Services and photos > Instagram photos)', value: 'picked' },
            ],
            defaultValue: 'latest',
        }),
        slideshowSource: fields.select({
            label: 'Slideshow behind "Inquire now"',
            description: 'Where the sliding photos at the bottom of Home and Services come from.',
            options: [
                { label: 'My latest Instagram posts (updates by itself)', value: 'latest' },
                { label: 'The photos I picked (Every page > Menu, footer and social links)', value: 'picked' },
            ],
            defaultValue: 'latest',
        }),
        slideshowCount: fields.integer({
            label: 'How many posts in the slideshow',
            description: 'Between 4 and 12.',
            defaultValue: 8,
            validation: { isRequired: true, min: 4, max: 12 },
        }),
        includeVideoCovers: fields.checkbox({
            label: 'Include Reel and video covers',
            description: 'Videos and Reels show their cover picture. Turn this off to show only photo posts.',
            defaultValue: true,
        }),
        hiddenPosts: fields.array(fields.url({ label: 'Link to the post', validation: { isRequired: true } }), {
            label: 'Hide a post',
            description:
                'Not every post belongs on the website. To keep one off, open it on Instagram, copy its link (the three dots, then Copy link) and paste it here.',
            itemLabel: (props) => props.value || '⚠ Paste the link to a post',
        }),
    },
});
