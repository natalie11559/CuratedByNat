// Who is signed in. Mostly a way to check that the sign-in gate works end to end.
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = ({ locals }) =>
    new Response(JSON.stringify({ email: locals.studioUser?.email ?? null }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
