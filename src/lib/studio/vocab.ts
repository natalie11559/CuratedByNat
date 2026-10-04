// The fixed words of the pipeline. The ids are stored in the database and never change; the labels are what
// Nat sees. Pure, so tests and pages share it.

export const STAGES = [
    { id: 'new', label: 'New' },
    { id: 'contacted', label: 'Contacted' },
    { id: 'consultation', label: 'Consultation' },
    { id: 'packages_sent', label: 'Packages sent' },
    { id: 'booked', label: 'Booked' },
    { id: 'event_done', label: 'Event done' },
    { id: 'delivered', label: 'Delivered' },
] as const;

export type StageId = (typeof STAGES)[number]['id'] | 'lost';

export const LOST_STAGE = { id: 'lost', label: 'Lost' } as const;

export const SOURCES = [
    { id: 'website', label: 'Website' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'tiktok', label: 'TikTok' },
    { id: 'referral', label: 'Referral' },
    { id: 'planner_vendor', label: 'Planner or vendor' },
    { id: 'past_client', label: 'Past client' },
    { id: 'other', label: 'Other' },
] as const;

export type SourceId = (typeof SOURCES)[number]['id'];

export const CELEBRATING = [
    { id: 'wedding', label: 'Wedding' },
    { id: 'bachelorette', label: 'Bachelorette weekend' },
    { id: 'bridal-event', label: 'Bridal event' },
    { id: 'celebration', label: 'Celebration' },
    { id: 'not-sure', label: 'Not sure yet' },
] as const;

export type CelebratingId = (typeof CELEBRATING)[number]['id'];

export const ACTIVITY_TYPES = ['note', 'call', 'text', 'email', 'dm', 'meeting', 'stage_change', 'payment', 'file', 'system'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Activity types that count as having been in touch with the client. */
export const CONTACT_TYPES: readonly ActivityType[] = ['call', 'text', 'email', 'dm', 'meeting'];

/** Stages where a repeat inquiry from the same email is a new enquiry rather than more about an open lead. */
export const CLOSED_STAGES: readonly StageId[] = ['delivered', 'lost'];

export function stageLabel(stage: string): string {
    return [...STAGES, LOST_STAGE].find((entry) => entry.id === stage)?.label ?? stage;
}

export function celebratingLabels(ids: readonly string[]): string[] {
    return ids.map((id) => CELEBRATING.find((entry) => entry.id === id)?.label ?? id);
}
