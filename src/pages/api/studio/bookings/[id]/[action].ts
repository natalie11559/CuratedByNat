// Changes to one booking: edit it, remove it, or record a payment. Forms post here with a hidden return_to
// that names the lead's page.
import type { APIRoute } from 'astro';
import { addPayment, listExtras, listPackages, removeBooking, updateBooking } from '../../../../../lib/studio/bookings';
import { todayEastern } from '../../../../../lib/studio/dates';
import { forbidden, isSameOrigin, json } from '../../../../../lib/studio/http';
import { isId } from '../../../../../lib/studio/messages';
import { actorEmail, formInput, redirectTo, safeStudioPath, studioDb } from '../../../../../lib/studio/server';
import { str, validateBookingInput, validatePaymentInput, type PackageOption } from '../../../../../lib/studio/validate';

export const prerender = false;

const MAX_BODY_BYTES = 64 * 1024;

export const POST: APIRoute = async ({ request, url, locals, params }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return json(413, { ok: false, error: 'That is too big.' });

    const id = params.id ?? '';
    if (!isId(id)) return json(404, { ok: false, error: 'Not found.' });
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });

    const raw = formInput(await request.formData());
    const actor = actorEmail(locals);
    const back = safeStudioPath(str(raw, 'return_to'), '/studio');
    const failed = (error: string) => redirectTo(back, { error });

    switch (params.action) {
        case 'update': {
            const toOption = (rows: Array<{ id: string; name: string; price_cents: number }>): PackageOption[] =>
                rows.map((row) => ({ id: row.id, name: row.name, priceCents: row.price_cents }));
            const [packages, extras] = await Promise.all([listPackages(db), listExtras(db)]);
            const checked = validateBookingInput(raw, { packages: toOption(packages), extras: toOption(extras) });
            if (!checked.ok) return redirectTo(back, { invalid: Object.keys(checked.errors).join(',') });
            const result = await updateBooking(db, id, checked.value, { actor });
            return result.ok ? redirectTo(back, { notice: 'booking-saved' }) : failed(result.error);
        }
        case 'remove': {
            const result = await removeBooking(db, id, { actor });
            return result.ok ? redirectTo(back, { notice: 'booking-removed' }) : failed(result.error);
        }
        case 'payment': {
            const checked = validatePaymentInput(raw, todayEastern());
            if (!checked.ok) return redirectTo(back, { invalid: Object.keys(checked.errors).join(',') });
            const result = await addPayment(db, id, checked.value, { actor });
            return result.ok ? redirectTo(back, { notice: 'payment-added' }) : failed(result.error);
        }
        default:
            return json(404, { ok: false, error: 'Not found.' });
    }
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the buttons in Studio.' });
