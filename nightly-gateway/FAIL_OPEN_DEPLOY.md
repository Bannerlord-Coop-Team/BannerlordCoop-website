# Deploying the Discord eligibility fallback

ORCH owns deployment. Keep #421 draft for its final review, merge #420 first,
then rebase #421 on the merged main and rerun verification. Preserve #420's v2
single complete-release marker checks. No production failure injection is needed.

## Before upload

From the final approved checkout, run `npm ci`, `npm run gateway:check`,
`npm run gateway:sync-installer`, the gateway tests, the PowerShell installer
tests, `npm test`, lint, and `npm run gateway:dry-run`. The Linux fixture tests
must also pass on the native Linux CI runner. On native Windows, the diagnostic
function tests can run through Cygwin by setting `COOP_TEST_BASH` to its native
`bash.exe`; this uses no WSL.

Apply D1 migration `0003_discord_alerts.sql` to the existing
`bannerlordcoop-nightly-access` database before deploying the new version. Check
the migration ledger first; stop if older migrations unexpectedly appear pending.
These commands are for the authorized deploy window:

```powershell
npx --yes wrangler@4.40.2 d1 migrations list bannerlordcoop-nightly-access --remote --config nightly-gateway/wrangler.jsonc
npx --yes wrangler@4.40.2 d1 migrations apply bannerlordcoop-nightly-access --remote --config nightly-gateway/wrangler.jsonc
npx --yes wrangler@4.40.2 secret put DISCORD_ALERT_USER_ID --config nightly-gateway/wrangler.jsonc
```

Use Andrew's confirmed Discord user ID as the last command's input. It stays a
Worker secret configuration value rather than a checked-in code literal. Unset
or invalid values skip DMs and log `alert_recipient_unconfigured`. Preserve
`LEGACY_DB` after the PostgreSQL account cutover: alert claims always use D1.
An unavailable claim store logs `nightly_gateway_alert_claim_failed` and sends
no DM; it never falls back to a per-isolate cooldown.

Check that `DISCORD_BOT_TOKEN` matches Bot_UP's current token. Whenever Bot_UP's
token rotates, update that Worker secret in the same window. A rejected token
also prevents that bot from delivering DMs, so retain the structured
`discord_bot_token_rejected` and alert-delivery-failure logs for that case.

## Upload, deploy, and rollback

Record the currently deployed version ID and final source SHA. Upload the
validated bundle without assigning production traffic:

```powershell
npx --yes wrangler@4.40.2 deployments list --config nightly-gateway/wrangler.jsonc
npx --yes wrangler@4.40.2 versions upload --config nightly-gateway/wrangler.jsonc --tag gateway-fail-open --message "Approved gateway fail-open revision"
```

After approval, substitute the returned version ID below. Upload and deploy
belong to the same exact reviewed source SHA and synchronized installer assets.

```powershell
npx --yes wrangler@4.40.2 versions deploy NEW_VERSION_ID@100 --config nightly-gateway/wrangler.jsonc --yes
```

If normal verification fails, stop the rollout and deploy the recorded previous
version with `versions deploy PREVIOUS_VERSION_ID@100`. Keep the additive D1
table and alert-recipient secret; neither needs to be removed to roll back code.

## Verification

- Verify `/health` returns 200 and all public installer assets return 200.
  Compare their hashes with the deployed source and check LF shell assets.
- Start a fresh owner-controlled device session, complete real Discord OAuth,
  and verify `/v1/device/token` returns 200. With that temporary bearer, verify
  `/v1/manifests/client` and `/v1/manifests/release` return the expected v2
  complete marker, immutable artifact identities, and no secret values in logs.
- Verify a sponsored account's normal path and a definite missing-role denial.
  Used, invalid, and expired sessions must remain closed. Keep bearer and device
  codes out of published output.
- Test 401, 403, 429, 5xx, stalled bodies, oversized bodies, missing/invalid alert
  recipients, and a failed claim store using the committed local fixtures with
  mocked Discord requests. The native workerd test starts two separate isolates
  sharing a local D1 database and proves exactly one claim, shared counters, and
  renewal after cooldown. These tests do not contact Discord or real users.
- If an additional deployed canary is desired, provision a separate Worker and
  test database/bucket bindings and mock its outbound Discord service. Do not
  inject a bad token into production or a percentage of real-user traffic.

Observe production logs after normal installs for unexpected fail-open paths,
claim-store failures, or DM-delivery failures. Alert requests use `waitUntil` so
delivery survives the response and cannot hold up the installer. One 15-second
deadline covers each Discord request and its bounded body; the atomic D1 claim
is retained even when delivery fails, limiting attempts to once per kind/hour.
