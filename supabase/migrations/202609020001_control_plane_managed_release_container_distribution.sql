begin;

alter table control_plane.release_builds
  add column distribution text NOT NULL DEFAULT 'archive-v1'
    CHECK (distribution IN ('archive-v1', 'ghcr-container-v1')),
  add column client_artifact_file_name text,
  add column client_artifact_bucket text,
  add column client_artifact_key text,
  add column client_artifact_byte_size bigint,
  add column client_artifact_sha256 text,
  add column container_repository text,
  add column container_manifest_digest text,
  add column container_digest_reference text,
  add column container_immutable_reference text,
  alter column artifact_location drop not null,
  alter column artifact_byte_size drop not null,
  alter column artifact_sha256 drop not null;

alter table control_plane.release_builds
  alter column distribution drop default,
  add constraint release_builds_client_artifact_file_name_check CHECK (
    client_artifact_file_name IS NULL OR length(client_artifact_file_name) BETWEEN 1 AND 200
  ),
  add constraint release_builds_client_artifact_bucket_check CHECK (
    client_artifact_bucket IS NULL OR length(client_artifact_bucket) BETWEEN 1 AND 128
  ),
  add constraint release_builds_client_artifact_key_check CHECK (
    client_artifact_key IS NULL OR length(client_artifact_key) BETWEEN 1 AND 1024
  ),
  add constraint release_builds_client_artifact_byte_size_check CHECK (
    client_artifact_byte_size IS NULL OR client_artifact_byte_size BETWEEN 1 AND 8388608
  ),
  add constraint release_builds_client_artifact_sha256_check CHECK (
    client_artifact_sha256 IS NULL OR (
      length(client_artifact_sha256) = 64 AND client_artifact_sha256 !~ '[^0-9a-f]'
    )
  ),
  add constraint release_builds_container_repository_check CHECK (
    container_repository IS NULL OR length(container_repository) BETWEEN 1 AND 256
  ),
  add constraint release_builds_container_manifest_digest_check CHECK (
    container_manifest_digest IS NULL OR length(container_manifest_digest) = 71
  ),
  add constraint release_builds_container_digest_reference_check CHECK (
    container_digest_reference IS NULL OR length(container_digest_reference) BETWEEN 1 AND 384
  ),
  add constraint release_builds_container_immutable_reference_check CHECK (
    container_immutable_reference IS NULL OR length(container_immutable_reference) BETWEEN 1 AND 512
  ),
  add constraint release_builds_distribution_shape_check CHECK (
    (
      distribution = 'archive-v1'
      AND artifact_location IS NOT NULL
      AND artifact_byte_size IS NOT NULL
      AND artifact_sha256 IS NOT NULL
      AND client_artifact_file_name IS NULL
      AND client_artifact_bucket IS NULL
      AND client_artifact_key IS NULL
      AND client_artifact_byte_size IS NULL
      AND client_artifact_sha256 IS NULL
      AND container_repository IS NULL
      AND container_manifest_digest IS NULL
      AND container_digest_reference IS NULL
      AND container_immutable_reference IS NULL
    ) OR (
      distribution = 'ghcr-container-v1'
      AND artifact_location IS NULL
      AND artifact_byte_size IS NULL
      AND artifact_sha256 IS NULL
      AND artifact_signature IS NULL
      AND client_artifact_file_name IS NOT NULL
      AND client_artifact_bucket IS NOT NULL
      AND client_artifact_key IS NOT NULL
      AND client_artifact_byte_size IS NOT NULL
      AND client_artifact_sha256 IS NOT NULL
      AND container_repository IS NOT NULL
      AND container_manifest_digest IS NOT NULL
      AND container_digest_reference IS NOT NULL
      AND container_immutable_reference IS NOT NULL
    )
  );

create or replace function control_plane.release_builds_immutable_manifest_function()
returns trigger
language plpgsql
set search_path = control_plane, public
as $trigger$
begin
  if OLD.build_id IS DISTINCT FROM NEW.build_id
    OR OLD.channel IS DISTINCT FROM NEW.channel
    OR OLD.distribution IS DISTINCT FROM NEW.distribution
    OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.source_revision IS DISTINCT FROM NEW.source_revision
    OR OLD.supported_game_version IS DISTINCT FROM NEW.supported_game_version
    OR OLD.required_client_mod_version IS DISTINCT FROM NEW.required_client_mod_version
    OR OLD.artifact_location IS DISTINCT FROM NEW.artifact_location
    OR OLD.artifact_byte_size IS DISTINCT FROM NEW.artifact_byte_size
    OR OLD.artifact_sha256 IS DISTINCT FROM NEW.artifact_sha256
    OR OLD.artifact_signature IS DISTINCT FROM NEW.artifact_signature
    OR OLD.client_artifact_file_name IS DISTINCT FROM NEW.client_artifact_file_name
    OR OLD.client_artifact_bucket IS DISTINCT FROM NEW.client_artifact_bucket
    OR OLD.client_artifact_key IS DISTINCT FROM NEW.client_artifact_key
    OR OLD.client_artifact_byte_size IS DISTINCT FROM NEW.client_artifact_byte_size
    OR OLD.client_artifact_sha256 IS DISTINCT FROM NEW.client_artifact_sha256
    OR OLD.container_repository IS DISTINCT FROM NEW.container_repository
    OR OLD.container_manifest_digest IS DISTINCT FROM NEW.container_manifest_digest
    OR OLD.container_digest_reference IS DISTINCT FROM NEW.container_digest_reference
    OR OLD.container_immutable_reference IS DISTINCT FROM NEW.container_immutable_reference
    OR OLD.compatibility_notes IS DISTINCT FROM NEW.compatibility_notes
    OR OLD.published_at IS DISTINCT FROM NEW.published_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at then
    raise exception using errcode = '23514', message = 'release build manifests are immutable';
  end if;
  return new;
end;
$trigger$;

insert into control_plane.schema_migrations (version, applied_at)
values ('077_managed_release_container_distribution.sql', '2026-09-02T00:00:00.000Z');

commit;
