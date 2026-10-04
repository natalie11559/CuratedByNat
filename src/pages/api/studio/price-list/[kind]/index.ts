// Adds a package or an extra to the price list.
import type { APIRoute } from 'astro';
import { savePriceListItem } from '../../../../../lib/studio/bookings';
import { forbidden, isSameOrigin, json } from '../../../../../lib/studio/http';
import { actorEmail, formInput, redirectTo, studioDb } from '../../../../../lib/studio/server';
import { validatePriceListItem } from '../../../../../lib/studio/validate';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals, params }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const kind = params.kind;
    if (kind !== 'package' && kind !== 'extra') return json(404, { ok: false, error: 'Not found.' });
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });

    const checked = validatePriceListItem(formInput(await request.formData()));
    if (!checked.ok) return redirectTo('/studio/settings', { invalid: Object.keys(checked.errors).join(',') });
    await savePriceListItem(db, kind, null, checked.value, { actor: actorEmail(locals) });
    return redirectTo('/studio/settings', { notice: 'price-saved' });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the form in Studio.' });
