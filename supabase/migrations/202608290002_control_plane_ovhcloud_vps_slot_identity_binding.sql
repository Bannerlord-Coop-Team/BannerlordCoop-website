begin;

alter table control_plane.hosting_ovhcloud_vps_prepared_slots
    add column bound_server_id text;

alter table control_plane.hosting_ovhcloud_vps_prepared_slots
    add column bound_resource_generation_id text;

update control_plane.hosting_ovhcloud_vps_prepared_slots
set bound_server_id = server_id,
    bound_resource_generation_id = resource_generation_id;

alter table control_plane.hosting_ovhcloud_vps_prepared_slots
    alter column bound_server_id set not null,
    alter column bound_resource_generation_id set not null,
    add constraint hosting_ovhcloud_vps_prepared_slots_bound_server_id_check
        check (length(bound_server_id) = 36 and server_id = bound_server_id),
    add constraint hosting_ovhcloud_vps_prepared_slots_bound_generation_id_check
        check (
            length(bound_resource_generation_id) = 36
            and resource_generation_id = bound_resource_generation_id
        );

create function control_plane.hosting_ovhcloud_vps_prepared_slots_identity_immutable_function()
returns trigger
language plpgsql
set search_path = control_plane, public
as $trigger$
begin
  if new.server_id is distinct from old.server_id
    or new.resource_generation_id is distinct from old.resource_generation_id
    or new.bound_server_id is distinct from old.bound_server_id
    or new.bound_resource_generation_id is distinct from old.bound_resource_generation_id
  then
    raise exception using
      errcode = '23514',
      message = 'OVHcloud VPS prepared-slot identity binding is immutable';
  end if;
  return new;
end;
$trigger$;

create trigger hosting_ovhcloud_vps_prepared_slots_identity_update
before update of server_id, resource_generation_id,
    bound_server_id, bound_resource_generation_id
on control_plane.hosting_ovhcloud_vps_prepared_slots
for each row execute function
    control_plane.hosting_ovhcloud_vps_prepared_slots_identity_immutable_function();

revoke all on function
    control_plane.hosting_ovhcloud_vps_prepared_slots_identity_immutable_function()
    from public;
grant execute on function
    control_plane.hosting_ovhcloud_vps_prepared_slots_identity_immutable_function()
    to bannerlord_control_plane_runtime;

insert into control_plane.schema_migrations (version, applied_at)
values ('075_managed_hosting_ovhcloud_vps_slot_identity_binding.sql', '2026-08-29T00:00:01.000Z');

commit;
