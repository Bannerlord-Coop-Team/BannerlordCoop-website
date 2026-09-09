create table control_plane.hosting_ovhcloud_vps_runner_onboardings (
    service_name text PRIMARY KEY REFERENCES control_plane.hosting_ovhcloud_vps_hosts(service_name) ON DELETE CASCADE,
    request_hash text NOT NULL CHECK (length(request_hash) = 64),
    host_public_key text NOT NULL CHECK (length(host_public_key) BETWEEN 80 AND 512),
    host_key_sha256 text NOT NULL CHECK (length(host_key_sha256) BETWEEN 50 AND 64),
    requested_by text NOT NULL CHECK (
        length(requested_by) BETWEEN 17 AND 20 AND requested_by !~ '[^0-9]'
    ),
    reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
    correlation_id text NOT NULL UNIQUE CHECK (length(correlation_id) BETWEEN 1 AND 128),
    state text NOT NULL CHECK (state IN ('queued', 'running', 'retry-wait', 'succeeded', 'failed')),
    progress_stage text NOT NULL CHECK (length(progress_stage) BETWEEN 1 AND 128),
    attempt_count bigint NOT NULL CHECK (attempt_count BETWEEN 0 AND 10),
    maximum_attempts bigint NOT NULL CHECK (maximum_attempts BETWEEN 1 AND 10),
    run_at text NOT NULL,
    timeout_at text NOT NULL,
    lease_owner text,
    lease_until text,
    error_code text CHECK (error_code IS NULL OR (length(error_code) BETWEEN 1 AND 64 AND error_code !~ '[^a-z0-9_-]')),
    source_commit text CHECK (source_commit IS NULL OR (length(source_commit) = 40 AND source_commit !~ '[^a-f0-9]')),
    created_at text NOT NULL,
    updated_at text NOT NULL,
    completed_at text,
    CHECK ((state = 'running' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL) OR (state != 'running' AND lease_owner IS NULL AND lease_until IS NULL)),
    CHECK ((state IN ('queued', 'running', 'retry-wait') AND completed_at IS NULL) OR (state IN ('succeeded', 'failed') AND completed_at IS NOT NULL))
);

create index hosting_ovhcloud_vps_runner_onboardings_queue_idx
    on control_plane.hosting_ovhcloud_vps_runner_onboardings (state, run_at, created_at, service_name);

create table control_plane.hosting_ovhcloud_vps_prepared_slots (
    service_name text NOT NULL REFERENCES control_plane.hosting_ovhcloud_vps_hosts(service_name) ON DELETE CASCADE,
    slot_index bigint NOT NULL CHECK (slot_index BETWEEN 0 AND 31),
    server_id text NOT NULL UNIQUE CHECK (length(server_id) = 36),
    resource_generation_id text NOT NULL UNIQUE CHECK (length(resource_generation_id) = 36),
    state text NOT NULL CHECK (state IN ('preparing', 'ready', 'reserved', 'assigned', 'failed')),
    progress_stage text NOT NULL CHECK (length(progress_stage) BETWEEN 1 AND 128),
    error_code text CHECK (error_code IS NULL OR (length(error_code) BETWEEN 1 AND 64 AND error_code !~ '[^a-z0-9_-]')),
    created_at text NOT NULL,
    updated_at text NOT NULL,
    PRIMARY KEY (service_name, slot_index)
);

create table control_plane.hosting_admin_ovhcloud_vps_create_reservations (
    correlation_id text PRIMARY KEY CHECK (length(correlation_id) BETWEEN 1 AND 128),
    request_hash text NOT NULL CHECK (length(request_hash) = 64),
    service_name text NOT NULL,
    slot_index bigint NOT NULL,
    server_id text NOT NULL UNIQUE,
    resource_generation_id text NOT NULL UNIQUE,
    created_at text NOT NULL,
    FOREIGN KEY (service_name, slot_index)
        REFERENCES control_plane.hosting_ovhcloud_vps_prepared_slots(service_name, slot_index)
);

revoke all on table control_plane.hosting_ovhcloud_vps_runner_onboardings from public, anon, authenticated;
revoke all on table control_plane.hosting_ovhcloud_vps_prepared_slots from public, anon, authenticated;
revoke all on table control_plane.hosting_admin_ovhcloud_vps_create_reservations from public, anon, authenticated;
revoke all on table control_plane.hosting_ovhcloud_vps_runner_onboardings from bannerlord_control_plane_runtime;
revoke all on table control_plane.hosting_ovhcloud_vps_prepared_slots from bannerlord_control_plane_runtime;
revoke all on table control_plane.hosting_admin_ovhcloud_vps_create_reservations from bannerlord_control_plane_runtime;
grant select, insert, update on table control_plane.hosting_ovhcloud_vps_runner_onboardings to bannerlord_control_plane_runtime;
grant select, insert, update on table control_plane.hosting_ovhcloud_vps_prepared_slots to bannerlord_control_plane_runtime;
grant select, insert on table control_plane.hosting_admin_ovhcloud_vps_create_reservations to bannerlord_control_plane_runtime;
