// Creates leads for any website inquiry that has none: the one-time import of inquiries that arrived before
// Studio existed, and the "retry" button for any inquiry whose lead step failed.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { D1Database } from '../../../../lib/cloudflare';
import { forbidden, isSameOrigin, json } from '../../../../lib/studio/http';
import { redirectTo } from '../../../../lib/studio/server';
import { syncUnlinkedInquiries } from '../../../../lib/studio/leads';

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const db = (env as unknown as { DB?: D1Database }).DB;
    if (!db) return json(500, { ok: false, error: 'The database is not available.' });

    const result = await syncUnlinkedInquiries(db);
    // The "Try again" button on Home posts a plain form and goes back there; anything else gets the numbers.
    if ((request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
        return redirectTo('/studio', result.remaining > 0 ? { error: 'import-incomplete' } : { notice: 'imported' });
    }
    return json(200, { ok: true, ...result });
};
