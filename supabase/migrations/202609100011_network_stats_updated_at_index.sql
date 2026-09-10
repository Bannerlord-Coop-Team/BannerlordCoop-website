begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- get_network_stats() measures freshness using updated_at. Preserve that
-- contract: last_seen_at can differ after other updates to a session row.
create index if not exists server_statistics_updated_at_idx
  on public.server_statistics (updated_at);

commit;
