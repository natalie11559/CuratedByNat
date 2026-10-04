// Adds a file to a lead: the signed contract, or anything else worth keeping. PDF, JPG, PNG or HEIC, up to 25 MB.
// The type is read from the file's own bytes, and it is stored under a random name in a private bucket.
import type { APIRoute } from 'astro';
import { saveFile } from '../../../../../lib/studio/files';
import { MAX_FILE_BYTES } from '../../../../../lib/studio/filetypes';
import { forbidden, isSameOrigin, json } from '../../../../../lib/studio/http';
import { isId } from '../../../../../lib/studio/messages';
import { actorEmail, redirectTo, studioDb, studioFiles } from '../../../../../lib/studio/server';

export const prerender = false;

/** The 25 MB file plus room for the form's other fields. */
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 256 * 1024;

const ERROR_CODES = {
    'not-found': 'not-found',
    'unsupported-type': 'file-type',
    'too-large': 'file-too-large',
    empty: 'file-empty',
    invalid: 'invalid',
} as const;

export const POST: APIRoute = async ({ request, url, locals, params }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const id = params.id ?? '';
    if (!isId(id)) return json(404, { ok: false, error: 'Not found.' });
    const leadPage = `/studio/leads/${id}`;

    const db = studioDb();
    const bucket = studioFiles();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });
    if (!bucket) return redirectTo(leadPage, { error: 'storage-missing' });
    if (Number(request.headers.get('content-length') ?? '0') > MAX_REQUEST_BYTES) return redirectTo(leadPage, { error: 'file-too-large' });

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return redirectTo(leadPage, { error: 'file-missing' });

    const kind = form.get('kind');
    const result = await saveFile(
        db,
        bucket,
        id,
        { bytes: await file.arrayBuffer(), originalName: file.name, kind: typeof kind === 'string' ? kind : 'other' },
        { actor: actorEmail(locals) },
    );
    return result.ok ? redirectTo(`${leadPage}#files`, { notice: 'file-added' }) : redirectTo(leadPage, { error: ERROR_CODES[result.error] });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the form in Studio.' });
