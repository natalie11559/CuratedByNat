// Studio's stylesheet, served from a guarded path instead of being built into the public /_astro/ folder.
import type { APIRoute } from 'astro';
import tokens from '../../styles/tokens.css?raw';
import studio from '../../studio/studio.css?raw';

export const prerender = false;

export const GET: APIRoute = () =>
    new Response(`${tokens}\n${studio}`, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
