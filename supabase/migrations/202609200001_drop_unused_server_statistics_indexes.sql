begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Heartbeats already use the updated_at index. These duplicate timestamp
-- indexes have no readers and force two extra index writes per heartbeat.
drop index if exists public.server_statistics_last_seen_at_session_id_idx;
drop index if exists public.server_statistics_last_seen_at_idx;

commit;
