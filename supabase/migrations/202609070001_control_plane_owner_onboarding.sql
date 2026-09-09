begin;

create table control_plane.hosting_owner_onboarding_locks (
    guild_id text primary key check (guild_id ~ '^[0-9]{17,20}$')
);
create table control_plane.hosting_region_requests (
    request_id text primary key check (request_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
    guild_id text not null,
    discord_user_id text not null,
    region text not null check (region in ('us-west', 'us-east', 'france', 'germany', 'united-kingdom', 'poland')),
    status text not null check (status = 'outstanding'),
    created_at text not null check (length(created_at) = 24),
    unique (guild_id, discord_user_id, region),
    foreign key (guild_id, discord_user_id) references control_plane.hosting_entitlements(guild_id, discord_user_id)
);
create table control_plane.hosting_owner_onboarding_receipts (
    request_id text primary key check (request_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
    guild_id text not null,
    discord_user_id text not null,
    action text not null check (action in ('create-server', 'request-region')),
    request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
    result_json text not null check ((result_json IS JSON) and length(result_json) between 2 and 2048),
    created_at text not null check (length(created_at) = 24),
    foreign key (guild_id, discord_user_id) references control_plane.hosting_entitlements(guild_id, discord_user_id)
);
create index hosting_owner_onboarding_receipts_owner_idx
    on control_plane.hosting_owner_onboarding_receipts (guild_id, discord_user_id, created_at);

alter table control_plane.hosting_owner_onboarding_locks enable row level security;
alter table control_plane.hosting_region_requests enable row level security;
alter table control_plane.hosting_owner_onboarding_receipts enable row level security;
revoke all on control_plane.hosting_owner_onboarding_locks, control_plane.hosting_region_requests,
    control_plane.hosting_owner_onboarding_receipts from public, anon, authenticated;
revoke all on control_plane.hosting_owner_onboarding_locks, control_plane.hosting_region_requests,
    control_plane.hosting_owner_onboarding_receipts from bannerlord_control_plane_runtime;
-- Only the trusted private runtime gets policies; browser roles receive none.
create policy runtime_lock on control_plane.hosting_owner_onboarding_locks
    to bannerlord_control_plane_runtime using (true) with check (true);
create policy runtime_request_read on control_plane.hosting_region_requests for select
    to bannerlord_control_plane_runtime using (true);
create policy runtime_request_insert on control_plane.hosting_region_requests for insert
    to bannerlord_control_plane_runtime with check (true);
create policy runtime_receipt_read on control_plane.hosting_owner_onboarding_receipts for select
    to bannerlord_control_plane_runtime using (true);
create policy runtime_receipt_insert on control_plane.hosting_owner_onboarding_receipts for insert
    to bannerlord_control_plane_runtime with check (true);
grant select, insert, update on control_plane.hosting_owner_onboarding_locks to bannerlord_control_plane_runtime;
grant select, insert on control_plane.hosting_region_requests,
    control_plane.hosting_owner_onboarding_receipts to bannerlord_control_plane_runtime;

insert into control_plane.schema_migrations (version, applied_at)
values ('079_managed_hosting_owner_onboarding.sql', '2026-09-07T00:00:00.000Z');
commit;
