// The list of Nat's recent Instagram posts that the daily job saved. Public (the posts are public); the
// build downloads this list and the pictures so they go through the same image pipeline as every photo.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { R2Bucket } from '../../../lib/cloudflare';
import { EMPTY_MANIFEST } from '../../../lib/instagram/feed';
import { MANIFEST_KEY } from '../../../lib/instagram/sync';

export const prerender = false;

const bucket = (env as unknown as { INSTAGRAM_BUCKET?: R2Bucket }).INSTAGRAM_BUCKET;

export const GET: APIRoute = async () => {
    let body = JSON.stringify(EMPTY_MANIFEST);
    try {
        const object = await bucket?.get(MANIFEST_KEY);
        if (object) body = await object.text();
    } catch (error) {
        console.error('[instagram] Could not read the feed list:', error instanceof Error ? error.message : error);
    }
    return new Response(body, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    });
};
