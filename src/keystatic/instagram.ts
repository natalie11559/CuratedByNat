import { singleton } from '@keystatic/core';

// Placeholder; replaced by the agent that builds this page.
export const instagram = singleton({
    label: 'Instagram photos',
    path: 'src/content/instagram',
    format: { data: 'json' },
    schema: {},
});
