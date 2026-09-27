import type { SiteContent } from './content';

export const SITE_URL = 'https://curatedbynat.com';
export const SITE_NAME = 'Curated by Nat';

export function absoluteUrl(path: string): string {
    return new URL(path, SITE_URL).toString();
}

/**
 * LocalBusiness structured data. Only facts stated in the content document are used:
 * name, what the business does, Georgia base with destination work, the logo, and the two
 * social profiles. No address, phone, email, hours or prices are published.
 */
export function localBusinessJsonLd(site: SiteContent) {
    return {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        '@id': `${SITE_URL}/#business`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: site.footer.locationLine,
        slogan: site.footer.tagline,
        logo: absoluteUrl('/icon-512.png'),
        image: absoluteUrl('/og-image.jpg'),
        areaServed: { '@type': 'State', name: 'Georgia' },
        founder: { '@type': 'Person', name: 'Natalie' },
        sameAs: [site.social.instagramUrl, site.social.tiktokUrl].filter(Boolean),
    };
}
