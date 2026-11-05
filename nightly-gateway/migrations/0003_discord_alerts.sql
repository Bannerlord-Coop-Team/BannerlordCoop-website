-- Keep this table and LEGACY_DB after the account-data cutover: they coordinate
-- alert delivery across Worker isolates independently of the account backend.
CREATE TABLE discord_alerts (
    error_kind TEXT PRIMARY KEY,
    first_occurrence_at INTEGER NOT NULL CHECK (first_occurrence_at > 0),
    occurrence_count INTEGER NOT NULL CHECK (occurrence_count > 0),
    last_claimed_at INTEGER NOT NULL CHECK (last_claimed_at >= first_occurrence_at),
    claim_id TEXT NOT NULL
);
