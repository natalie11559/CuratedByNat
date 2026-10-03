// Studio's small script, served from a guarded path instead of being built into the public /_astro/ folder.
import type { APIRoute } from 'astro';
import script from '../../studio/client.js?raw';

export const prerender = false;

export const GET: APIRoute = () => new Response(script, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
