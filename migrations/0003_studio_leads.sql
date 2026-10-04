-- Studio (the private CRM), part 1: leads, the activity timeline, an audit trail and settings.
-- Dates are ISO 8601 strings; timestamps are UTC, event dates are plain YYYY-MM-DD. Money is never stored here.

CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL DEFAULT '',
    partner_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',          -- as typed
    email_key TEXT NOT NULL DEFAULT '',      -- trimmed and lowercase, used to match repeat inquiries
    phone TEXT NOT NULL DEFAULT '',
    instagram TEXT NOT NULL DEFAULT '',
    inquirer_role TEXT NOT NULL DEFAULT '',  -- "Who's inquiring?" as answered on the form
    source TEXT NOT NULL DEFAULT 'website'
        CHECK (source IN ('website', 'instagram', 'tiktok', 'referral', 'planner_vendor', 'past_client', 'other')),
    found_via TEXT NOT NULL DEFAULT '',      -- "How did you find me?" as answered on the form
    celebrating TEXT NOT NULL DEFAULT '[]',  -- JSON array: wedding, bachelorette, bridal-event, celebration, not-sure
    event_date TEXT,                         -- YYYY-MM-DD
    end_date TEXT,                           -- YYYY-MM-DD, multi-day events only
    date_not_set INTEGER NOT NULL DEFAULT 0,
    location TEXT NOT NULL DEFAULT '',
    in_georgia TEXT NOT NULL DEFAULT '',     -- yes, destination, not-sure, or empty
    venue TEXT NOT NULL DEFAULT '',
    photo_video TEXT NOT NULL DEFAULT '',    -- photographer or videographer status, as answered
    excited_about TEXT NOT NULL DEFAULT '',
    anything_else TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'new'
        CHECK (stage IN ('new', 'contacted', 'consultation', 'packages_sent', 'booked', 'event_done', 'delivered', 'lost')),
    stage_before_lost TEXT,
    lost_reason TEXT,
    last_contacted_at TEXT,                  -- UTC timestamp of the last call, text, email, DM or meeting
    next_follow_up_at TEXT,                  -- YYYY-MM-DD
    notes TEXT NOT NULL DEFAULT '',
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS leads_stage ON leads (stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_event_date ON leads (event_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_created_at ON leads (created_at);

-- One open lead per email address. Open means not deleted and not yet delivered or lost. This also stops two
-- inquiries sent at the same moment from creating two leads.
CREATE UNIQUE INDEX IF NOT EXISTS leads_one_open_per_email ON leads (email_key)
    WHERE deleted_at IS NULL AND email_key <> '' AND stage NOT IN ('delivered', 'lost');

-- Which website inquiries belong to which lead. The full original submission stays in `inquiries.payload`.
CREATE TABLE IF NOT EXISTS lead_inquiries (
    inquiry_id TEXT PRIMARY KEY REFERENCES inquiries (id),
    lead_id TEXT NOT NULL REFERENCES leads (id),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS lead_inquiries_lead ON lead_inquiries (lead_id);

CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads (id),
    type TEXT NOT NULL
        CHECK (type IN ('note', 'call', 'text', 'email', 'dm', 'meeting', 'stage_change', 'payment', 'file', 'system')),
    body TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL,
    actor_email TEXT NOT NULL DEFAULT '',    -- empty for things the website did by itself
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS activities_lead ON activities (lead_id, occurred_at);

-- Who did what and when, for changes that matter later: payments, files, deletions and settings.
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT ''         -- never client contact details
);

CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log (entity, entity_id);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,                     -- JSON
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
    ('follow_up_days', '5', '2026-01-01T00:00:00Z'),
    ('lost_reasons', '["Booked someone else","Over budget","Date unavailable","No response","Not a fit","Other"]', '2026-01-01T00:00:00Z'),
    ('timezone', '"America/New_York"', '2026-01-01T00:00:00Z');
