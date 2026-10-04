// The Clients list as a spreadsheet (CSV), using the same search and stage filter as the page.
import type { APIRoute } from 'astro';
import { clientsCsv, listClients, SORTS, type SortId } from '../../../lib/studio/clients';
import { easternDate } from '../../../lib/studio/dates';
import { studioDb } from '../../../lib/studio/server';
import { STAGES, LOST_STAGE } from '../../../lib/studio/vocab';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
    const db = studioDb();
    if (!db) return new Response('Not found', { status: 404 });
    const params = url.searchParams;
    const stage = params.get('stage') ?? '';
    const sort = params.get('sort') as SortId | null;
    const clients = await listClients(db, {
        q: (params.get('q') ?? '').slice(0, 100),
        stage: [...STAGES, LOST_STAGE].some((entry) => entry.id === stage) ? stage : undefined,
        sort: SORTS.some((entry) => entry.id === sort) ? sort! : 'name',
        dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
    });
    return new Response(clientsCsv(clients), {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="curated-by-nat-clients-${easternDate(new Date())}.csv"`,
        },
    });
};
