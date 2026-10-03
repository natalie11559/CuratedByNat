// Server-side helpers shared by Studio's pages and API routes. Uses `cloudflare:workers`, so it is not loaded by
// the plain-Node unit tests; anything worth testing lives in the other modules.
import { env } from 'cloudflare:workers';
import type { D1Database, R2Bucket } from '../cloudflare';
import type { RawInput } from './validate';

export function studioDb(): D1Database | null {
    return (env as unknown as { DB?: D1Database }).DB ?? null;
}

export function studioFiles(): R2Bucket | null {
    return (env as unknown as { STUDIO_FILES?: R2Bucket }).STUDIO_FILES ?? null;
}

export function actorEmail(locals: App.Locals): string {
    return locals.studioUser?.email ?? '';
}

/** Form fields as plain values; a field sent more than once (checkboxes) becomes a list. */
export function formInput(form: FormData): RawInput {
    const input: RawInput = {};
    for (const key of new Set(form.keys())) {
        const values = form.getAll(key).filter((value): value is string => typeof value === 'string');
        input[key] = values.length > 1 ? values : values[0];
    }
    return input;
}

/** Only Studio's own pages are valid places to go back to, so a form can't be used to send someone elsewhere. */
export function safeStudioPath(value: string | null | undefined, fallback: string): string {
    return typeof value === 'string' && /^\/studio(\/[A-Za-z0-9._~-]+)*(\?[A-Za-z0-9._~=&%,+-]*)?$/.test(value) ? value : fallback;
}

export function redirectTo(path: string, params: Record<string, string | undefined> = {}): Response {
    const url = new URL(path, 'https://studio.invalid');
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, value);
    }
    return new Response(null, { status: 303, headers: { Location: `${url.pathname}${url.search}${url.hash}`, 'Cache-Control': 'no-store' } });
}

export { env };
