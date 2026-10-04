// The private calendar feed Nat subscribes to from her phone. Calendar apps can't sign in through Cloudflare Access,
// so the address itself is the secret: a long random token that Studio can replace at any time. A wrong token gets
// an empty 404. The feed holds only first names, kinds of item, times and cities (see src/lib/studio/ics.ts).
import type { APIRoute } from 'astro';
import { entriesInRange } from '../../lib/studio/calendar';
import { getFeedToken, loadCalendar, tokensMatch } from '../../lib/studio/calendarDb';
import { addDays, todayEastern } from '../../lib/studio/dates';
import { buildIcs } from '../../lib/studio/ics';
import { studioDb } from '../../lib/studio/server';

export const prerender = false;

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });

export const GET: APIRoute = async ({ params }) => {
    const given = params.token ?? '';
    const db = studioDb();
    if (!db || given.length < 20 || given.length > 100) return notFound();

    if (!(await tokensMatch(given, await getFeedToken(db)))) return notFound();

    const today = todayEastern();
    const entries = entriesInRange(await loadCalendar(db), addDays(today, -90), addDays(today, 540));
    return new Response(buildIcs(entries), {
        headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'inline; filename="curated-by-nat.ics"',
            'Cache-Control': 'private, no-store',
            'X-Robots-Tag': 'noindex, nofollow',
        },
    });
};
