import { defineMiddleware } from 'astro:middleware';

// Static pages get their security headers from public/_headers. Responses the Worker builds on
// request (the inquiry API and the Keystatic editor) get the same set here.
const SECURITY_HEADERS: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000',
};

function isEditorPath(pathname: string): boolean {
    return pathname === '/keystatic' || pathname.startsWith('/keystatic/');
}

export const onRequest = defineMiddleware(async (context, next) => {
    const response = await next();
    if (context.isPrerendered) {
        return response;
    }

    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        headers.set(name, value);
    }

    // Keystatic's editor page is served without <html lang>, a <title> or a robots tag. Wrap it in a
    // proper document shell so it is accessible and never shows up in search results.
    if (isEditorPath(context.url.pathname) && response.headers.get('content-type')?.includes('text/html')) {
        const editorMarkup = (await response.text()).replace(/^\s*<!DOCTYPE html>/i, '');
        const html =
            '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<meta name="robots" content="noindex, nofollow">' +
            '<title>Site editor | Curated by Nat</title></head>' +
            `<body>${editorMarkup}</body></html>`;
        headers.delete('content-length');
        headers.set('X-Robots-Tag', 'noindex, nofollow');
        return new Response(html, { status: response.status, headers });
    }

    // Copy into a new Response: headers on some responses (for example redirects) are read-only.
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
