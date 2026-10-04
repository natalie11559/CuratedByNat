// Adds a reply template.
import type { APIRoute } from 'astro';
import { saveTemplate } from '../../../lib/studio/admin';
import { forbidden, isSameOrigin, json } from '../../../lib/studio/http';
import { actorEmail, formInput, redirectTo, studioDb } from '../../../lib/studio/server';
import { validateTemplate } from '../../../lib/studio/validate';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });
    const checked = validateTemplate(formInput(await request.formData()));
    if (!checked.ok) return redirectTo('/studio/settings#templates', { invalid: Object.keys(checked.errors).join(',') });
    await saveTemplate(db, null, checked.value, { actor: actorEmail(locals) });
    return redirectTo('/studio/settings#templates', { notice: 'template-saved' });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the form in Studio.' });
