# Network statistics query index

`get_network_stats()` uses `server_statistics.updated_at` for its two-minute
freshness window. Migration `202609100011_network_stats_updated_at_index.sql`
indexes that column without changing the RPC, grants, rows, or freshness rule.
`last_seen_at` indexes remain available to their existing callers; the two
columns can differ after other updates, so substituting them is not equivalent.

Apply through the reviewed Supabase migration workflow. The transaction has a
five-second lock timeout and a sixty-second statement timeout; failed creation
rolls back and can be retried during a quieter window. No production migration
is implied by a source change. The membership migration inventory remains a
frozen snapshot of its original release; this later migration is tested separately.

The regression uses 20,000 historical sessions and mismatched timestamp rows,
checks unchanged counts and replay, and confirms PostgreSQL chooses the new
index without disabling sequential scans.

## Shared migration history

`202609100001_control_plane_web_admin_principals.sql` is an exact mirror of the applied
control-plane migration from commit
`d3e7fa40738d80ad7b1f15d3eccf7e7dd6fd6651` (PR 95). Its SHA-256 is
`daa012cbf71ef62906493512a8f1ac13992e8f3a238b4af6b158fa6af2ab8c37`. It aligns the website's local shared-project
history with production. Do not replay or edit this already-applied SQL. The
network-statistics index remains a separate pending migration.
