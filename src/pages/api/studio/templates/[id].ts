// Saves or deletes one reply template.
import type { APIRoute } from 'astro';
import { deleteTemplate, saveTemplate } from '../../../../lib/studio/admin';
import { forbidden, isSameOrigin, json } from '../../../../lib/studio/http';
import { isId } from '../../../../lib/studio/messages';
import { actorEmail, formInput, redirectTo, studioDb } from '../../../../lib/studio/server';
import { str, validateTemplate } from '../../../../lib/studio/validate';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals, params }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const id = params.id ?? '';
    if (!isId(id)) return json(404, { ok: false, error: 'Not found.' });
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });

    const raw = formInput(await request.formData());
    const actor = actorEmail(locals);
    if (str(raw, 'action') === 'delete') {
        const result = await deleteTemplate(db, id, { actor });
        return result.ok ? redirectTo('/studio/settings#templates', { notice: 'template-deleted' }) : redirectTo('/studio/settings#templates', { error: result.error });
    }
    const checked = validateTemplate(raw);
    if (!checked.ok) return redirectTo('/studio/settings#templates', { invalid: Object.keys(checked.errors).join(',') });
    const result = await saveTemplate(db, id, checked.value, { actor });
    return result.ok ? redirectTo('/studio/settings#templates', { notice: 'template-saved' }) : redirectTo('/studio/settings#templates', { error: result.error });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the form in Studio.' });
