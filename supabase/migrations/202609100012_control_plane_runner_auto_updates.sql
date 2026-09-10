begin;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE control_plane.hosting_ovhcloud_vps_runner_updates
  DROP CONSTRAINT hosting_ovhcloud_vps_runner_updates_requested_by_check,
  ADD CONSTRAINT hosting_ovhcloud_vps_runner_updates_requested_by_check
  CHECK (requested_by = 'system:runner-updater' OR requested_by ~ '^([0-9]{17,20}|supabase:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
INSERT INTO control_plane.schema_migrations(version, applied_at)
VALUES ('083_managed_hosting_runner_auto_updates.sql', '2026-09-10T00:12:00.000Z')
ON CONFLICT (version) DO NOTHING;
commit;
