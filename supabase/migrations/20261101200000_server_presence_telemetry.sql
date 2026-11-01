begin;

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
    ),
    constraint server_telemetry_sessions_mod_version_check check (
        length(mod_version) between 1 and 128
        and mod_version !~ '[[:cntrl:]]'
    ),
    constraint server_telemetry_sessions_commit_hash_check check (
        length(commit_hash) between 1 and 128
        and commit_hash !~ '[[:cntrl:]]'
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

-- Existing clients keep calling this RPC. They now write exactly one narrow
-- compatibility presence row per session, so the wide server_statistics row stops
-- receiving minute-by-minute updates immediately after this migration.
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
    with presence_row as (
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
            least(coalesce(p_started_at, now()), now()),
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
            least(coalesce(p_started_at, now()), now())
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
            least(coalesce(p_started_at, now()), now()),
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

-- Retain only recent presence and metadata, deleting at most 1,000 rows per run.
-- The hourly schedule is installed only when Supabase has pg_cron enabled.
create or replace function public.prune_server_presence()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
    deleted_presence integer := 0;
    deleted_sessions integer := 0;
    remaining integer := 1000;
begin
    delete from public.server_presence as presence
    where presence.ctid in (
        select candidate.ctid
        from public.server_presence as candidate
        where candidate.last_seen_at < now() - interval '7 days'
        order by candidate.last_seen_at, candidate.server_id
        limit 1000
    );
    get diagnostics deleted_presence = row_count;

    remaining := greatest(0, 1000 - deleted_presence);
    if remaining > 0 then
        delete from public.server_telemetry_sessions as session_row
        where session_row.ctid in (
            select candidate.ctid
            from public.server_telemetry_sessions as candidate
            where candidate.created_at < now() - interval '30 days'
              and not exists (
                  select 1
                  from public.server_presence as presence
                  where presence.session_id = candidate.session_id
              )
            order by candidate.created_at, candidate.session_id
            limit remaining
        );
        get diagnostics deleted_sessions = row_count;
    end if;

    return deleted_presence + deleted_sessions;
end;
$function$;

revoke all on function public.prune_server_presence() from public, anon, authenticated;

do $block$
declare
    schedule_exists boolean;
    schedule_id bigint;
begin
    if to_regclass('cron.job') is not null
       and to_regprocedure('cron.schedule(text,text,text)') is not null then
        execute 'select exists (select 1 from cron.job where jobname = $1)'
            into schedule_exists
            using 'server-presence-retention';
        if not schedule_exists then
            execute 'select cron.schedule($1, $2, $3)'
                into schedule_id
                using
                    'server-presence-retention',
                    '5 * * * *',
                    'select public.prune_server_presence()';
        end if;
    end if;
end;
$block$;

revoke all on function public.report_server_presence(text, text, text, text, timestamptz, integer) from public;
grant execute on function public.report_server_presence(text, text, text, text, timestamptz, integer) to anon, service_role;

-- Keep the BRIN or legacy btree only through the short rollback window before this
-- protected presence cutover. Once this migration commits, neither index is read or written.
drop index if exists public.server_statistics_updated_at_idx;
drop index if exists public.server_statistics_updated_at_brin_idx;

commit;
