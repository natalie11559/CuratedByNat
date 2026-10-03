// Erases a file for good, once it has been in Recently deleted for 30 days. A signed contract is never erased.
import type { APIRoute } from 'astro';
import { purgeFile } from '../../../../../lib/studio/admin';
import { forbidden, isSameOrigin, json } from '../../../../../lib/studio/http';
import { isId } from '../../../../../lib/studio/messages';
import { actorEmail, redirectTo, studioDb, studioFiles } from '../../../../../lib/studio/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals, params }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const id = params.id ?? '';
    if (!isId(id)) return json(404, { ok: false, error: 'Not found.' });
    const db = studioDb();
    const bucket = studioFiles();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });
    if (!bucket) return redirectTo('/studio/deleted', { error: 'storage-missing' });
    const result = await purgeFile(db, bucket, id, { actor: actorEmail(locals) });
    return result.ok ? redirectTo('/studio/deleted', { notice: 'purged' }) : redirectTo('/studio/deleted', { error: result.error });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the buttons in Studio.' });
