BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Adds the owner-facing 'reset-campaign' job action (control plane #297).
ALTER TABLE control_plane.hosting_jobs DROP CONSTRAINT hosting_jobs_action_check;
ALTER TABLE control_plane.hosting_jobs ADD CONSTRAINT hosting_jobs_action_check CHECK (action IN (
    'provision', 'start', 'stop', 'restart-game', 'reboot-vm', 'force-stop',
    'delete', 'role-removal-delete', 'update', 'rollback', 'import-save',
    'export-save', 'delete-save', 'export-data', 'backup', 'restore',
    'reconcile', 'suspend', 'reactivate', 'transfer', 'resize', 'rebuild',
    'migrate-region', 'reset-password', 'console-command', 'reset-campaign'
));

INSERT INTO control_plane.schema_migrations (version, applied_at)
VALUES ('093_managed_hosting_campaign_reset.sql', '2026-10-02T15:00:00.000Z')
ON CONFLICT (version) DO NOTHING;
COMMIT;
