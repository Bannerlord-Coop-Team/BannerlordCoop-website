BEGIN;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM control_plane.managed_release_catalog_v2)
    OR EXISTS (SELECT 1 FROM control_plane.managed_release_catalog_v2_heads) THEN
    RAISE EXCEPTION 'Legacy release catalog contains historical evidence; retirement refused';
  END IF;
END;
$guard$;
DROP TABLE control_plane.managed_release_catalog_v2_heads;
DROP TABLE control_plane.managed_release_catalog_v2;
DROP FUNCTION control_plane.managed_release_catalog_v2_head_delete_function();
DROP FUNCTION control_plane.managed_release_catalog_v2_head_identity_insert_function();
DROP FUNCTION control_plane.managed_release_catalog_v2_head_monotonic_update_function();
DROP FUNCTION control_plane.managed_release_catalog_v2_immutable_delete_function();
DROP FUNCTION control_plane.managed_release_catalog_v2_immutable_update_function();
DROP FUNCTION control_plane.managed_release_catalog_v2_release_identity_insert_function();
ALTER TABLE control_plane.release_builds DROP CONSTRAINT release_builds_distribution_shape_check;
ALTER TABLE control_plane.release_builds ADD CONSTRAINT release_builds_distribution_shape_check CHECK (
  (distribution = 'archive-v1'
   AND artifact_location IS NOT NULL AND artifact_byte_size IS NOT NULL AND artifact_sha256 IS NOT NULL
   AND client_artifact_file_name IS NULL AND client_artifact_bucket IS NULL AND client_artifact_key IS NULL
   AND client_artifact_byte_size IS NULL AND client_artifact_sha256 IS NULL
   AND container_repository IS NULL AND container_manifest_digest IS NULL
   AND container_digest_reference IS NULL AND container_immutable_reference IS NULL)
  OR (distribution = 'ghcr-container-v1'
   AND artifact_location IS NULL AND artifact_byte_size IS NULL AND artifact_sha256 IS NULL AND artifact_signature IS NULL
   AND container_repository IS NOT NULL AND container_manifest_digest IS NOT NULL
   AND container_digest_reference IS NOT NULL AND container_immutable_reference IS NOT NULL
   AND ((client_artifact_file_name IS NOT NULL AND client_artifact_bucket IS NOT NULL AND client_artifact_key IS NOT NULL
     AND client_artifact_byte_size IS NOT NULL AND client_artifact_sha256 IS NOT NULL)
    OR (source_revision = 'registry-observed'
     AND client_artifact_file_name IS NULL AND client_artifact_bucket IS NULL AND client_artifact_key IS NULL
     AND client_artifact_byte_size IS NULL AND client_artifact_sha256 IS NULL)))
);
INSERT INTO control_plane.schema_migrations (version, applied_at)
VALUES ('087_managed_hosting_ghcr_catalog.sql', '2026-09-22T00:00:00.000Z');
COMMIT;
