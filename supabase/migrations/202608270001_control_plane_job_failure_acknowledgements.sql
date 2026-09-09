create table control_plane.hosting_job_failure_acknowledgements (
    acknowledgement_id text PRIMARY KEY CHECK (length(acknowledgement_id) = 36),
    job_id text NOT NULL REFERENCES control_plane.hosting_jobs(job_id) ON DELETE CASCADE,
    failure_updated_at text NOT NULL,
    acknowledged_by text NOT NULL CHECK (
        length(acknowledged_by) BETWEEN 17 AND 20
        AND acknowledged_by !~ '[^0-9]'
    ),
    reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
    correlation_id text NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 128),
    acknowledged_at text NOT NULL,
    UNIQUE (job_id, failure_updated_at)
);

create index hosting_job_failure_acknowledgements_job_idx
    on control_plane.hosting_job_failure_acknowledgements (job_id, failure_updated_at);

revoke all on table control_plane.hosting_job_failure_acknowledgements from public;
revoke all on table control_plane.hosting_job_failure_acknowledgements from anon;
revoke all on table control_plane.hosting_job_failure_acknowledgements from authenticated;
revoke all on table control_plane.hosting_job_failure_acknowledgements
    from bannerlord_control_plane_runtime;
grant select, insert on table control_plane.hosting_job_failure_acknowledgements
    to bannerlord_control_plane_runtime;
