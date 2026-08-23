create or replace function public.community_server_heartbeat(
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
    set
        name = heartbeat_name,
        region = heartbeat_region,
        mode = heartbeat_mode,
        connection_type = heartbeat_connection_type,
        address = heartbeat_address,
        port = heartbeat_port,
        steam_server_id = heartbeat_steam_server_id,
        mod_version = heartbeat_mod_version,
        password_required = heartbeat_password_required,
        connected_players = heartbeat_connected_players,
        max_players = heartbeat_max_players,
        last_seen_at = now(),
        updated_at = now()
    where slug = heartbeat_slug
      and enabled = true
      and secret_hash = extensions.crypt(
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

grant execute
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
to service_role;