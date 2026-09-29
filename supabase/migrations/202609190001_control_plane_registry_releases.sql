BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE control_plane.registry_release_authorizations (
    build_id TEXT PRIMARY KEY REFERENCES control_plane.release_builds(build_id),
    manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
    actor_id TEXT NOT NULL,
    observed_at TEXT NOT NULL
);
ALTER TABLE control_plane.registry_release_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON control_plane.registry_release_authorizations FROM PUBLIC, anon, authenticated;
CREATE POLICY registry_release_authorizations_read ON control_plane.registry_release_authorizations
    FOR SELECT TO bannerlord_control_plane_runtime USING (true);
CREATE POLICY registry_release_authorizations_insert ON control_plane.registry_release_authorizations
    FOR INSERT TO bannerlord_control_plane_runtime WITH CHECK (true);
GRANT SELECT, INSERT ON control_plane.registry_release_authorizations TO bannerlord_control_plane_runtime;
CREATE TABLE control_plane.registry_release_observations (
    channel TEXT NOT NULL CHECK (channel IN ('stable', 'nightly')),
    generation INTEGER NOT NULL CHECK (generation > 0),
    build_id TEXT NOT NULL REFERENCES control_plane.release_builds(build_id),
    observed_at TEXT NOT NULL,
    PRIMARY KEY (channel, generation)
);
ALTER TABLE control_plane.registry_release_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON control_plane.registry_release_observations FROM PUBLIC, anon, authenticated;
CREATE POLICY registry_release_observations_read ON control_plane.registry_release_observations
    FOR SELECT TO bannerlord_control_plane_runtime USING (true);
CREATE POLICY registry_release_observations_insert ON control_plane.registry_release_observations
    FOR INSERT TO bannerlord_control_plane_runtime WITH CHECK (true);
GRANT SELECT, INSERT ON control_plane.registry_release_observations TO bannerlord_control_plane_runtime;
CREATE TABLE control_plane.registry_release_heads (
    channel TEXT PRIMARY KEY CHECK (channel IN ('stable', 'nightly')),
    generation INTEGER NOT NULL CHECK (generation > 0),
    build_id TEXT NOT NULL REFERENCES control_plane.release_builds(build_id),
    observed_at TEXT NOT NULL,
    FOREIGN KEY (channel, generation) REFERENCES control_plane.registry_release_observations(channel, generation)
);
ALTER TABLE control_plane.registry_release_heads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON control_plane.registry_release_heads FROM PUBLIC, anon, authenticated;
CREATE POLICY registry_release_heads_read ON control_plane.registry_release_heads
    FOR SELECT TO bannerlord_control_plane_runtime USING (true);
CREATE POLICY registry_release_heads_insert ON control_plane.registry_release_heads
    FOR INSERT TO bannerlord_control_plane_runtime WITH CHECK (true);
CREATE POLICY registry_release_heads_update ON control_plane.registry_release_heads
    FOR UPDATE TO bannerlord_control_plane_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON control_plane.registry_release_heads TO bannerlord_control_plane_runtime;
CREATE FUNCTION control_plane.registry_release_heads_valid() RETURNS trigger
LANGUAGE plpgsql SET search_path = control_plane, public AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM release_builds build
        JOIN registry_release_authorizations proof ON proof.build_id = build.build_id
        JOIN registry_release_observations observation
          ON observation.channel = NEW.channel AND observation.generation = NEW.generation
          AND observation.build_id = NEW.build_id AND observation.observed_at = NEW.observed_at
        WHERE build.build_id = NEW.build_id AND build.channel = NEW.channel
          AND build.validation_state = 'validated' AND build.validated_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'registry release head proof is incomplete';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER registry_release_heads_valid
BEFORE INSERT OR UPDATE ON control_plane.registry_release_heads
FOR EACH ROW EXECUTE FUNCTION control_plane.registry_release_heads_valid();
CREATE FUNCTION control_plane.registry_release_authorizations_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = control_plane, public AS $$
BEGIN
    RAISE EXCEPTION 'registry release authorizations are immutable';
END;
$$;
CREATE TRIGGER registry_release_authorizations_immutable
BEFORE UPDATE OR DELETE ON control_plane.registry_release_authorizations
FOR EACH ROW EXECUTE FUNCTION control_plane.registry_release_authorizations_immutable();
CREATE FUNCTION control_plane.registry_release_observations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = control_plane, public AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'registry release observations are immutable';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM release_builds build
        JOIN registry_release_authorizations proof ON proof.build_id = build.build_id
        WHERE build.build_id = NEW.build_id AND build.channel = NEW.channel
          AND build.validation_state = 'validated' AND build.validated_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'registry release observation proof is incomplete';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER registry_release_observations_guard
BEFORE INSERT OR UPDATE OR DELETE ON control_plane.registry_release_observations
FOR EACH ROW EXECUTE FUNCTION control_plane.registry_release_observations_guard();
create or replace function control_plane.release_builds_validation_proof_function()
returns trigger
language plpgsql
set search_path = control_plane, public
as $trigger$
begin
  if (
        NEW.validation_state = 'validated'
        AND (
            NEW.validated_at IS NULL
            OR (
                NOT EXISTS (
                    SELECT 1 FROM managed_release_receipts receipt
                    WHERE receipt.build_id = NEW.build_id
                )
                AND NOT EXISTS (SELECT 1 FROM registry_release_authorizations proof WHERE proof.build_id = NEW.build_id)
                AND (
                    NEW.verified_at IS NULL
                    OR NEW.validated_at != NEW.verified_at
                    OR NEW.verification_manifest_sha256 IS NULL
                    OR NEW.verification_method IS NULL
                    OR (
                        NEW.verification_method = 'ed25519'
                        AND NEW.verification_key_sha256 IS NULL
                    )
                    OR (
                        NEW.verification_method = 'trusted-synthetic'
                        AND NEW.verification_key_sha256 IS NOT NULL
                    )
                )
            )
        )
    )
    OR (
        NEW.validation_state IN ('pending', 'rejected')
        AND (
            NEW.validated_at IS NOT NULL
            OR NEW.verification_method IS NOT NULL
            OR NEW.verification_manifest_sha256 IS NOT NULL
            OR NEW.verification_key_sha256 IS NOT NULL
            OR NEW.verified_at IS NOT NULL
        )
    )
    OR (
        NEW.validation_state = 'revoked'
        AND (
            NEW.validated_at IS NOT NULL
            OR (
                NOT EXISTS (
                    SELECT 1 FROM managed_release_receipts receipt
                    WHERE receipt.build_id = NEW.build_id
                )
                AND NOT EXISTS (SELECT 1 FROM registry_release_authorizations proof WHERE proof.build_id = NEW.build_id)
                AND (
                    NEW.verified_at IS NULL
                    OR NEW.verification_manifest_sha256 IS NULL
                    OR NEW.verification_method IS NULL
                    OR (
                        NEW.verification_method = 'ed25519'
                        AND NEW.verification_key_sha256 IS NULL
                    )
                    OR (
                        NEW.verification_method = 'trusted-synthetic'
                        AND NEW.verification_key_sha256 IS NOT NULL
                    )
                )
            )
        )
    ) then
    raise exception using errcode = '23514', message = 'release validation proof is incomplete';
  end if;
  return new;
end;
$trigger$;
INSERT INTO control_plane.schema_migrations (version, applied_at)
VALUES ('086_managed_hosting_registry_releases.sql', '2026-09-19T00:01:00.000Z');
COMMIT;
