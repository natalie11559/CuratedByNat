// Which leads need a nudge. The rule: a lead in the stages before booking is flagged when its follow-up date has
// come, or, with no date set, when it has been quiet for `followUpDays` days (5 by default; a setting).
import { daysBetween, easternDate } from './dates.ts';
import type { StageId } from './vocab.ts';

/** Stages where Nat is still working to win the booking. */
export const NUDGED_STAGES: readonly StageId[] = ['new', 'contacted', 'consultation', 'packages_sent'];

export interface FollowUpLead {
    stage: string;
    created_at: string;
    last_contacted_at: string | null;
    next_follow_up_at: string | null;
}

export type FollowUp = {
    due: boolean;
    /** "date" when a follow-up date has come, "quiet" when no contact has been logged for too long. */
    reason: 'date' | 'quiet' | null;
    /** Calendar days since the last contact, or since the inquiry when there has been none. */
    quietDays: number;
};

export function followUpStatus(lead: FollowUpLead, options: { followUpDays: number; today: string }): FollowUp {
    const reference = easternDate(lead.last_contacted_at ?? lead.created_at);
    const quietDays = Math.max(daysBetween(reference, options.today), 0);

    if (!NUDGED_STAGES.includes(lead.stage as StageId)) return { due: false, reason: null, quietDays };

    if (lead.next_follow_up_at) {
        // A date Nat chose wins: the lead is due on that day and not before, however quiet it has been.
        return lead.next_follow_up_at <= options.today
            ? { due: true, reason: 'date', quietDays }
            : { due: false, reason: null, quietDays };
    }
    return quietDays >= options.followUpDays ? { due: true, reason: 'quiet', quietDays } : { due: false, reason: null, quietDays };
}
