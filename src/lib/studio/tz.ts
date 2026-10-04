// Eastern time <-> UTC for calendar items. Nat types times in Eastern time; they are stored in UTC and shown in
// Eastern time. Daylight saving is handled by asking Intl rather than assuming an offset.
import { STUDIO_TIME_ZONE } from './dates.ts';

const partsFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: STUDIO_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});

function easternParts(moment: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    const values: Record<string, number> = {};
    for (const part of partsFormat.formatToParts(moment)) {
        if (part.type !== 'literal') values[part.type] = Number(part.value);
    }
    return { year: values.year!, month: values.month!, day: values.day!, hour: values.hour!, minute: values.minute!, second: values.second! };
}

/** Minutes Eastern time is ahead of UTC at that moment (negative: -240 in summer, -300 in winter). */
function offsetMinutes(moment: Date): number {
    const parts = easternParts(moment);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return Math.round((asUtc - Math.floor(moment.getTime() / 1000) * 1000) / 60000);
}

/**
 * "2026-10-17" and "16:30" in Eastern time become the UTC moment. A time that does not exist (the hour skipped when
 * clocks go forward) is read as the hour after; a time that happens twice (when they go back) is the first one.
 */
export function easternToUtc(date: string, time: string): Date | null {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
    if (!dateMatch || !timeMatch) return null;
    const [year, month, day] = [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])] as [number, number, number];
    const [hour, minute] = [Number(timeMatch[1]), Number(timeMatch[2])] as [number, number];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

    const wallClock = Date.UTC(year, month - 1, day, hour, minute);
    // Try both offsets that could apply on that day and keep the one that reads back as the same wall-clock time.
    const candidates = [offsetMinutes(new Date(wallClock - 24 * 3_600_000)), offsetMinutes(new Date(wallClock + 24 * 3_600_000))];
    for (const offset of [...new Set(candidates)].sort((a, b) => b - a)) {
        const moment = new Date(wallClock - offset * 60_000);
        const back = easternParts(moment);
        if (back.hour === hour && back.minute === minute && back.day === day) return moment;
    }
    // In the skipped hour no offset reads back, so use the later offset's reading (the hour after).
    return new Date(wallClock - Math.min(...candidates) * 60_000);
}

/** A UTC moment as Eastern "YYYY-MM-DD" and "HH:MM". */
export function utcToEastern(moment: Date | string): { date: string; time: string } {
    const parts = easternParts(typeof moment === 'string' ? new Date(moment) : moment);
    const two = (value: number) => String(value).padStart(2, '0');
    return { date: `${parts.year}-${two(parts.month)}-${two(parts.day)}`, time: `${two(parts.hour)}:${two(parts.minute)}` };
}

/** "16:30" becomes "4:30 PM". */
export function formatClock(time: string): string {
    const [hour, minute] = time.split(':').map(Number) as [number, number];
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${suffix}`;
}
