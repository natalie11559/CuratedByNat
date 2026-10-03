// What belongs on Studio's Home screen, worked out from the list of leads. Pure, so it is easy to test.
import { addDays, daysBetween } from './dates.ts';
import { followUpStatus, type FollowUp } from './followup.ts';
import type { LeadRow } from './queries.ts';

export interface DueLead {
    lead: LeadRow;
    followUp: FollowUp;
}

export type WeekItemKind = 'event' | 'follow-up';

export interface WeekItem {
    kind: WeekItemKind;
    date: string;
    lead: LeadRow;
}

export interface Today {
    /** Past the follow-up date, or quiet for too long. Most overdue first. */
    needsFollowUp: DueLead[];
    /** New leads nobody has been in touch with yet and that are not overdue. */
    newInquiries: LeadRow[];
    /** Events and follow-ups in the next seven days, soonest first. */
    thisWeek: WeekItem[];
}

const EVENT_STAGES = ['booked', 'event_done'];

export function buildToday(leads: readonly LeadRow[], options: { today: string; followUpDays: number }): Today {
    const { today, followUpDays } = options;
    const weekEnd = addDays(today, 7);

    const needsFollowUp: DueLead[] = [];
    const newInquiries: LeadRow[] = [];
    const thisWeek: WeekItem[] = [];

    for (const lead of leads) {
        if (lead.deleted_at) continue;
        const followUp = followUpStatus(lead, { followUpDays, today });
        if (followUp.due) needsFollowUp.push({ lead, followUp });
        else if (lead.stage === 'new') newInquiries.push(lead);

        if (lead.next_follow_up_at && lead.next_follow_up_at > today && lead.next_follow_up_at <= weekEnd && !['lost', 'delivered'].includes(lead.stage)) {
            thisWeek.push({ kind: 'follow-up', date: lead.next_follow_up_at, lead });
        }
        if (EVENT_STAGES.includes(lead.stage) && lead.event_date) {
            const lastDay = lead.end_date ?? lead.event_date;
            // Shown from the first day it is within a week until the last day it is on.
            if (lastDay >= today && lead.event_date <= weekEnd) {
                thisWeek.push({ kind: 'event', date: lead.event_date < today ? today : lead.event_date, lead });
            }
        }
    }

    needsFollowUp.sort((a, b) => b.followUp.quietDays - a.followUp.quietDays || a.lead.created_at.localeCompare(b.lead.created_at));
    newInquiries.sort((a, b) => b.created_at.localeCompare(a.created_at));
    thisWeek.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
    return { needsFollowUp, newInquiries, thisWeek };
}

/** The number to show beside a lead in a list: "5 days quiet". */
export function quietLabel(quietDays: number, hasContact: boolean): string {
    if (quietDays === 0) return hasContact ? 'Contacted today' : 'Inquired today';
    const unit = quietDays === 1 ? 'day' : 'days';
    return hasContact ? `Last contact ${quietDays} ${unit} ago` : `No contact yet, inquired ${quietDays} ${unit} ago`;
}

export { daysBetween };
