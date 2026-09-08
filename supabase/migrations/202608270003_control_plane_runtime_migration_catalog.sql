begin;

insert into control_plane.schema_migrations (version, applied_at)
values ('072_managed_hosting_job_failure_acknowledgements.sql', '2026-08-27T00:00:00.000Z')
on conflict (version) do nothing;

insert into control_plane.schema_migrations (version, applied_at)
values ('073_managed_hosting_ovhcloud_vps_runner_onboarding.sql', '2026-08-27T00:00:00.000Z')
on conflict (version) do nothing;

commit;
