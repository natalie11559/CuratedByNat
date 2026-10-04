// The list of clients offered in "about a client" boxes.
import { fullName, type LeadRow } from './queries.ts';
import { stageLabel } from './vocab.ts';

export function leadOptions(leads: readonly LeadRow[]): { id: string; label: string }[] {
    return leads
        .filter((lead) => !['lost', 'delivered'].includes(lead.stage))
        .map((lead) => ({ id: lead.id, label: `${fullName(lead)} (${stageLabel(lead.stage)})` }))
        .sort((a, b) => a.label.localeCompare(b.label));
}
