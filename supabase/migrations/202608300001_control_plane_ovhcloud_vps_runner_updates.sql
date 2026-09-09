begin;

create table control_plane.hosting_ovhcloud_vps_runner_updates (
    correlation_id text PRIMARY KEY CHECK (length(correlation_id) BETWEEN 1 AND 128),
    service_name text NOT NULL REFERENCES control_plane.hosting_ovhcloud_vps_hosts(service_name) ON DELETE CASCADE,
    request_hash text NOT NULL CHECK (length(request_hash) = 64),
    target_source_commit text NOT NULL CHECK (length(target_source_commit) = 40 AND target_source_commit !~ '[^a-f0-9]'),
    prior_source_commit text NOT NULL CHECK (length(prior_source_commit) = 40 AND prior_source_commit !~ '[^a-f0-9]'),
    requested_by text NOT NULL CHECK (length(requested_by) BETWEEN 17 AND 20 AND requested_by !~ '[^0-9]'),
    reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
    state text NOT NULL CHECK (state IN ('queued', 'running', 'retry-wait', 'succeeded', 'failed')),
    progress_stage text NOT NULL CHECK (length(progress_stage) BETWEEN 1 AND 128),
    baselines_json text CHECK (baselines_json IS NULL OR length(baselines_json) BETWEEN 2 AND 32768),
    attempt_count bigint NOT NULL CHECK (attempt_count BETWEEN 0 AND 10),
    maximum_attempts bigint NOT NULL CHECK (maximum_attempts BETWEEN 1 AND 10),
    run_at text NOT NULL,
    timeout_at text NOT NULL,
    lease_owner text,
    lease_until text,
    error_code text CHECK (error_code IS NULL OR (length(error_code) BETWEEN 1 AND 64 AND error_code !~ '[^a-z0-9_-]')),
    created_at text NOT NULL,
    updated_at text NOT NULL,
    completed_at text,
    CHECK ((state = 'running' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL) OR (state != 'running' AND lease_owner IS NULL AND lease_until IS NULL)),
    CHECK ((state IN ('queued', 'running', 'retry-wait') AND completed_at IS NULL) OR (state IN ('succeeded', 'failed') AND completed_at IS NOT NULL))
);

create unique index hosting_ovhcloud_vps_runner_updates_active_idx
    on control_plane.hosting_ovhcloud_vps_runner_updates (service_name)
    where state IN ('queued', 'running', 'retry-wait');

create index hosting_ovhcloud_vps_runner_updates_queue_idx
    on control_plane.hosting_ovhcloud_vps_runner_updates (state, run_at, created_at, correlation_id);

create index hosting_ovhcloud_vps_runner_updates_host_history_idx
    on control_plane.hosting_ovhcloud_vps_runner_updates (service_name, created_at DESC, correlation_id DESC);

revoke all on table control_plane.hosting_ovhcloud_vps_runner_updates from public, anon, authenticated;
revoke all on table control_plane.hosting_ovhcloud_vps_runner_updates from bannerlord_control_plane_runtime;
grant select, insert, update on table control_plane.hosting_ovhcloud_vps_runner_updates to bannerlord_control_plane_runtime;

insert into control_plane.schema_migrations (version, applied_at)
values ('076_managed_hosting_ovhcloud_vps_runner_updates.sql', '2026-08-30T00:00:00.000Z');

commit;
