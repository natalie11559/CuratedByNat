// What belongs on Studio's Home screen, worked out from the list of leads. Pure, so it is easy to test.
import { compareEntries, entriesInRange, type CalendarEntry } from './calendar.ts';
import { addDays, daysBetween } from './dates.ts';
import { followUpStatus, type FollowUp } from './followup.ts';
import type { LeadRow } from './queries.ts';

export interface DueLead {
    lead: LeadRow;
    followUp: FollowUp;
}

export interface WeekItem {
    /** The first day to show it on this week: today, for something already under way. */
    date: string;
    entry: CalendarEntry;
}

export interface Today {
    /** Past the follow-up date, or quiet for too long. Most overdue first. */
    needsFollowUp: DueLead[];
    /** New leads nobody has been in touch with yet and that are not overdue. */
    newInquiries: LeadRow[];
    /** Everything on the calendar in the next seven days, soonest first. */
    thisWeek: WeekItem[];
}

export function buildToday(
    leads: readonly LeadRow[],
    options: { today: string; followUpDays: number; entries: readonly CalendarEntry[] },
): Today {
    const { today, followUpDays } = options;
    const weekEnd = addDays(today, 7);

    const needsFollowUp: DueLead[] = [];
    const newInquiries: LeadRow[] = [];
    for (const lead of leads) {
        if (lead.deleted_at) continue;
        const followUp = followUpStatus(lead, { followUpDays, today });
        if (followUp.due) needsFollowUp.push({ lead, followUp });
        else if (lead.stage === 'new') newInquiries.push(lead);
    }

    // A follow-up date that has already come is in "Needs follow-up", so only the days still ahead are listed here.
    const thisWeek: WeekItem[] = entriesInRange(options.entries, today, weekEnd)
        .filter((entry) => !(entry.type === 'follow_up' && entry.auto && entry.date <= today))
        .map((entry) => ({ date: entry.date < today ? today : entry.date, entry }));

    needsFollowUp.sort((a, b) => b.followUp.quietDays - a.followUp.quietDays || a.lead.created_at.localeCompare(b.lead.created_at));
    newInquiries.sort((a, b) => b.created_at.localeCompare(a.created_at));
    thisWeek.sort((a, b) => a.date.localeCompare(b.date) || compareEntries(a.entry, b.entry));
    return { needsFollowUp, newInquiries, thisWeek };
}

/** The number to show beside a lead in a list: "5 days quiet". */
export function quietLabel(quietDays: number, hasContact: boolean): string {
    if (quietDays === 0) return hasContact ? 'Contacted today' : 'Inquired today';
    const unit = quietDays === 1 ? 'day' : 'days';
    return hasContact ? `Last contact ${quietDays} ${unit} ago` : `No contact yet, inquired ${quietDays} ${unit} ago`;
}

export { daysBetween };
