BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $migration$
DECLARE
    matching_rows INTEGER;
BEGIN
    SELECT COUNT(*) INTO matching_rows
    FROM control_plane.release_builds build
    JOIN control_plane.registry_release_authorizations authorization
      ON authorization.build_id = build.build_id
    WHERE ((
        build.build_id = 'ghcr-stable-35b1b6ebeb038a5a69f4ef8a2a84031c3726702452e38874fd4b2f339de92203'
        AND build.version = 'stable-35b1b6ebeb03'
        AND build.container_manifest_digest = 'sha256:35b1b6ebeb038a5a69f4ef8a2a84031c3726702452e38874fd4b2f339de92203'
        AND authorization.manifest_sha256 = 'edb8952a31334e92a98d814a4d0fad69a913c355bd3c5224a82f8c99b1982ecf'
        AND EXISTS (
            SELECT 1 FROM control_plane.registry_release_observations observation
            WHERE observation.channel = 'stable' AND observation.generation = 2
              AND observation.build_id = build.build_id
        )
    ) OR (
        build.build_id = 'ghcr-stable-c995ff97ce3c6cfe1b175f0586f90593892606b4f7ec182c9390b3903dd2d526'
        AND build.version = 'stable-c995ff97ce3c'
        AND build.container_manifest_digest = 'sha256:c995ff97ce3c6cfe1b175f0586f90593892606b4f7ec182c9390b3903dd2d526'
        AND authorization.manifest_sha256 = 'c885bbf506f2bd1ef4e6acd88d23de6221b4657aab4b07897f67af966515adec'
        AND EXISTS (
            SELECT 1 FROM control_plane.registry_release_observations observation
            WHERE observation.channel = 'stable' AND observation.generation = 1
              AND observation.build_id = build.build_id
        )
    ))
    AND build.channel = 'stable'
    AND build.distribution = 'ghcr-container-v1'
    AND build.source_revision = 'registry-observed'
    AND build.supported_game_version = 'unknown'
    AND build.required_client_mod_version = 'v0.1.5'
    AND build.validation_state = 'validated'
    AND authorization.actor_id = 'system:stable-tag-watcher';

    IF matching_rows <> 2 THEN
        RAISE EXCEPTION 'legacy Stable release metadata does not match the reviewed backfill source';
    END IF;
END;
$migration$;

DROP TRIGGER release_builds_immutable_manifest ON control_plane.release_builds;
DROP TRIGGER registry_release_authorizations_immutable ON control_plane.registry_release_authorizations;

UPDATE control_plane.release_builds
SET version = 'v0.1.5', supported_game_version = 'v1.4.8'
WHERE build_id IN (
    'ghcr-stable-35b1b6ebeb038a5a69f4ef8a2a84031c3726702452e38874fd4b2f339de92203',
    'ghcr-stable-c995ff97ce3c6cfe1b175f0586f90593892606b4f7ec182c9390b3903dd2d526'
);

UPDATE control_plane.registry_release_authorizations
SET manifest_sha256 = CASE build_id
    WHEN 'ghcr-stable-35b1b6ebeb038a5a69f4ef8a2a84031c3726702452e38874fd4b2f339de92203'
        THEN '23e72878da68c3ac98d416e24cfe11458beb5a530fd6dfa86e2df9ea1a47104e'
    WHEN 'ghcr-stable-c995ff97ce3c6cfe1b175f0586f90593892606b4f7ec182c9390b3903dd2d526'
        THEN 'd9a1e549dc181018bd83e3d809558a4ce80a7c79bdb8bf5ee36b7647cfa7ba34'
END
WHERE build_id IN (
    'ghcr-stable-35b1b6ebeb038a5a69f4ef8a2a84031c3726702452e38874fd4b2f339de92203',
    'ghcr-stable-c995ff97ce3c6cfe1b175f0586f90593892606b4f7ec182c9390b3903dd2d526'
);

CREATE TRIGGER release_builds_immutable_manifest
BEFORE UPDATE ON control_plane.release_builds
FOR EACH ROW EXECUTE FUNCTION control_plane.release_builds_immutable_manifest_function();

CREATE TRIGGER registry_release_authorizations_immutable
BEFORE UPDATE OR DELETE ON control_plane.registry_release_authorizations
FOR EACH ROW EXECUTE FUNCTION control_plane.registry_release_authorizations_immutable();

DO $migration$
DECLARE
    corrected_rows INTEGER;
BEGIN
    SELECT COUNT(*) INTO corrected_rows
    FROM control_plane.release_builds build
    JOIN control_plane.registry_release_authorizations authorization
      ON authorization.build_id = build.build_id
    WHERE build.version = 'v0.1.5'
      AND build.supported_game_version = 'v1.4.8'
      AND (
        (build.build_id = 'ghcr-stable-35b1b6ebeb038a5a69f4ef8a2a84031c3726702452e38874fd4b2f339de92203'
          AND authorization.manifest_sha256 = '23e72878da68c3ac98d416e24cfe11458beb5a530fd6dfa86e2df9ea1a47104e')
        OR
        (build.build_id = 'ghcr-stable-c995ff97ce3c6cfe1b175f0586f90593892606b4f7ec182c9390b3903dd2d526'
          AND authorization.manifest_sha256 = 'd9a1e549dc181018bd83e3d809558a4ce80a7c79bdb8bf5ee36b7647cfa7ba34')
      );
    IF corrected_rows <> 2 THEN
        RAISE EXCEPTION 'legacy Stable release metadata backfill did not converge';
    END IF;
END;
$migration$;

INSERT INTO control_plane.schema_migrations (version, applied_at)
VALUES ('087_managed_hosting_registry_release_metadata_backfill.sql', '2026-09-20T00:01:00.000Z');
COMMIT;
