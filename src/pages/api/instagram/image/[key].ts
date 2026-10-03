// One saved Instagram picture. File names contain the post id, which never changes, so they cache forever.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { R2Bucket } from '../../../../lib/cloudflare';
import { IMAGE_PREFIX } from '../../../../lib/instagram/sync';

export const prerender = false;

const bucket = (env as unknown as { INSTAGRAM_BUCKET?: R2Bucket }).INSTAGRAM_BUCKET;
const KEY_PATTERN = /^[0-9]{5,32}\.(?:jpg|png|webp)$/;

export const GET: APIRoute = async ({ params }) => {
    const key = params.key ?? '';
    if (!KEY_PATTERN.test(key) || !bucket) return new Response('Not found', { status: 404 });

    const object = await bucket.get(`${IMAGE_PREFIX}${key}`);
    if (!object) return new Response('Not found', { status: 404 });

    return new Response(object.body, {
        headers: {
            'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
            ETag: object.etag,
        },
    });
};
