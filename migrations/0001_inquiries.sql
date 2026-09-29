-- Every inquiry sent through the website form. This is the backup copy: rows are saved before
-- the email to Nat is sent, so nothing is lost if the email fails.
CREATE TABLE IF NOT EXISTS inquiries (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,           -- ISO 8601, UTC
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    celebrating TEXT NOT NULL,          -- labels as shown on the form, comma separated
    event_date TEXT,                    -- YYYY-MM-DD, NULL when the date isn't set yet
    end_date TEXT,                      -- YYYY-MM-DD, multi-day events only
    location TEXT NOT NULL,
    payload TEXT NOT NULL,              -- the full cleaned submission as JSON
    email_status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | dev-captured
    email_id TEXT,                      -- Resend message id when sent
    email_error TEXT                    -- why sending failed
);

CREATE INDEX IF NOT EXISTS inquiries_created_at ON inquiries (created_at);
CREATE INDEX IF NOT EXISTS inquiries_email_status ON inquiries (email_status);
