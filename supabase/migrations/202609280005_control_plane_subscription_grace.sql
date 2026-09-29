BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE control_plane.hosting_subscription_grace (
    server_id TEXT PRIMARY KEY REFERENCES control_plane.managed_servers(server_id),
    account_id TEXT NOT NULL CHECK (length(account_id) = 36),
    campaign_id TEXT NOT NULL CHECK (length(campaign_id) BETWEEN 1 AND 32),
    owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 17 AND 20),
    patreon_user_id TEXT NOT NULL CHECK (length(patreon_user_id) BETWEEN 1 AND 32),
    link_generation TEXT NOT NULL CHECK (length(link_generation) BETWEEN 1 AND 20),
    grace_id TEXT CHECK (grace_id IS NULL OR length(grace_id) = 36),
    ended_at TEXT CHECK (ended_at IS NULL OR length(ended_at) = 24),
    due_at TEXT CHECK (due_at IS NULL OR length(due_at) = 24),
    job_id TEXT CHECK (job_id IS NULL OR length(job_id) = 36),
    attempt_revision TEXT CHECK (attempt_revision IS NULL OR length(attempt_revision) BETWEEN 1 AND 20),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((job_id IS NULL AND attempt_revision IS NULL) OR (job_id IS NOT NULL AND attempt_revision IS NOT NULL)),
    CHECK ((grace_id IS NULL AND ended_at IS NULL AND due_at IS NULL AND job_id IS NULL)
        OR (grace_id IS NOT NULL AND ended_at IS NOT NULL AND due_at IS NOT NULL AND due_at > ended_at))
);
CREATE INDEX hosting_subscription_grace_due ON control_plane.hosting_subscription_grace(due_at, server_id);
ALTER TABLE control_plane.hosting_subscription_grace ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON control_plane.hosting_subscription_grace FROM PUBLIC, anon, authenticated, bannerlord_control_plane_runtime;
CREATE POLICY runtime_subscription_grace ON control_plane.hosting_subscription_grace
    TO bannerlord_control_plane_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON control_plane.hosting_subscription_grace TO bannerlord_control_plane_runtime;
INSERT INTO control_plane.schema_migrations(version, applied_at)
VALUES ('090_managed_hosting_subscription_grace.sql', '2026-09-28T00:05:00.000Z');
COMMIT;
