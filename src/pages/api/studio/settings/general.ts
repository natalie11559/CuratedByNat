// Saves how many quiet days before a lead is flagged, and the reasons offered when a lead is lost.
import type { APIRoute } from 'astro';
import { saveGeneralSettings } from '../../../../lib/studio/admin';
import { forbidden, isSameOrigin, json } from '../../../../lib/studio/http';
import { actorEmail, formInput, redirectTo, studioDb } from '../../../../lib/studio/server';
import { validateGeneralSettings } from '../../../../lib/studio/validate';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });
    const checked = validateGeneralSettings(formInput(await request.formData()));
    if (!checked.ok) return redirectTo('/studio/settings#general', { invalid: Object.keys(checked.errors).join(',') });
    await saveGeneralSettings(db, checked.value, { actor: actorEmail(locals) });
    return redirectTo('/studio/settings#general', { notice: 'settings-saved' });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the form in Studio.' });
