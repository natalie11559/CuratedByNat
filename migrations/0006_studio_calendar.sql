-- Studio part 4: Nat's calendar items. Dates that Studio already knows from a lead (a booked client's event, a
-- follow-up date) are not stored here: they are worked out from the lead, so changing the lead moves them.
-- All-day items keep plain dates in starts_at and ends_at (YYYY-MM-DD, ends_at being the last day). Timed items keep
-- UTC moments. Everything is shown in Eastern time.

CREATE TABLE IF NOT EXISTS calendar_items (
    id TEXT PRIMARY KEY,
    lead_id TEXT REFERENCES leads (id),
    type TEXT NOT NULL CHECK (type IN ('event', 'consultation', 'follow_up', 'delivery', 'personal')),
    title TEXT NOT NULL DEFAULT '',
    starts_at TEXT NOT NULL,
    ends_at TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    actor_email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS calendar_items_starts ON calendar_items (starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS calendar_items_lead ON calendar_items (lead_id) WHERE deleted_at IS NULL;
