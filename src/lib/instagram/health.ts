// Is the Instagram connection healthy? Studio's Home screen shows a small notice when it isn't, so Nat hears about it
// there as well as by email. Reads what the daily job left in the database.
import type { D1Database } from '../cloudflare.ts';
import { daysUntilExpiry, tokenIsExpiringSoon, type TokenState } from './feed.ts';

export type InstagramHealth = { ok: true } | { ok: false; message: string };

async function readState<T>(db: D1Database, key: string): Promise<T | null> {
    const row = await db.prepare('SELECT value FROM instagram_state WHERE key = ?1').bind(key).first<{ value: string }>();
    if (!row) return null;
    try {
        return JSON.parse(row.value) as T;
    } catch {
        return null;
    }
}

/** Never throws: if the table isn't there yet (or anything else is odd), there is simply nothing to report. */
export async function instagramHealth(db: D1Database, now: Date = new Date()): Promise<InstagramHealth> {
    try {
        const last = await readState<{ at: string; ok: boolean; problem: string | null }>(db, 'last_sync');
        if (!last) return { ok: true }; // never set up, or not run yet
        if (!last.ok) {
            return { ok: false, message: "The website couldn't refresh your Instagram posts. It keeps showing the photos it has. Ask Matt to reconnect it." };
        }
        const token = await readState<TokenState>(db, 'token');
        if (token && tokenIsExpiringSoon(token, now)) {
            const days = Math.max(daysUntilExpiry(token, now) ?? 0, 0);
            return { ok: false, message: `Your Instagram connection runs out in ${days} ${days === 1 ? 'day' : 'days'}. Ask Matt to renew it.` };
        }
        return { ok: true };
    } catch {
        return { ok: true };
    }
}
