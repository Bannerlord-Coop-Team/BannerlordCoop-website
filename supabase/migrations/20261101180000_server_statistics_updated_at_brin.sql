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

drop index concurrently if exists public.server_statistics_updated_at_idx;
