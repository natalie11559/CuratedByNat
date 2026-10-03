// Edits or removes one calendar item.
import type { APIRoute } from 'astro';
import { deleteCalendarItem, getCalendarItem, updateCalendarItem } from '../../../../../lib/studio/calendarDb';
import { forbidden, isSameOrigin, json } from '../../../../../lib/studio/http';
import { isId } from '../../../../../lib/studio/messages';
import { utcToEastern } from '../../../../../lib/studio/tz';
import { actorEmail, formInput, redirectTo, studioDb } from '../../../../../lib/studio/server';
import { validateCalendarItem } from '../../../../../lib/studio/validate';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals, params }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const id = params.id ?? '';
    if (!isId(id)) return json(404, { ok: false, error: 'Not found.' });
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });
    const actor = actorEmail(locals);
    const page = `/studio/calendar/items/${id}`;

    if (params.action === 'update') {
        const checked = validateCalendarItem(formInput(await request.formData()));
        if (!checked.ok) return redirectTo(page, { invalid: Object.keys(checked.errors).join(',') });
        const result = await updateCalendarItem(db, id, checked.value, { actor });
        if (!result.ok) return redirectTo('/studio/calendar', { error: result.error });
        const day = checked.value.allDay ? checked.value.startsAt : utcToEastern(checked.value.startsAt).date;
        return redirectTo(`/studio/calendar/day/${day}`, { notice: 'item-saved' });
    }
    if (params.action === 'delete') {
        const item = await getCalendarItem(db, id);
        const result = await deleteCalendarItem(db, id, { actor });
        if (!result.ok || !item) return redirectTo('/studio/calendar', { error: 'not-found' });
        const day = item.all_day === 1 ? item.starts_at : utcToEastern(item.starts_at).date;
        return redirectTo(`/studio/calendar/day/${day}`, { notice: 'item-removed' });
    }
    return json(404, { ok: false, error: 'Not found.' });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the buttons in Studio.' });
