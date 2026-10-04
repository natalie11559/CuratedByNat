// Removes a file from a lead's page. It is hidden, not erased: it stays in the bucket and can be restored.
import type { APIRoute } from 'astro';
import { getFile, removeFile } from '../../../../../lib/studio/files';
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

    const file = await getFile(db, id);
    if (!file) return redirectTo('/studio/pipeline', { error: 'not-found' });
    const result = await removeFile(db, id, { actor: actorEmail(locals) });
    return redirectTo(`/studio/leads/${file.lead_id}#files`, result.ok ? { notice: 'file-removed' } : { error: result.error });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the buttons in Studio.' });
