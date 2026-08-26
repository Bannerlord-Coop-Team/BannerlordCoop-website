# Nightly gateway D1-to-Supabase cutover

This runbook moves the nightly gateway's durable state into the private
`nightly_gateway` schema without allowing D1 and PostgreSQL to accept writes at
the same time. R2 release objects do not move.

## Prepare

1. Apply `supabase/migrations/202608260004_create_nightly_gateway_schema.sql`.
2. Generate a unique database password and create the login through an
   owner-authenticated PostgreSQL session:

   ```sql
   create role nightly_gateway_worker login password '<generated password>';
   grant nightly_gateway_runtime to nightly_gateway_worker;
   alter role nightly_gateway_worker set statement_timeout = '5s';
   ```

3. In Cloudflare, create a cache-disabled Hyperdrive configuration for the
   Supabase database with `nightly_gateway_worker`. Put its real ID in
   `wrangler.jsonc`.
4. Deploy this bridge release with both `LEGACY_DB` and `HYPERDRIVE` bound.
   Do not set `DATABASE_BACKEND` yet: absence deliberately selects D1.
5. Confirm a normal eligible-user gateway flow still works on D1.

## Lock, copy, and switch

Run from the repository root. The database connection supplied to the importer
must use `nightly_gateway_worker`, not `postgres` or `service_role`.

1. Put the gateway into maintenance mode:

   ```sh
   printf '%s' locked | npx --yes wrangler@4.40.2 secret put MIGRATION_MODE --config nightly-gateway/wrangler.jsonc
   ```

   `GET /health` must now return HTTP 503 with `maintenance: true`. All other
   gateway requests also fail closed with HTTP 503, so the D1 snapshot cannot
   race a new write.

2. Export D1 and import the snapshot in one verified PostgreSQL transaction:

   ```sh
   read -rsp 'nightly_gateway_worker PostgreSQL URL: ' NIGHTLY_GATEWAY_DATABASE_URL
   printf '\n'
   printf '%s' "$NIGHTLY_GATEWAY_DATABASE_URL" | npm run gateway:migrate-d1 -- --connection-string-stdin
   unset NIGHTLY_GATEWAY_DATABASE_URL
   ```

   The importer creates an owner-only temporary D1 export, loads only the eight
   fixed tables, rejects a non-empty target, verifies every table's row count,
   commits atomically, and removes the export. It never prints row contents or
   the connection string.

3. Switch the already-deployed Worker to PostgreSQL while maintenance remains
   active:

   ```sh
   printf '%s' postgres | npx --yes wrangler@4.40.2 secret put DATABASE_BACKEND --config nightly-gateway/wrangler.jsonc
   ```

4. Request `/health` again. HTTP 503 with `maintenance: true` now also proves
   the Worker connected through Hyperdrive; a database connection failure
   returns HTTP 500 instead.
5. If that check fails, restore the D1 backend before unlocking:

   ```sh
   printf '%s' legacy-d1 | npx --yes wrangler@4.40.2 secret put DATABASE_BACKEND --config nightly-gateway/wrangler.jsonc
   ```

6. When the PostgreSQL health check succeeds, unlock traffic:

   ```sh
   npx --yes wrangler@4.40.2 secret delete MIGRATION_MODE --config nightly-gateway/wrangler.jsonc
   ```

## Verify and close the rollback window

Verify one direct eligible-member install, one sponsored install, sponsor-seat
listing/removal, and (when configured) one create-build pin. Confirm that new
rows appear only in `nightly_gateway` and that D1 counts remain frozen.

Keep the stopped D1 database and `LEGACY_DB` binding only for the short rollback
window. Once PostgreSQL has accepted new writes, switching back to the frozen
D1 snapshot would discard those writes; use a new maintenance window and an
explicit reverse reconciliation instead. After acceptance, remove the D1
binding, the `legacy-d1` selector path, and the old D1 migrations in a separate
cleanup change. Do not delete the D1 database until retention is explicitly
approved.
