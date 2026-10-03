// Opens or downloads a file. Only reachable through Studio's sign-in, and the bucket itself has no public address.
import type { APIRoute } from 'astro';
import { getFile } from '../../../../../lib/studio/files';
import { contentDisposition } from '../../../../../lib/studio/filetypes';
import { isId } from '../../../../../lib/studio/messages';
import { studioDb, studioFiles } from '../../../../../lib/studio/server';

export const prerender = false;

export const GET: APIRoute = async ({ params, url }) => {
    const id = params.id ?? '';
    const db = studioDb();
    const bucket = studioFiles();
    if (!isId(id) || !db || !bucket) return new Response('Not found', { status: 404 });

    const file = await getFile(db, id);
    const object = file ? await bucket.get(file.r2_key) : null;
    if (!file || !object) return new Response('Not found', { status: 404 });

    // PDFs and JPG/PNG pictures open in the browser; HEIC (which most browsers can't show) and anything asked
    // for with ?download=1 is saved instead.
    const known = file.content_type === 'application/pdf' || file.content_type === 'image/jpeg' || file.content_type === 'image/png';
    const inline = known && url.searchParams.get('download') !== '1';
    return new Response(object.body, {
        headers: {
            'Content-Type': file.content_type,
            'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', file.original_name),
            'Content-Length': String(file.size_bytes),
            'X-Content-Type-Options': 'nosniff',
        },
    });
};
