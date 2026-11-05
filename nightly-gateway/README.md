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
authorization decisions, and incremental server update behavior. Both installers
read `/v1/manifests/release`, which is backed by the single
`bannerlordcoop-patron-nightlies/nightly/release.json` marker. The gateway rejects
that marker unless it contains the client, Windows server artifacts, workflow
identities, and the immutable GHCR image identity. A client-only choice therefore
waits for the same complete publication as a server choice. Keep the Linux
implementation aligned when those contracts change, including downloading the
validated client and immutable Windows server `publicUrl` values rather than
mutable legacy URLs. Linux-specific
Steam discovery and Wine/Proton handling remain in `install-linux.sh`.

### Delay-safe publication cutover

The client workflow invalidates the old `nightly/client.json` object before it
publishes a new immutable client archive. This makes an old gateway's
`/v1/manifests/client` route fail closed during the cutover instead of returning
a stale client-only build. The new gateway accepts only the complete v2 marker;
an old v1 marker also fails closed until the dedicated-server publisher replaces
it. Old installers reject v2, so they cannot consume the new client by accident.

Roll out the marker-aware Control Plane before dispatching the dedicated-server
publisher, then deploy this gateway and both installers, and only then dispatch
the server workflow with the exact client run and head. The publisher writes
immutable client/server objects and an immutable GHCR image first, and flips
`nightly/release.json` last. It leaves the mutable GHCR `nightly` alias at the
previous complete release. A delayed gateway, installer, Control Plane, or
publisher therefore leaves the previous complete publication or fails closed.

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
3. Keep the existing D1 binding during the migration window only. With no
   `DATABASE_BACKEND` secret, the post-cutover release uses PostgreSQL. Select
   `legacy-d1` explicitly before deploying a bridge release to an unmigrated
   environment. Follow
   `SUPABASE_CUTOVER.md` to lock writes, import one consistent snapshot, switch
   to PostgreSQL, verify, and unlock. Remove the D1 binding after the rollback
   window closes.
4. Register exactly
   `https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/oauth/callback`
   as a Discord OAuth2
   redirect and enable the `identify guilds.members.read` scopes.
5. Set `DISCORD_CLIENT_SECRET` with `wrangler secret put`.
6. Set `DISCORD_BOT_TOKEN` to Bot_UP's existing Discord bot token with
   `wrangler secret put`. That bot is already in the Bannerlord Co-op guild and
   can look up one member's current roles without Server Members Intent. Do not
   create or invite a second bot for this. The installer OAuth app stays
   separate; only the role check uses Bot_UP.
7. Generate 32 random bytes, encode them as unpadded base64url, and set them as
   `TOKEN_ENCRYPTION_KEY` with `wrangler secret put`.
8. Optionally set `PIN_MINT_SECRET` with `wrangler secret put` to the same
   value as Bot_UP's `NIGHTLY_GATEWAY_PIN_SECRET` (at least 32 characters).
   Nightly Discord OAuth and `/v1/manifests/client` keep working when this
    secret is absent. When it is set, `/create-build` can mint a one-time
   installer pin. Apply D1 migration `0002_installer_pins.sql`, and add a
   one-day `pins/` lifecycle rule on `bannerlordcoop-patron-nightlies`. Do not
   require this secret at Worker start.
9. Create and bind a private R2 bucket named
   `bannerlordcoop-patron-nightlies`. Do not enable its `r2.dev` URL or attach a
   public custom domain. The Worker is exposed through the existing
   `garrett-luskey.workers.dev` account subdomain, so Squarespace DNS is not
   involved.
10. Keep `/create-build` output in the separate public
   `bannerlordcoop-nightly-releases` bucket. Its copyable links remain valid
   until Bot_UP's existing 24-hour expiry cleanup; never disable public access
   on that bucket as part of the Patron-nightly rollout.
11. Migrate Bot_UP/Managed Hosting to scoped R2 S3 reads from the private Patron
   bucket. Machine-to-machine hosting downloads do not use Discord OAuth.
12. Deploy the updated client, dedicated-server, and website publishers and
   verify a live direct eligible-member install plus a sponsored install.

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
Garrett Cloudflare account configured in `wrangler.jsonc`. D1 remains bound
only for the controlled cutover and short rollback window.
