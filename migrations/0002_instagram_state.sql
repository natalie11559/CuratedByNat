-- State for the daily Instagram job: the refreshed access token, when it last ran, and which list of
-- posts the live site was last rebuilt for. Not client data.
CREATE TABLE IF NOT EXISTS instagram_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,       -- JSON
    updated_at TEXT NOT NULL   -- ISO 8601, UTC
);
