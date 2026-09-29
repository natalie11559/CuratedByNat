import { fields, singleton } from '@keystatic/core';
import { seoFields } from './fields';

// The page visitors see when a link is broken or mistyped.
export const notFound = singleton({
    label: 'Page not found (404)',
    path: 'src/content/not-found',
    format: { data: 'json' },
    schema: {
        seo: seoFields(),
        eyebrow: fields.text({
            label: 'Small heading above the headline',
            description: 'Shows in capital letters. Type it normally.',
            validation: { length: { min: 1, max: 40 } },
        }),
        headline: fields.text({
            label: 'Headline',
            validation: { length: { min: 1, max: 80 } },
        }),
        body: fields.text({
            label: 'Text under the headline',
            description: 'One short sentence.',
            multiline: true,
            validation: { length: { min: 1, max: 200 } },
        }),
        homeButtonLabel: fields.text({
            label: 'First button text',
            description: 'This button goes to the Home page.',
            validation: { length: { min: 1, max: 30 } },
        }),
        inquireButtonLabel: fields.text({
            label: 'Second button text',
            description: 'This button goes to the Inquire page.',
            validation: { length: { min: 1, max: 30 } },
        }),
    },
});
