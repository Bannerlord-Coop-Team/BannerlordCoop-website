begin;

-- Constraint expansion only: no durable values or request/audit evidence are rewritten.
alter table control_plane.managed_servers
  drop constraint managed_servers_friendly_region_check,
  add constraint managed_servers_friendly_region_check CHECK (friendly_region IN (
        'us-west', 'us-east', 'france', 'germany', 'united-kingdom', 'poland',
        'spain', 'united-states', 'europe-automatic'
  ));

alter table control_plane.hosting_ovhcloud_vps_hosts
  drop constraint hosting_ovhcloud_vps_hosts_friendly_region_check,
  add constraint hosting_ovhcloud_vps_hosts_friendly_region_check CHECK (friendly_region IN (
        'us-west', 'us-east', 'france', 'germany', 'united-kingdom', 'poland',
        'spain', 'united-states', 'europe-automatic'
  ));

insert into control_plane.schema_migrations (version, applied_at)
values ('078_managed_hosting_regions.sql', '2026-09-03T00:00:00.000Z');

commit;
