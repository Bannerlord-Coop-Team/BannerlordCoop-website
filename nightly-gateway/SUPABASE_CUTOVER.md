# Nightly gateway D1-to-Supabase cutover

This runbook moved the nightly gateway's durable state from D1 into the private
`nightly_gateway` schema without letting D1 and PostgreSQL accept writes at the
same time. R2 release objects did not move.

## Status: the gateway database is PostgreSQL only

The cutover is complete. Since the Edge Function split, every device, sponsor,
and OAuth write happens in the Supabase `nightly-gateway` Edge Function against
PostgreSQL. The Worker reads and writes the same `nightly_gateway` schema
through its `HYPERDRIVE` binding. It has no D1 binding and no
`DATABASE_BACKEND` selector; a leftover `DATABASE_BACKEND` Worker secret is
ignored.

There is no D1 rollback route. A Worker pointed at D1 would look up
`download_sessions` in a store nothing writes, and every newly issued token
would fail with `401 authorization_expired`.

The `bannerlordcoop-nightly-access` D1 database stays in place, unbound and
frozen. Do not delete it until retention is explicitly approved. The SQL under
`nightly-gateway/migrations/` and `migrate-d1-to-postgres.mjs` are historical
records of the import, not the live schema; `supabase/migrations/` owns that.

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

## Maintenance lock

The Worker still honours a maintenance lock for any future data operation that
must not race installer writes:

```sh
printf '%s' locked | npx --yes wrangler@4.40.2 secret put MIGRATION_MODE --config nightly-gateway/wrangler.jsonc
```

While locked, `GET /health` returns HTTP 503 with `maintenance: true` and every
other Worker request fails closed with HTTP 503. The lock covers only the
Worker; the Edge Function keeps accepting device, sponsor, and OAuth writes.
Unlock with:

```sh
npx --yes wrangler@4.40.2 secret delete MIGRATION_MODE --config nightly-gateway/wrangler.jsonc
```

## What the cutover did (historical)

1. Applied `supabase/migrations/202608260004_create_nightly_gateway_schema.sql`
   and created the `nightly_gateway_worker` login (granted
   `nightly_gateway_runtime`, `statement_timeout = '5s'`) through an
   owner-authenticated session.
2. Created a cache-disabled Hyperdrive configuration for that login and bound it
   as `HYPERDRIVE`.
3. Locked the gateway with `MIGRATION_MODE=locked`.
4. Ran `npm run gateway:migrate-d1 -- --connection-string-stdin` with the
   `nightly_gateway_worker` connection string. The importer exported D1 to an
   owner-only temporary file, loaded only the fixed tables into an empty target,
   verified every table's row count, committed atomically, and removed the
   export without printing row contents or the connection string.
5. Switched the Worker to PostgreSQL, verified a direct eligible-member install,
   a sponsored install, sponsor-seat listing and removal, and a create-build
   pin, then unlocked.
6. Removed the D1 binding and the backend selector once the Edge Function took
   over every device, sponsor, and OAuth write.
