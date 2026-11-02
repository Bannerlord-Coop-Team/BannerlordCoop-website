-- Supabase CLI recognizes CONCURRENTLY and runs these statements as separate
-- autocommit commands. Keep the session limits in place, but do not wrap the
-- index operations in BEGIN/COMMIT: PostgreSQL rejects CONCURRENTLY in a
-- transaction block.
set lock_timeout = '5s';
set statement_timeout = '60s';

-- updated_at is strongly correlated with heap order. BRIN preserves the
-- two-minute freshness predicate while avoiding one B-tree entry per heartbeat.
create index concurrently if not exists server_statistics_updated_at_brin_idx
  on public.server_statistics using brin (updated_at);

do $$
begin
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'server_statistics_updated_at_brin_idx'
       and i.indisvalid
  ) then
    raise exception using
      errcode = '55000',
      message = 'server_statistics_updated_at_brin_idx is missing or invalid';
  end if;
end
$$;

drop index concurrently if exists public.server_statistics_updated_at_idx;
