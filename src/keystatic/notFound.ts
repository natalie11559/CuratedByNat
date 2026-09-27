import { singleton } from '@keystatic/core';

// Placeholder; replaced by the agent that builds this page.
export const notFound = singleton({
    label: 'Page not found (404)',
    path: 'src/content/not-found',
    format: { data: 'json' },
    schema: {},
});
