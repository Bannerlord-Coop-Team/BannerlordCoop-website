create
extension if not exists pgcrypto;

create table public.community_servers
(
    id                uuid primary key     default gen_random_uuid(),
    slug              text        not null unique,
    name              text        not null,
    region            text        not null,
    mode              text        not null default 'Campaign',

    connection_type   text        not null
        check (connection_type in ('Direct', 'Steam')),

    address           text,
    port              integer
        check (port between 1 and 65535),

    steam_server_id   text,

    mod_version       text        not null,
    password_required boolean     not null default false,

    connected_players integer     not null default 0
        check (connected_players >= 0),

    max_players       integer     not null default 8
        check (max_players > 0),

    public            boolean     not null default true,
    enabled           boolean     not null default true,

    secret_hash       text        not null,

    last_seen_at      timestamptz not null default now(),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    check (connected_players <= max_players),

    check (
        connection_type <> 'Direct'
            or (
            address is not null
                and length(trim(address)) > 0
                and port is not null
            )
        ),

    check (
        connection_type <> 'Steam'
            or (
            steam_server_id is not null
                and steam_server_id ~ '^[0-9]{1,20}$'
            )
        ),

    check (char_length(slug) between 3 and 64),
    check (slug ~ '^[a-z0-9_-]+$'
) ,
    check (char_length(name) between 1 and 80),
    check (char_length(region) between 1 and 40),
    check (char_length(mode) between 1 and 40),
    check (char_length(mod_version) between 1 and 80)
);

create index community_servers_last_seen_idx
    on public.community_servers (last_seen_at desc);

create index community_servers_public_live_idx
    on public.community_servers (public, enabled, last_seen_at desc);

alter table public.community_servers enable row level security;

create
policy "Anyone can read enabled public servers"
on public.community_servers
for
select
    to anon, authenticated
    using (
    public = true
    and enabled = true
    );

revoke insert, update, delete
    on public.community_servers
    from anon, authenticated;

create
or replace function public.community_server_heartbeat(
    heartbeat_slug text,
    heartbeat_secret text,
    heartbeat_name text,
    heartbeat_region text,
    heartbeat_mode text,
    heartbeat_connection_type text,
    heartbeat_address text,
    heartbeat_port integer,
    heartbeat_steam_server_id text,
    heartbeat_mod_version text,
    heartbeat_password_required boolean,
    heartbeat_connected_players integer,
    heartbeat_max_players integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
affected_rows integer;
begin
update public.community_servers
set name              = heartbeat_name,
    region            = heartbeat_region,
    mode              = heartbeat_mode,
    connection_type   = heartbeat_connection_type,
    address           = heartbeat_address,
    port              = heartbeat_port,
    steam_server_id   = heartbeat_steam_server_id,
    mod_version       = heartbeat_mod_version,
    password_required = heartbeat_password_required,
    connected_players = heartbeat_connected_players,
    max_players       = heartbeat_max_players,
    last_seen_at      = now(),
    updated_at        = now()
where slug = heartbeat_slug
  and enabled = true
  and secret_hash = crypt(
        heartbeat_secret,
        secret_hash
                    );

get diagnostics affected_rows = row_count;

return affected_rows = 1;
end;
$$;

revoke all
    on function public.community_server_heartbeat(
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    integer,
    text,
    text,
    boolean,
    integer,
    integer
    )
    from public, anon, authenticated;