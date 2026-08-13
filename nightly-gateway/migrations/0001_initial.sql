PRAGMA foreign_keys = ON;

CREATE TABLE device_sessions (
  id TEXT PRIMARY KEY,
  device_secret_hash TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'awaiting-sponsor', 'approved', 'denied', 'consumed')),
  discord_user_id TEXT,
  sponsor_discord_user_id TEXT,
  oauth_state_hash TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  authorized_at INTEGER,
  CHECK (discord_user_id IS NULL OR length(discord_user_id) BETWEEN 17 AND 20),
  CHECK (sponsor_discord_user_id IS NULL OR length(sponsor_discord_user_id) BETWEEN 17 AND 20)
);

CREATE INDEX device_sessions_expiry ON device_sessions(expires_at);

CREATE TABLE supporter_grants (
  supporter_discord_user_id TEXT PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  token_nonce TEXT NOT NULL,
  sponsor_code_hash TEXT UNIQUE,
  updated_at INTEGER NOT NULL,
  CHECK (length(supporter_discord_user_id) BETWEEN 17 AND 20)
);

CREATE TABLE sponsorships (
  supporter_discord_user_id TEXT NOT NULL REFERENCES supporter_grants(supporter_discord_user_id) ON DELETE CASCADE,
  sponsored_discord_user_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (supporter_discord_user_id, sponsored_discord_user_id),
  CHECK (supporter_discord_user_id <> sponsored_discord_user_id),
  CHECK (length(sponsored_discord_user_id) BETWEEN 17 AND 20)
);

CREATE INDEX sponsorships_supporter ON sponsorships(supporter_discord_user_id, created_at);

CREATE TABLE download_sessions (
  token_hash TEXT PRIMARY KEY,
  device_session_id TEXT UNIQUE REFERENCES device_sessions(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  supporter_discord_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (length(discord_user_id) BETWEEN 17 AND 20),
  CHECK (length(supporter_discord_user_id) BETWEEN 17 AND 20)
);

CREATE INDEX download_sessions_expiry ON download_sessions(expires_at);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose = 'sponsor-portal'),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE sponsor_sessions (
  token_hash TEXT PRIMARY KEY,
  supporter_discord_user_id TEXT NOT NULL REFERENCES supporter_grants(supporter_discord_user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
