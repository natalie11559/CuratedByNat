// Makes a new secret address for the phone calendar. The old address stops working at once.
import type { APIRoute } from 'astro';
import { resetFeedToken } from '../../../../lib/studio/calendarDb';
import { forbidden, isSameOrigin, json } from '../../../../lib/studio/http';
import { actorEmail, redirectTo, studioDb } from '../../../../lib/studio/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, locals }) => {
    if (!isSameOrigin(request, url)) return forbidden();
    const db = studioDb();
    if (!db) return redirectTo('/studio', { error: 'database-missing' });
    await resetFeedToken(db, actorEmail(locals));
    return redirectTo('/studio/settings#calendar-feed', { notice: 'feed-reset' });
};

export const ALL: APIRoute = () => json(405, { ok: false, error: 'Use the button in Studio.' });
