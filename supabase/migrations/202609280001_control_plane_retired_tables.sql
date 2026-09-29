BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Pre-production cleanup: retired table contents are intentionally discarded.
DROP TRIGGER registry_release_heads_valid ON control_plane.registry_release_heads;
DROP FUNCTION control_plane.registry_release_heads_valid();
DROP TABLE control_plane.registry_release_heads;
DROP TRIGGER registry_release_observations_guard ON control_plane.registry_release_observations;
DROP FUNCTION control_plane.registry_release_observations_guard();
DROP TABLE control_plane.registry_release_observations;
DROP TRIGGER managed_release_operator_requests_immutable_update ON control_plane.managed_release_operator_requests;
DROP TRIGGER managed_release_operator_requests_immutable_delete ON control_plane.managed_release_operator_requests;
DROP FUNCTION control_plane.managed_release_operator_requests_immutable_update_function();
DROP FUNCTION control_plane.managed_release_operator_requests_immutable_delete_function();
DROP TABLE control_plane.managed_release_operator_requests;
DROP TABLE control_plane.hosting_job_checkpoints;
DROP TABLE control_plane.hosting_owner_onboarding_locks;
INSERT INTO control_plane.schema_migrations (version, applied_at)
VALUES ('089_managed_hosting_retired_tables.sql', '2026-09-28T00:00:00.000Z');
COMMIT;
