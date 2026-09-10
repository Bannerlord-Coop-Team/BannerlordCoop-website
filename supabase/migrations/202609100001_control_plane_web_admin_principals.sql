begin;

SET LOCAL lock_timeout = '5s';

SET LOCAL statement_timeout = '60s';

ALTER TABLE control_plane.hosting_owner_announcement_campaigns DROP CONSTRAINT hosting_owner_announcement_campaigns_requested_by_check, ADD CONSTRAINT hosting_owner_announcement_campaigns_requested_by_check CHECK (requested_by ~ '^([0-9]{17,20}|supabase:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');

ALTER TABLE control_plane.hosting_provider_inventory_reviews DROP CONSTRAINT hosting_provider_inventory_reviews_requested_by_check, ADD CONSTRAINT hosting_provider_inventory_reviews_requested_by_check CHECK (requested_by ~ '^([0-9]{17,20}|supabase:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');

ALTER TABLE control_plane.hosting_fleet_operations DROP CONSTRAINT hosting_fleet_operations_requested_by_check, ADD CONSTRAINT hosting_fleet_operations_requested_by_check CHECK (requested_by ~ '^([0-9]{17,20}|supabase:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');

ALTER TABLE control_plane.hosting_ovhcloud_vps_runner_onboardings DROP CONSTRAINT hosting_ovhcloud_vps_runner_onboardings_requested_by_check, ADD CONSTRAINT hosting_ovhcloud_vps_runner_onboardings_requested_by_check CHECK (requested_by ~ '^([0-9]{17,20}|supabase:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');

ALTER TABLE control_plane.hosting_ovhcloud_vps_runner_updates DROP CONSTRAINT hosting_ovhcloud_vps_runner_updates_requested_by_check, ADD CONSTRAINT hosting_ovhcloud_vps_runner_updates_requested_by_check CHECK (requested_by ~ '^([0-9]{17,20}|supabase:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');

ALTER TABLE control_plane.audit_events DROP CONSTRAINT audit_events_actor_type_check, ADD CONSTRAINT audit_events_actor_type_check CHECK (actor_type IN ('discord-user', 'web-user', 'system', 'worker', 'provider', 'agent'));

INSERT INTO control_plane.schema_migrations(version, applied_at) VALUES ('081_managed_hosting_web_admin_principals.sql', '2026-09-10T00:00:00.000Z');

commit;
