// Adds an item to Nat's calendar: a consultation, a delivery, a reminder, or a personal appointment.
import type { APIRoute } from 'astro';
import { createCalendarItem } from '../../../lib/studio/calendarDb';
import { utcToEastern } from '../../../lib/studio/tz';
import { forbidden, isSameOrigin, json } from '../../../lib/studio/http';
import { actorEmail, formInput, redirectTo, safeStudioPath, studioDb } from '../../../lib/studio/server';
import { str, validateCalendarItem } from '../../../lib/studio/validate';

export const prerender = false;

const MAX_BODY_BYTES = 64 * 1024;

export const POST: APIRoute = async ({ request, url, locals }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return json(413, { ok: false, error: 'That is too big.' });
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });

    const raw = formInput(await request.formData());
    const form = safeStudioPath(str(raw, 'return_to'), '/studio/calendar/new');
    const checked = validateCalendarItem(raw);
    if (!checked.ok) return redirectTo(form, { invalid: Object.keys(checked.errors).join(',') });

    const result = await createCalendarItem(db, checked.value, { actor: actorEmail(locals) });
    if (!result.ok) return redirectTo(form, { error: result.error });
    const day = checked.value.allDay ? checked.value.startsAt : utcToEastern(checked.value.startsAt).date;
    return redirectTo(`/studio/calendar/day/${day}`, { notice: 'item-added' });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the form in Studio.' });
