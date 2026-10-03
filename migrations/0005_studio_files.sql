-- Studio part 3: files kept with a lead, mainly the signed contract. The files themselves live in a private R2
-- bucket under a random key; this table is the index. Deleting only hides a file for 30 days: contracts are never
-- removed automatically.

CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads (id),
    kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('contract', 'other')),
    r2_key TEXT NOT NULL UNIQUE,             -- random, never the client's name
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,              -- found by reading the file, not trusted from the browser
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    uploaded_at TEXT NOT NULL,
    actor_email TEXT NOT NULL DEFAULT '',
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS files_lead ON files (lead_id) WHERE deleted_at IS NULL;
