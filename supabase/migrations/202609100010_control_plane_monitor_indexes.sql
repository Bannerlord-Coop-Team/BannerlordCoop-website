begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

CREATE INDEX IF NOT EXISTS audit_events_backup_failure_time_idx
  ON control_plane.audit_events (occurred_at, target_server_id)
  WHERE action = 'hosting.backup.failed';

CREATE INDEX IF NOT EXISTS audit_events_infrastructure_sequence_idx
  ON control_plane.audit_events (target_server_id, audit_sequence DESC)
  WHERE action IN ('hosting.job.succeeded', 'hosting.job.failed', 'hosting.job.cancelled')
    AND jsonb_extract_path_text(safe_metadata_json::jsonb, 'action') IN (
      'provision', 'resize', 'rebuild', 'migrate-region', 'transfer'
    );

insert into control_plane.schema_migrations (version, applied_at)
values ('082_managed_hosting_monitor_indexes.sql', '2026-09-10T00:00:00.000Z')
on conflict (version) do nothing;

commit;
