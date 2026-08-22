PRAGMA foreign_keys = ON;

CREATE TABLE installer_pins (
  token_hash TEXT PRIMARY KEY,
  build_id TEXT NOT NULL UNIQUE,
  client_sha TEXT NOT NULL,
  server_sha TEXT NOT NULL,
  client_file_name TEXT NOT NULL,
  client_bytes INTEGER NOT NULL,
  client_sha256 TEXT NOT NULL,
  server_file_name TEXT NOT NULL,
  server_key TEXT NOT NULL,
  server_public_url TEXT NOT NULL,
  server_bytes INTEGER NOT NULL,
  server_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  CHECK (length(build_id) BETWEEN 17 AND 20),
  CHECK (length(client_sha) = 40),
  CHECK (length(server_sha) = 40),
  CHECK (client_file_name = 'Coop.7z'),
  CHECK (client_bytes > 0 AND client_bytes <= 8388608),
  CHECK (length(client_sha256) = 64),
  CHECK (server_bytes > 0 AND server_bytes <= 6442450944),
  CHECK (length(server_sha256) = 64),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX installer_pins_expiry ON installer_pins(expires_at);

CREATE TABLE pin_download_sessions (
  token_hash TEXT PRIMARY KEY,
  pin_token_hash TEXT NOT NULL REFERENCES installer_pins(token_hash),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX pin_download_sessions_pin ON pin_download_sessions(pin_token_hash);
CREATE INDEX pin_download_sessions_expiry ON pin_download_sessions(expires_at);
