begin;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE control_plane.managed_servers ADD COLUMN visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public'));

create table control_plane.hosting_server_visibility_receipts (
    request_id text primary key check (request_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
    server_id text not null references control_plane.managed_servers(server_id),
    actor_id text not null check (actor_id ~ '^[0-9]{17,20}$'),
    request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
    visibility text not null check (visibility in ('private', 'public')),
    updated_at text not null check (length(updated_at) = 24)
);

alter table control_plane.hosting_server_visibility_receipts enable row level security;
revoke all on table control_plane.hosting_server_visibility_receipts from public, anon, authenticated,
    bannerlord_control_plane_runtime;
create policy runtime_visibility_receipt_read on control_plane.hosting_server_visibility_receipts for select
    to bannerlord_control_plane_runtime using (true);
create policy runtime_visibility_receipt_insert on control_plane.hosting_server_visibility_receipts for insert
    to bannerlord_control_plane_runtime with check (true);
grant select, insert on table control_plane.hosting_server_visibility_receipts to bannerlord_control_plane_runtime;

insert into control_plane.schema_migrations (version, applied_at)
values ('085_managed_hosting_server_visibility.sql', '2026-09-13T00:01:00.000Z');
commit;
