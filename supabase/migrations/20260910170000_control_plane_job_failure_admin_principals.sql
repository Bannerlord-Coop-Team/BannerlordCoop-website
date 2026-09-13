begin;

SET LOCAL lock_timeout = '5s';

SET LOCAL statement_timeout = '60s';

ALTER TABLE control_plane.hosting_job_failure_acknowledgements
    DROP CONSTRAINT hosting_job_failure_acknowledgements_acknowledged_by_check,
    ADD CONSTRAINT hosting_job_failure_acknowledgements_acknowledged_by_check
        CHECK (acknowledged_by ~ '^([0-9]{17,20}|supabase:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');

INSERT INTO control_plane.schema_migrations(version, applied_at)
VALUES ('084_managed_hosting_job_failure_admin_principals.sql', '2026-09-10T00:00:00.000Z');

commit;
