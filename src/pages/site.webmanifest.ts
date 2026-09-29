import type { APIRoute } from 'astro';
import { site } from '../lib/content';
import { SITE_NAME } from '../lib/seo';

// Built from the site settings, so the description follows the footer location line Nat edits.
const BRAND_BACKGROUND = '#F8F4EE';

export const GET: APIRoute = () => {
    const icons = [192, 512].flatMap((size) =>
        ['any', 'maskable'].map((purpose) => ({ src: `/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose })),
    );
    const manifest = {
        name: SITE_NAME,
        short_name: SITE_NAME,
        description: site.footer.locationLine,
        start_url: '/',
        scope: '/',
        display: 'browser',
        theme_color: BRAND_BACKGROUND,
        background_color: BRAND_BACKGROUND,
        icons,
    };
    return new Response(JSON.stringify(manifest, null, 4), {
        headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
    });
};
