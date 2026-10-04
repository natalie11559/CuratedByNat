import { defineMiddleware } from 'astro:middleware';
import { authorizeStudioRequest, isStudioPath, studioHeaders, type StudioEnv } from './lib/studio/gate';

// Static pages get their security headers from public/_headers. Responses the Worker builds on
// request (the inquiry API, the Keystatic editor and Studio) get the same set here.
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

async function studioEnv(): Promise<StudioEnv> {
    try {
        const { env } = await import('cloudflare:workers');
        return env as unknown as StudioEnv;
    } catch {
        // Not on Cloudflare's runtime (for example the local editor mode): nothing is configured, so Studio stays closed.
        return {};
    }
}

/**
 * Studio is private. Cloudflare Access already asks for a sign-in before a request reaches the Worker; this
 * checks the token Access issues a second time, so a mistake in Access can never expose client data. Anything
 * that fails the check gets an empty 404, which does not even admit that a Studio exists.
 */
async function guardStudio(context: Parameters<Parameters<typeof defineMiddleware>[0]>[0], next: () => Promise<Response>) {
    const isDevBuild = import.meta.env.DEV;
    const headers = { ...SECURITY_HEADERS, ...studioHeaders({ isDevBuild }) };

    const authorization = await authorizeStudioRequest({
        headers: context.request.headers,
        hostname: context.url.hostname,
        isDevBuild,
        env: await studioEnv(),
    });

    if (!authorization.ok) {
        // A missing token is just a stranger knocking; anything else suggests Access is set up wrongly.
        if (authorization.reason !== 'missing-token') console.warn(`[studio] Refused a request: ${authorization.reason}`);
        return new Response('Not found', { status: 404, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    context.locals.studioUser = { email: authorization.email, via: authorization.via };
    const response = await next();
    const merged = new Headers(response.headers);
    // A PDF or picture is not a page and can't run scripts, but a strict page policy can stop the browser's own
    // PDF viewer from opening it. Everything else keeps the strict policy.
    const isDocument = /^(application\/pdf|image\/(jpeg|png|heic))\b/i.test(response.headers.get('content-type') ?? '');
    for (const [name, value] of Object.entries(headers)) {
        if (isDocument && name === 'Content-Security-Policy') continue;
        merged.set(name, value);
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
}

export const onRequest = defineMiddleware(async (context, next) => {
    if (isStudioPath(context.url.pathname)) {
        return guardStudio(context, next);
    }

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
