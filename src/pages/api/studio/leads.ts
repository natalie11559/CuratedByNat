// Adds a lead by hand (Instagram DMs, TikTok, referrals and so on). Website inquiries become leads by themselves.
import type { APIRoute } from 'astro';
import { forbidden, isSameOrigin, json } from '../../../lib/studio/http';
import { createLead } from '../../../lib/studio/queries';
import { actorEmail, formInput, redirectTo, studioDb } from '../../../lib/studio/server';
import { validateLeadFields } from '../../../lib/studio/validate';

export const prerender = false;

const MAX_BODY_BYTES = 64 * 1024;

export const POST: APIRoute = async ({ request, url, locals }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return json(413, { ok: false, error: 'That is too big.' });
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });

    const checked = validateLeadFields(formInput(await request.formData()));
    if (!checked.ok) return redirectTo('/studio/leads/new', { invalid: Object.keys(checked.errors).join(',') });

    const result = await createLead(db, checked.value, { actor: actorEmail(locals) });
    if (!result.ok) return redirectTo('/studio/leads/new', { error: result.error, lead: result.conflictLeadId });
    return redirectTo(`/studio/leads/${result.id}`, { notice: 'lead-added' });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the form in Studio.' });
