begin;

drop index control_plane.managed_servers_provider_resource_idx;

create unique index managed_servers_provider_resource_idx
    on control_plane.managed_servers (provider, provider_resource_id)
    where provider_resource_id is not null and soft_deleted_at is null;

drop index control_plane.hosting_provider_generations_provider_resource_idx;

create unique index hosting_provider_generations_provider_resource_idx
    on control_plane.hosting_provider_resource_generations (provider, provider_resource_id)
    where provider_resource_id is not null and lifecycle_state != 'retired';

insert into control_plane.schema_migrations (version, applied_at)
values ('074_managed_hosting_static_slot_reuse.sql', '2026-08-29T00:00:00.000Z');

commit;
