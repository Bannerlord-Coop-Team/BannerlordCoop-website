-- Keep one-minute public server freshness without updating the wide historical row.
-- This migration is intentionally append-only. The small backfill is limited to rows
-- that are fresh at cutover, so it does not rewrite the historical statistics table.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.server_telemetry_sessions (
    session_id text primary key,
    server_id text not null,
    mod_version text not null,
    commit_hash text not null,
    started_at timestamptz not null,
    created_at timestamptz not null default now(),
    constraint server_telemetry_sessions_session_id_check check (
        length(session_id) between 1 and 128
        and session_id !~ '[[:cntrl:]]'
    ),
    constraint server_telemetry_sessions_server_id_check check (
        length(server_id) between 1 and 128
        and server_id !~ '[[:cntrl:]]'
    )
);

create table if not exists public.server_presence (
    server_id text primary key,
    session_id text not null,
    session_started_at timestamptz not null,
    player_count integer not null,
    last_seen_at timestamptz not null,
    constraint server_presence_server_id_check check (
        length(server_id) between 1 and 128
        and server_id !~ '[[:cntrl:]]'
    ),
    constraint server_presence_session_id_check check (
        length(session_id) between 1 and 128
        and session_id !~ '[[:cntrl:]]'
    ),
    constraint server_presence_player_count_check check (player_count >= 0)
);

create index if not exists server_presence_last_seen_at_idx
    on public.server_presence (last_seen_at);

alter table public.server_telemetry_sessions enable row level security;
alter table public.server_presence enable row level security;
revoke all on table public.server_telemetry_sessions from public, anon, authenticated;
revoke all on table public.server_presence from public, anon, authenticated;

-- Preserve the current public count during the handoff. Only rows inside the existing
-- two-minute freshness window are copied, and the statements are restart-safe.
insert into public.server_telemetry_sessions (
    session_id,
    server_id,
    mod_version,
    commit_hash,
    started_at,
    created_at
)
select
    stats.session_id,
    'legacy:' || stats.session_id,
    stats.mod_version,
    stats.commit_hash,
    stats.started_at,
    stats.created_at
from public.server_statistics as stats
where stats.updated_at >= now() - interval '2 minutes'
on conflict (session_id) do nothing;

insert into public.server_presence (
    server_id,
    session_id,
    session_started_at,
    player_count,
    last_seen_at
)
select
    'legacy:' || stats.session_id,
    stats.session_id,
    stats.started_at,
    stats.player_count,
    stats.updated_at
from public.server_statistics as stats
where stats.updated_at >= now() - interval '2 minutes'
on conflict (server_id) do update set
    session_id = excluded.session_id,
    session_started_at = excluded.session_started_at,
    player_count = excluded.player_count,
    last_seen_at = excluded.last_seen_at
where excluded.session_started_at >= public.server_presence.session_started_at;

-- Existing clients keep calling this RPC. They now write the narrow compatibility
-- presence row, so the wide server_statistics row stops receiving minute-by-minute
-- updates immediately after this migration.
create or replace function public.report_server_statistics(
    p_session_id text,
    p_mod_version text,
    p_commit_hash text,
    p_started_at timestamptz,
    p_player_count integer
)
returns text
language sql
security definer
set search_path to ''
as $function$
    with session_row as (
        insert into public.server_telemetry_sessions (
            session_id,
            server_id,
            mod_version,
            commit_hash,
            started_at
        )
        values (
            p_session_id,
            'legacy:' || p_session_id,
            p_mod_version,
            p_commit_hash,
            p_started_at
        )
        on conflict (session_id) do nothing
    ), presence_row as (
        insert into public.server_presence (
            server_id,
            session_id,
            session_started_at,
            player_count,
            last_seen_at
        )
        values (
            'legacy:' || p_session_id,
            p_session_id,
            p_started_at,
            p_player_count,
            now()
        )
        on conflict (server_id) do update set
            session_id = excluded.session_id,
            session_started_at = excluded.session_started_at,
            player_count = excluded.player_count,
            last_seen_at = excluded.last_seen_at
        where excluded.session_started_at >= public.server_presence.session_started_at
    )
    select p_session_id;
$function$;

-- New clients provide a stable installation identity. Session metadata is inserted once;
-- only the narrow presence row changes on the one-minute heartbeat.
create or replace function public.report_server_presence(
    p_server_id text,
    p_session_id text,
    p_mod_version text,
    p_commit_hash text,
    p_started_at timestamptz,
    p_player_count integer
)
returns text
language sql
security definer
set search_path to ''
as $function$
    with session_row as (
        insert into public.server_telemetry_sessions (
            session_id,
            server_id,
            mod_version,
            commit_hash,
            started_at
        )
        values (
            p_session_id,
            p_server_id,
            p_mod_version,
            p_commit_hash,
            p_started_at
        )
        on conflict (session_id) do nothing
    ), presence_row as (
        insert into public.server_presence (
            server_id,
            session_id,
            session_started_at,
            player_count,
            last_seen_at
        )
        values (
            p_server_id,
            p_session_id,
            p_started_at,
            p_player_count,
            now()
        )
        on conflict (server_id) do update set
            session_id = excluded.session_id,
            session_started_at = excluded.session_started_at,
            player_count = excluded.player_count,
            last_seen_at = excluded.last_seen_at
        where excluded.session_started_at >= public.server_presence.session_started_at
    )
    select p_server_id;
$function$;

create or replace function public.get_network_stats()
returns table(server_count bigint, player_count bigint)
language sql
stable
security definer
set search_path to ''
as $function$
    select
        count(*)::bigint as server_count,
        coalesce(sum(presence.player_count), 0)::bigint as player_count
    from public.server_presence as presence
    where presence.last_seen_at >= now() - interval '2 minutes';
$function$;

revoke all on function public.report_server_presence(text, text, text, text, timestamptz, integer) from public;
grant execute on function public.report_server_presence(text, text, text, text, timestamptz, integer) to anon, service_role;
