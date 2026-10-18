# Network statistics performance

## Homepage rendering

The homepage renders its navigation, hero and calls to action without awaiting
network statistics. Only the async `NetworkStatistics` leaf waits for that
optional request, inside a `Suspense` boundary. The fallback reuses the localized
statistics section and cards, reserving space for both translated status labels
and the value/unavailable line. Pending values are hidden from assistive
technology and the section is marked busy; a pending request does not display
zero or claim that statistics are already unavailable.

The request to `network-stats-cached` has a three-second abort deadline covering
both headers and response-body reading. Timeout, transport/HTTP failure and
invalid JSON retain the existing unavailable presentation; invalid or missing
individual counts remain unavailable, while a valid zero remains zero. The
timer is cleared after settlement. The endpoint, public API key, safe-count
validation and `next.revalidate: 15` policy are unchanged. This removes one
remote dependency from the homepage shell, not one upstream request.

Run the focused boundary, failure and locale regressions with:

```sh
npm run test:components -- src/app/home-streaming.component.test.tsx src/app/lib/network-stats.component.test.tsx src/app/components/home/home-localization.component.test.tsx
```

The streaming regression holds statistics unresolved until it has received the
navigation and hero/CTA HTML, then checks the completed statistics segment.
When changing card layout, compare pending, loaded and unavailable states at
mobile, two-column and four-column widths, including longer translated labels.
Local streaming and layout checks do not establish production OpenNext cache
persistence, hit rate, deployed streaming latency or whole-page CLS. Verify
those separately on the deployed Cloudflare adapter before quantifying gains.

## Query index

`get_network_stats()` uses `server_statistics.updated_at` for its two-minute
freshness window. Migration `202609100011_network_stats_updated_at_index.sql`
indexes that column without changing the RPC, grants, rows, or freshness rule.
Production statistics later showed that neither `last_seen_at` index had a
reader while every heartbeat maintained both. Migration `202609200001` drops
those two indexes and retains `server_statistics_updated_at_idx`; the two
timestamp columns can differ, so the freshness contract remains unchanged.

Apply through the reviewed Supabase migration workflow. The transaction has a
five-second lock timeout and a sixty-second statement timeout; a failed change
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

Pending CP migration `202609100010_control_plane_monitor_indexes.sql` is also
mirrored byte-for-byte so both repositories have the coordinated release union.
Apply 202609100010 then 202609100011 through the protected CP release workflow;
do not run an independent website migration writer concurrently.
