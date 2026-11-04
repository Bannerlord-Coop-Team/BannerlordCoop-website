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
freshness window. Migration `20261101180000_server_statistics_updated_at_brin.sql`
replaces the large B-tree with a BRIN summary index without changing the RPC,
grants, rows, or freshness rule. Production correlation for `updated_at` was
0.9994, so BRIN fits the current heap order. It uses PostgreSQL's default
`pages_per_range` and creates BRIN before dropping the B-tree; a restored-copy
latency check is required because BRIN can inspect false-positive heap ranges.
PostgreSQL 16 explicitly allows HOT updates when only BRIN-indexed columns are
updated ([release note](https://www.postgresql.org/docs/16/release-16.html#RELEASE-16-CHANGES)),
but page free space and fillfactor still limit HOT, so the production check
measures the HOT counter together with relation sizes and database growth.
Production statistics later showed that neither `last_seen_at` index had a
reader while every heartbeat maintained both. Migration `202609200001` drops
those two indexes. The two timestamp columns can differ, so the freshness
contract remains unchanged.

Apply through the reviewed Supabase migration workflow. The two index commands
run concurrently outside a transaction, each with a five-second lock timeout
and a sixty-second statement timeout. The migration checks `pg_index.indisvalid`
before dropping the B-tree, so a failed concurrent build stops before the drop;
a `55P03` refusal is retryable and leaves the old B-tree in place. If a failed
build leaves an invalid BRIN index, drop that invalid index concurrently in the
protected release recovery window, then re-run the exact pending migration
check and push. The migration ledger records the file only after both commands
finish. No production migration is implied by a source change. The membership
migration inventory remains a frozen snapshot of its original release; these
later migrations are tested separately.

The regression uses 20,000 historical sessions and mismatched timestamp rows,
checks unchanged counts and replay, and confirms the BRIN catalog shape in the
small local fixture. It deliberately does not force `enable_seqscan=off` or
claim that a small fixture predicts the planner's default choice. Production
verification must capture `EXPLAIN (ANALYZE, BUFFERS)` with default planner
settings and compare latency before and after the index swap.

## Shared migration history

`202609100001_control_plane_web_admin_principals.sql` is an exact mirror of the applied
control-plane migration from commit
`d3e7fa40738d80ad7b1f15d3eccf7e7dd6fd6651` (PR 95). Its SHA-256 is
`daa012cbf71ef62906493512a8f1ac13992e8f3a238b4af6b158fa6af2ab8c37`. It aligns the website's local shared-project
history with production. Do not replay or edit this already-applied SQL. The
network-statistics migrations remain a separate pending suffix.

Pending CP migration `202609100010_control_plane_monitor_indexes.sql` is also
mirrored byte-for-byte so both repositories have the coordinated release union.
The network-statistics migrations remain a separate pending suffix. Apply them
through the protected CP release workflow; do not run an independent website
migration writer concurrently.
