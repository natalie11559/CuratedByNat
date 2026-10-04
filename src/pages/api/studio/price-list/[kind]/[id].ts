// Edits, hides or brings back one package or extra. Hiding keeps it on bookings that already used it.
import type { APIRoute } from 'astro';
import { savePriceListItem, setPriceListItemActive } from '../../../../../lib/studio/bookings';
import { forbidden, isSameOrigin, json } from '../../../../../lib/studio/http';
import { isId } from '../../../../../lib/studio/messages';
import { actorEmail, formInput, redirectTo, studioDb } from '../../../../../lib/studio/server';
import { str, validatePriceListItem } from '../../../../../lib/studio/validate';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals, params }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const { kind, id = '' } = params;
    if ((kind !== 'package' && kind !== 'extra') || !isId(id)) return json(404, { ok: false, error: 'Not found.' });
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });

    const raw = formInput(await request.formData());
    const actor = actorEmail(locals);
    const action = str(raw, 'action');
    if (action === 'hide' || action === 'show') {
        const result = await setPriceListItemActive(db, kind, id, action === 'show', { actor });
        return result.ok
            ? redirectTo('/studio/settings', { notice: action === 'show' ? 'price-shown' : 'price-hidden' })
            : redirectTo('/studio/settings', { error: result.error });
    }

    const checked = validatePriceListItem(raw);
    if (!checked.ok) return redirectTo('/studio/settings', { invalid: Object.keys(checked.errors).join(',') });
    const result = await savePriceListItem(db, kind, id, checked.value, { actor });
    return result.ok ? redirectTo('/studio/settings', { notice: 'price-saved' }) : redirectTo('/studio/settings', { error: result.error });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the form in Studio.' });
