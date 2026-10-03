// Brings back a file from Recently deleted.
import type { APIRoute } from 'astro';
import { restoreFile } from '../../../../../lib/studio/files';
import { forbidden, isSameOrigin, json } from '../../../../../lib/studio/http';
import { isId } from '../../../../../lib/studio/messages';
import { actorEmail, redirectTo, studioDb } from '../../../../../lib/studio/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals, params }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const id = params.id ?? '';
    if (!isId(id)) return json(404, { ok: false, error: 'Not found.' });
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });
    const result = await restoreFile(db, id, { actor: actorEmail(locals) });
    return result.ok ? redirectTo('/studio/deleted', { notice: 'restored' }) : redirectTo('/studio/deleted', { error: result.error });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the buttons in Studio.' });
