begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.release_observations (
    release_id text primary key check (release_id ~ '^(stable|nightly)-[a-f0-9]{64}$'),
    first_observed_at timestamptz not null default now()
);

comment on table public.release_observations is
    'First website observation of each verified GHCR channel/image digest; display metadata only.';

-- Preserve earlier observations retained by verified registry deployment records.
insert into public.release_observations (release_id, first_observed_at)
select build.channel || '-' || substring(build.container_manifest_digest from 8),
       min(build.published_at::timestamptz)
from control_plane.release_builds build
join control_plane.registry_release_authorizations proof on proof.build_id = build.build_id
where build.source_revision = 'registry-observed' and build.distribution = 'ghcr-container-v1'
    and build.container_manifest_digest ~ '^sha256:[a-f0-9]{64}$'
group by build.channel, build.container_manifest_digest;

alter table public.release_observations enable row level security;
revoke all on table public.release_observations from public, anon, authenticated, service_role;
grant select, insert on table public.release_observations to service_role;

commit;
