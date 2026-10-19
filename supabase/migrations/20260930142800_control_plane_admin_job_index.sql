BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE INDEX IF NOT EXISTS hosting_jobs_admin_page_idx
  ON control_plane.hosting_jobs (created_at DESC, job_id DESC);

INSERT INTO control_plane.schema_migrations (version, applied_at)
VALUES ('092_managed_hosting_admin_job_index.sql', '2026-09-30T14:28:00.000Z')
ON CONFLICT (version) DO NOTHING;
COMMIT;
