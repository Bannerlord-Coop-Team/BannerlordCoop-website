begin;
ALTER TABLE control_plane.hosting_entitlements ADD COLUMN base_source TEXT NOT NULL DEFAULT 'legacy'
  CHECK (base_source IN ('legacy', 'administrative', 'none'));
CREATE TABLE control_plane.hosting_membership_sources (
  account_id TEXT NOT NULL CHECK (length(account_id) = 36),
  guild_id TEXT NOT NULL CHECK (length(guild_id) BETWEEN 17 AND 20),
  campaign_key TEXT NOT NULL CHECK (length(campaign_key) BETWEEN 1 AND 32),
  discord_user_id TEXT,
  patreon_user_id TEXT,
  link_generation TEXT NOT NULL CHECK (length(link_generation) BETWEEN 1 AND 20),
  revision TEXT NOT NULL CHECK (length(revision) BETWEEN 1 AND 20),
  link_state TEXT NOT NULL CHECK (link_state IN ('linked','unlinked','identity_changed','account_deleted')),
  snapshot_json TEXT NOT NULL CHECK ((snapshot_json IS JSON) AND length(snapshot_json) <= 8192),
  snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
  valid_until TEXT CHECK (valid_until IS NULL OR length(valid_until) = 24),
  updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
  PRIMARY KEY (account_id, campaign_key)
);
CREATE UNIQUE INDEX hosting_membership_patreon_binding ON control_plane.hosting_membership_sources(campaign_key, patreon_user_id)
  WHERE link_state = 'linked' AND patreon_user_id IS NOT NULL;
CREATE UNIQUE INDEX hosting_membership_owner_binding ON control_plane.hosting_membership_sources(guild_id, campaign_key, discord_user_id)
  WHERE link_state = 'linked' AND discord_user_id IS NOT NULL;
CREATE TABLE control_plane.hosting_membership_sync_receipts (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) = 36),
  account_id TEXT NOT NULL CHECK (length(account_id) = 36),
  campaign_key TEXT NOT NULL CHECK (length(campaign_key) BETWEEN 1 AND 32),
  receipt_id TEXT NOT NULL UNIQUE CHECK (length(receipt_id) = 36),
  snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
  outcome TEXT NOT NULL CHECK (outcome IN ('applied','stale','unchanged')),
  created_at TEXT NOT NULL CHECK (length(created_at) = 24),
  FOREIGN KEY (account_id, campaign_key) REFERENCES control_plane.hosting_membership_sources(account_id, campaign_key)
);

ALTER TABLE control_plane.hosting_membership_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.hosting_membership_sync_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON control_plane.hosting_membership_sources, control_plane.hosting_membership_sync_receipts FROM public, anon, authenticated, bannerlord_control_plane_runtime;
CREATE POLICY runtime_source ON control_plane.hosting_membership_sources TO bannerlord_control_plane_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_membership_receipt_read ON control_plane.hosting_membership_sync_receipts FOR SELECT TO bannerlord_control_plane_runtime USING (true);
CREATE POLICY runtime_membership_receipt_insert ON control_plane.hosting_membership_sync_receipts FOR INSERT TO bannerlord_control_plane_runtime WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON control_plane.hosting_membership_sources TO bannerlord_control_plane_runtime;
GRANT SELECT, INSERT ON control_plane.hosting_membership_sync_receipts TO bannerlord_control_plane_runtime;
INSERT INTO control_plane.schema_migrations(version, applied_at)
VALUES ('080_managed_hosting_membership_sources.sql', '2026-09-08T00:00:00.000Z');
commit;
