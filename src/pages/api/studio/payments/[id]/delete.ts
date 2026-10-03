// Removes a payment that was recorded by mistake. It stays in the audit trail.
import type { APIRoute } from 'astro';
import { deletePayment } from '../../../../../lib/studio/bookings';
import { forbidden, isSameOrigin, json } from '../../../../../lib/studio/http';
import { isId } from '../../../../../lib/studio/messages';
import { actorEmail, formInput, redirectTo, safeStudioPath, studioDb } from '../../../../../lib/studio/server';
import { str } from '../../../../../lib/studio/validate';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals, params }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const id = params.id ?? '';
    if (!isId(id)) return json(404, { ok: false, error: 'Not found.' });
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });

    const back = safeStudioPath(str(formInput(await request.formData()), 'return_to'), '/studio');
    const result = await deletePayment(db, id, { actor: actorEmail(locals) });
    return result.ok ? redirectTo(back, { notice: 'payment-removed' }) : redirectTo(back, { error: result.error });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the buttons in Studio.' });
