# Staff, Supporter, and Tester nightly access gateway

The installer script is intentionally public. It carries no Discord, R2, or
shared download secret. Every install or update starts a new device session,
opens Discord OAuth in the user's browser, and receives a short-lived bearer
token only after the gateway verifies one of these conditions:

- the signed-in Discord member currently has one of the fixed Staff, Tester,
  Competition Winner, Patreon, Boosty, or Afdian roles in the Bannerlord Co-op guild; or
- the signed-in Discord account occupies one of a current eligible member's ten
  sponsored-account seats.

Sponsored access is attached to the friend's Discord account, not to a machine
or a download count. Before each installer session is approved, the gateway
asks Discord whether that sponsor still has a qualifying Staff, Tester, Competition Winner, or
supporter role. If they left the guild or lost the role, their grant, seats,
and active download sessions are removed. Sponsored friends do not need the
sponsor to sign in again. Removing a sponsored account also revokes its active
gateway sessions. Every eligible member has one shared ten-seat pool
regardless of how many qualifying roles they hold.

Competition Winner is an installer eligibility role only, not a website membership
role. Keep it out of public website role lists and promotional copy.

This controls the official installer and download paths. A person who has
legitimately received the archive bytes can still copy those bytes; client-side
software cannot prevent that.

Discord member lookups fail open only for infrastructure failures such as a
rejected bot token, rate limiting, server errors, malformed responses, or a
timeout. A missing guild member, missing eligible role, expired session, and
used session remain denied. Each fail-open event is logged with its decision
path and sent to Andrew by a bot DM at most once per error kind per hour; the
message contains only the error kind, Discord status, first occurrence, and
count. The cooldown and counters are stored by one atomic conditional D1 write
in `discord_alerts`, using the existing `LEGACY_DB` binding. A failed claim store
logs `nightly_gateway_alert_claim_failed` and skips the DM. The claim is retained
even if DM delivery fails, so retries and fresh isolates cannot create a storm.
Each Discord request has one 15-second deadline covering headers and its bounded
body (64 KiB for member responses, 16 KiB for DM responses).

If `DISCORD_ALERT_USER_ID` is unset or is not a Discord snowflake, the gateway
still takes the fail-open path and writes `alert_recipient_unconfigured`; it
does not attempt a DM or fail the request.

The gateway serves the double-clickable Windows launcher at `/install.cmd`,
the Linux launcher at `/install.sh`, and the underlying public installers at
`/install.ps1` and `/install-linux.sh` so the live nightly-access page always
has a working entry point. Each launcher downloads the latest script and keeps
errors visible. Both installers ship the Windows client and Windows dedicated
server; Linux testers run those files through Wine or Proton. Run
`npm run gateway:sync-installer` after changing the canonical files under
`installer/`; `gateway:dry-run` performs the sync automatically before
packaging.

`installer/install.ps1` is the authority for nightly release metadata, Discord
authorization decisions, and incremental server update behavior. Keep the Linux
implementation aligned when those contracts change, including downloading the
validated client `publicUrl` rather than the mutable legacy URL. Linux-specific
Steam discovery and Wine/Proton handling remain in `install-linux.sh`.

For a Windows authorization failure, ask for the complete **Session diagnostics
v2** block from the installer. It records both PowerShell attempts and the curl
fallback, with response type, field lengths and validation results, HTTP status
or curl exit code. It omits device codes, user codes, activation links, and raw
response bodies. A cropped `body=` excerpt from an older installer is not
enough to identify which validation check failed.

Run `npm run test:installer-linux` on Linux or WSL with Bash, Python 3, and 7-Zip
(`7zz` or `7z`) installed. The suite executes the interactive installer against
local HTTP fixtures and temporary installs, including rollback failures, without
contacting the gateway or launching the game. `npm test` also runs this suite on
Linux and checks that the packaged Linux scripts match their canonical sources.

## Required production setup

1. Apply `supabase/migrations/202608260004_create_nightly_gateway_schema.sql`
   to the shared Supabase project. It creates the private `nightly_gateway`
   schema and the non-login `nightly_gateway_runtime` role. Create a separate
   login named `nightly_gateway_worker`, grant it that runtime role, and use it
   only for this gateway.
2. Create a cache-disabled Cloudflare Hyperdrive configuration using that
   login and the Supabase PostgreSQL connection. Replace the all-zero
   Hyperdrive ID in `wrangler.jsonc` before a real deployment. The Worker never
   receives a Supabase service-role key or a general database owner credential.
3. Keep the existing D1 binding for global alert claims after account migration.
   Apply `0003_discord_alerts.sql` before deploying this version. With no
   `DATABASE_BACKEND` secret, the post-cutover release uses PostgreSQL. Select
   `legacy-d1` explicitly before deploying a bridge release to an unmigrated
   environment. Follow
   `SUPABASE_CUTOVER.md` to lock writes, import one consistent snapshot, switch
   to PostgreSQL, verify, and unlock. Account data uses PostgreSQL; `discord_alerts`
   remains in D1 regardless of the account backend.
4. Register exactly
   `https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/oauth/callback`
   as a Discord OAuth2
   redirect and enable the `identify guilds.members.read` scopes.
5. Set `DISCORD_CLIENT_SECRET` with `wrangler secret put`.
6. Set `DISCORD_BOT_TOKEN` to Bot_UP's current Discord bot token with
   `wrangler secret put`. That bot is already in the Bannerlord Co-op guild and
   can look up one member's current roles without Server Members Intent. Do not
   create or invite a second bot for this. The installer OAuth app stays
   separate; the role checks and alert DMs use Bot_UP.
7. Confirm Andrew's Discord user ID with him, then set that value as
   `DISCORD_ALERT_USER_ID` with `wrangler secret put`. Keep it as a secret
   configuration value; never hardcode it in the Worker. The gateway sends a
   rate-limited DM when Discord eligibility verification fails open.
8. Generate 32 random bytes, encode them as unpadded base64url, and set them as
   `TOKEN_ENCRYPTION_KEY` with `wrangler secret put`.
9. Optionally set `PIN_MINT_SECRET` with `wrangler secret put` to the same
   value as Bot_UP's `NIGHTLY_GATEWAY_PIN_SECRET` (at least 32 characters).
   Nightly Discord OAuth and `/v1/manifests/client` keep working when this
   secret is absent. When it is set, `/create-build` can mint a one-time
   installer pin. Apply D1 migration `0002_installer_pins.sql`, and add a
   one-day `pins/` lifecycle rule on `bannerlordcoop-patron-nightlies`. Do not
   require this secret at Worker start.
10. Create and bind a private R2 bucket named
   `bannerlordcoop-patron-nightlies`. Do not enable its `r2.dev` URL or attach a
   public custom domain. The Worker is exposed through the existing
   `garrett-luskey.workers.dev` account subdomain, so Squarespace DNS is not
   involved.
11. Keep `/create-build` output in the separate public
   `bannerlordcoop-nightly-releases` bucket. Its copyable links remain valid
   until Bot_UP's existing 24-hour expiry cleanup; never disable public access
   on that bucket as part of the Patron-nightly rollout.
12. Migrate Bot_UP/Managed Hosting to scoped R2 S3 reads from the private Patron
   bucket. Machine-to-machine hosting downloads do not use Discord OAuth.
13. Deploy the updated client, dedicated-server, and website publishers and
   verify a live direct eligible-member install plus a sponsored install.

When Bot_UP's Discord token rotates, update `DISCORD_BOT_TOKEN` on this Worker
in the same change window with `wrangler secret put` before relying on nightly
installs. A stale token causes the gateway to fail open for eligibility checks;
the Worker records that path and DMs the configured alert recipient, but the
secret still must be rotated promptly.

## Verification

```sh
npm run gateway:check
npm run gateway:dry-run
npm test
```

`gateway:check` regenerates the ignored `worker-configuration.d.ts` from
`wrangler.jsonc` before typechecking. Run `gateway:types` directly only when
you want to refresh the generated types for editor use.

The dry run is intentionally non-deploying. Deployment also requires the real
Hyperdrive ID, Discord application ID, secrets, private Patron bucket, and the
Garrett Cloudflare account configured in `wrangler.jsonc`. Keep D1 bound for
alert claims even after the account-data rollback window closes.
