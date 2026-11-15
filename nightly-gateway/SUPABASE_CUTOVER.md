# Nightly gateway D1-to-Supabase cutover

This runbook moved the nightly gateway's durable state from D1 into the private
`nightly_gateway` schema without letting D1 and PostgreSQL accept writes at the
same time. R2 release objects did not move.

## Status: the gateway database is PostgreSQL only

The cutover is complete. The Worker reads and writes the private
`nightly_gateway` schema through its `HYPERDRIVE` binding, and the Supabase
`nightly-gateway` Edge Function makes every device, sponsor, and OAuth write.
For the PostgreSQL-only rollback rule and the retired Worker secrets and D1
database to clean up, see [§5](../docs/nightly-backend-contract.md#5-worker) and
[§7](../docs/nightly-backend-contract.md#7-rollout-each-step-after-explicit-approval)
of the nightly backend contract.

The SQL under `nightly-gateway/migrations/` and `migrate-d1-to-postgres.mjs`
are historical records of the import, not the live schema;
`supabase/migrations/` owns that.

## Rolling back a gateway release

Roll back the Worker and the Edge Function together, because they share one
schema and one device-API contract:

1. Redeploy the previous Worker version (`npx --yes wrangler@4.40.2 versions
   list --config nightly-gateway/wrangler.jsonc`, then `npx --yes
   wrangler@4.40.2 rollback <version-id> --config nightly-gateway/wrangler.jsonc`).
2. Redeploy the previous `nightly-gateway` Edge Function from the matching
   commit with `supabase functions deploy nightly-gateway`.
3. If the release also changed the `nightly_gateway` schema, roll forward with
   a new Supabase migration instead of reverting it, so both components keep
   reading the same tables.

## Maintenance

The gateway has no maintenance switch. A future one must cover both the Worker
and the Edge Function, because website routes call the Edge Function directly.

## What the cutover did (historical)

1. Applied `supabase/migrations/202608260004_create_nightly_gateway_schema.sql`
   and created the `nightly_gateway_worker` login (granted
   `nightly_gateway_runtime`, `statement_timeout = '5s'`) through an
   owner-authenticated session.
2. Created a cache-disabled Hyperdrive configuration for that login and bound it
   as `HYPERDRIVE`.
3. Paused gateway writes for the import.
4. Ran `npm run gateway:migrate-d1 -- --connection-string-stdin` with the
   `nightly_gateway_worker` connection string. The importer exported D1 to an
   owner-only temporary file, loaded only the fixed tables into an empty target,
   verified every table's row count, committed atomically, and removed the
   export without printing row contents or the connection string.
5. Switched the Worker to PostgreSQL, verified a direct eligible-member install,
   a sponsored install, sponsor-seat listing and removal, and a create-build
   pin, then resumed writes.
6. Removed the D1 binding and the backend selector once the Edge Function took
   over every device, sponsor, and OAuth write.
