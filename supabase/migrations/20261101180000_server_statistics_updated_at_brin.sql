begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- updated_at is strongly correlated with heap order. BRIN preserves the
-- two-minute freshness predicate while avoiding one B-tree entry per heartbeat.
create index if not exists server_statistics_updated_at_brin_idx
  on public.server_statistics using brin (updated_at)
  with (pages_per_range = 32);

drop index if exists public.server_statistics_updated_at_idx;

commit;
