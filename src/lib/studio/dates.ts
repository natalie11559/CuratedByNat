// Dates in Studio. Everything is shown in Eastern time (Nat is in Georgia). Event dates are plain
// YYYY-MM-DD strings with no time zone; timestamps are UTC ISO strings.

export const STUDIO_TIME_ZONE = 'America/New_York';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: STUDIO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/** The calendar day (YYYY-MM-DD) a moment falls on in Eastern time. */
export function easternDate(moment: Date | string): string {
    const date = typeof moment === 'string' ? new Date(moment) : moment;
    return dayFormat.format(date);
}

export function todayEastern(now: Date = new Date()): string {
    return easternDate(now);
}

export function isIsoDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const check = new Date(Date.UTC(year, month - 1, day));
    return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function toUtcDay(isoDate: string): number {
    const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
    return Date.UTC(year, month - 1, day);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). Calendar days, so daylight saving never matters. */
export function daysBetween(from: string, to: string): number {
    return Math.round((toUtcDay(to) - toUtcDay(from)) / 86_400_000);
}

export function addDays(isoDate: string, days: number): string {
    return new Date(toUtcDay(isoDate) + days * 86_400_000).toISOString().slice(0, 10);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "2027-05-15" becomes "May 15, 2027". */
export function formatDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
    return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** "2027-05-15" becomes "Sat, May 15". Adds the year when it is not the given year. */
export function formatShortDate(isoDate: string, currentYear?: number): string {
    const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!.slice(0, 3);
    const base = `${weekday}, ${MONTHS[month - 1]!.slice(0, 3)} ${day}`;
    return currentYear !== undefined && year !== currentYear ? `${base}, ${year}` : base;
}

/** A start and optional end as one phrase: "Jun 6 to Jun 8, 2027". */
export function formatDateRange(start: string, end: string | null | undefined): string {
    if (!end || end === start) return formatDate(start);
    const [startYear] = start.split('-').map(Number) as [number];
    const [endYear] = end.split('-').map(Number) as [number];
    const startText = startYear === endYear ? formatDate(start).replace(`, ${startYear}`, '') : formatDate(start);
    return `${startText} to ${formatDate(end)}`;
}

/** "Today", "Yesterday", "3 days ago", "In 2 days", "Tomorrow". */
export function relativeDays(isoDate: string, today: string): string {
    const difference = daysBetween(today, isoDate);
    if (difference === 0) return 'Today';
    if (difference === 1) return 'Tomorrow';
    if (difference === -1) return 'Yesterday';
    return difference > 0 ? `In ${difference} days` : `${-difference} days ago`;
}

/** "2026-09-01T16:30:00Z" becomes "Sep 1, 12:30 PM" in Eastern time. */
export function formatTimestamp(timestamp: string): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: STUDIO_TIME_ZONE,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(timestamp));
}

/** First day of the month a YYYY-MM-DD falls in, as YYYY-MM. */
export function monthOf(isoDate: string): string {
    return isoDate.slice(0, 7);
}

export function formatMonth(month: string): string {
    const [year, number] = month.split('-').map(Number) as [number, number];
    return `${MONTHS[number - 1]} ${year}`;
}
