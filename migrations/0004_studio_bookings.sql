-- Studio part 2: packages and extras (editable price lists), bookings, and the payments received.
-- Money is whole cents. Prices are copied onto a booking when it is made, so changing a package's price later
-- never changes a booking that already exists. The balance is never stored: it is total minus payments.
-- No prices are in this file. They are loaded from a private file (scripts/seed-studio-packages.mjs) or typed
-- into Studio's settings.

CREATE TABLE IF NOT EXISTS packages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    details TEXT NOT NULL DEFAULT '[]',      -- JSON array of "what's included" lines
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS extras (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads (id),
    package_id TEXT REFERENCES packages (id),
    package_name TEXT NOT NULL DEFAULT '',   -- copied from the package (or typed, for a custom booking)
    package_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (package_price_cents >= 0),
    travel_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (travel_fee_cents >= 0),
    travel_fee_note TEXT NOT NULL DEFAULT '',
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    retainer_cents INTEGER NOT NULL DEFAULT 0 CHECK (retainer_cents >= 0),
    balance_due_date TEXT,                   -- YYYY-MM-DD
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS bookings_lead ON bookings (lead_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS booking_extras (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL REFERENCES bookings (id),
    extra_id TEXT REFERENCES extras (id),
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1)
);

CREATE INDEX IF NOT EXISTS booking_extras_booking ON booking_extras (booking_id);

CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL REFERENCES bookings (id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    received_on TEXT NOT NULL,               -- YYYY-MM-DD
    method TEXT NOT NULL DEFAULT 'other' CHECK (method IN ('venmo', 'zelle', 'cash', 'check', 'card', 'other')),
    note TEXT NOT NULL DEFAULT '',
    actor_email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS payments_booking ON payments (booking_id) WHERE deleted_at IS NULL;
