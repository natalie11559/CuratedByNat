CREATE TABLE IF NOT EXISTS inquiries (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    email TEXT NOT NULL,
    payload TEXT NOT NULL,
    email_status TEXT NOT NULL DEFAULT 'pending'
);
