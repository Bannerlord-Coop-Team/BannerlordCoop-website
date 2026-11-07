-- Nightlies no longer post directly to Discord, which was the only reason for the
-- 8 MiB client archive limit. Keep the positive size check and drop the upper bound.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- "if exists" because a repo that mirrors this file may not create the gateway schema.
alter table if exists nightly_gateway.installer_pins
  drop constraint if exists installer_pins_client_bytes,
  add constraint installer_pins_client_bytes check (client_bytes >= 1);

alter table if exists control_plane.release_builds
  drop constraint if exists release_builds_client_artifact_byte_size_check,
  add constraint release_builds_client_artifact_byte_size_check check (
    client_artifact_byte_size is null or client_artifact_byte_size >= 1
  );

commit;
