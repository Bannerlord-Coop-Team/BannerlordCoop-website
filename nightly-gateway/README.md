# Staff, Supporter, and Tester nightly access gateway

This Worker is the R2 half of nightly access (see
`docs/nightly-backend-contract.md`). It serves manifests, artifacts, create-build
pins, the installer scripts and `7zr.exe`, and it forwards the installer device
API (`POST /v1/device/sessions`, `POST /v1/device/token`) to the Supabase Edge
Function at `NIGHTLY_FUNCTION_URL`. The Worker never calls Discord: device
sessions, OAuth, the member check, and sponsor seats live in the Edge Function,
and the browser pages live at `https://bannerlordcoop.com/nightly/*`. The
Worker's old `/`, `/activate`, `/sponsor*`, `/oauth/callback`, and
`/v1/sponsor*` paths redirect there.

The Worker answers on `https://nightly.bannerlordcoop.com` (canonical) and
`https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev` (legacy).
Every URL it hands back (manifest artifact URLs, pin install links, the pin
launcher, and the `verification_uri` it adds to a created device session) uses
the host the request arrived on. Any other host is treated as the canonical one.
When the Edge Function cannot be reached or answers with something other than
bounded JSON, the Worker returns `502 function_unreachable` or
`502 function_response_invalid` with only `{"error": ...}` in the body. The
`nightly_gateway_request_failed` log line carries the path, the cause class, and
for `function_response_invalid` the Edge reply's `upstream_status` (for example
`504` from a platform timeout page).

The installer script is intentionally public. It carries no Discord, R2, or
shared download secret. Every install or update starts a new device session,
opens Discord OAuth in the user's browser, and receives a short-lived bearer
token only after the Edge Function verifies one of these conditions:

- the signed-in Discord member currently has one of the fixed Staff, Tester,
  Competition Winner, Patreon, Boosty, or Afdian roles in the Bannerlord Co-op guild; or
- the signed-in Discord account occupies one of a current eligible member's ten
  sponsored-account seats.

Sponsored access is attached to the friend's Discord account, not to a machine
or a download count. Before each installer session is approved, the Edge
Function asks Discord whether that sponsor still has a qualifying Staff, Tester,
Competition Winner, or supporter role. If they left the guild or lost the role,
the Edge Function removes their grant, seats, and active download sessions.
Sponsored friends do not need the sponsor to sign in again. Removing a sponsored
account (also an Edge Function action) revokes its active download sessions. Every eligible member has one shared ten-seat pool
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

`installer/install.ps1` is the client-side authority for nightly release
metadata, the device-authorization flow, and incremental server update behavior. Both installers
read `/v1/manifests/release`. The gateway first reads the public
`bannerlordcoop-nightly-releases/nightly/release.json` pointer, which contains only
the GHCR digest and the hash-bound key of the private
`bannerlordcoop-patron-nightlies/nightly/publications/<sha256>/release.json`
manifest. It then validates that complete private marker before returning any
artifact URL. A client-only choice therefore waits for the same complete
publication as a server choice. Keep the Linux
implementation aligned when those contracts change, including downloading the
validated client and immutable Windows server `publicUrl` values rather than
mutable legacy URLs. Linux-specific
Steam discovery and Wine/Proton handling remain in `install-linux.sh`.

### Delay-safe publication cutover

The client workflow invalidates the old `nightly/client.json` object before it
publishes a new immutable client archive. This makes an old gateway's
`/v1/manifests/client` route fail closed during the cutover instead of returning
a stale client-only build. The new gateway accepts only a digest-only public
pointer followed by a complete v2 private marker; an old full marker in either
bucket fails closed. Old installers reject v2, so they cannot consume the new
client by accident.

Roll out the marker-aware Control Plane before dispatching the dedicated-server
publisher, then deploy this gateway and both installers, and only then dispatch
the server workflow with the exact client run and head. The publisher writes
immutable client/server objects, an immutable private manifest, and an immutable
GHCR image first, and flips the one public `nightly/release.json` pointer last.
It leaves the mutable GHCR `nightly` alias at the previous complete release. A
delayed gateway, installer, Control Plane, or publisher therefore leaves the
previous complete publication or fails closed.

The pointer is published at the unauthenticated
`https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev/nightly/release.json` URL and
is also read directly from the `PUBLIC_RELEASES` R2 binding. The direct binding
read avoids Workers redirect/runtime differences while retaining the public URL
for CP and other readers. The pointer is bounded to 4 KiB. Resolving its private
manifest is bounded to 128 KiB; the whole read has a five-second deadline. Hash
and image mismatches fail closed. There is no fallback to the private mutable
`nightly/release.json` object for the publication path. The pointer reveals no
client/server archive keys, URLs, sizes, commits, workflow runs, or credentials.
`PUBLIC_RELEASES` is a read-only public pointer bucket; `RELEASES` remains the
private Patron marker and legacy-artifact bucket. Neither binding adds a secret or
permits caller-chosen object keys.

### Manifest-version compatibility during rollout

`/v1/manifests/release` returns the validated legacy v1 object by default,
preserving compatibility with the 14b9e61c gateway and older installers. A
headerless client request returns a v1 projection of the complete paired
publication: the legacy client object is used only when its identity agrees
with that publication; a newer or mismatched legacy object is ignored. A
request that sends `X-Bannerlord-Coop-Nightly-Version: 2` opts into the complete
v2 publication; the header is the only representation switch and does not
select an object key.
The current Windows and Linux installers send that header and accept either v2
or the validated v1 response, so a session can cross a gradual Worker rollout
without a manifest-version failure. Client-only requests return the previous
complete pair while a newer client waits for its server; they return 503 only
when no complete pair exists.

### Publication read failures and compatibility fallback

`GET /v1/manifests/release` emits the same structured failure event and falls
back only when both legacy `nightly/release.json` and `nightly/client.json`
objects validate and agree on release date, client commit, client key, and
client checksum. This keeps Server and Both on one validated legacy pair during
a transient publication read failure; missing, malformed, or mismatched legacy
objects remain a 503. Headerless client delivery uses the same bounded,
validated legacy v1 projection and fixed artifact-origin checks, so a client
cannot move ahead of the complete server publication.

The failure event records the route, exact stage (`pointer`, `private_read`,
`checksum`, `manifest`, or `container`), the pointer HTTP/R2 status when one
exists, and the bounded exception class. Successful fallback emits
`nightly_legacy_client_fallback_served` or
`nightly_legacy_release_fallback_served`. These events are Worker observability
alerts and contain no credentials or archive bytes.

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
   login and the Supabase PostgreSQL connection, and bind it as `HYPERDRIVE` in
   `wrangler.jsonc`. The Worker never receives a Supabase service-role key or a
   general database owner credential.
3. The gateway database is PostgreSQL only. Since the Edge Function split,
   every device, sponsor, and OAuth write happens in the Edge Function against
   the same `nightly_gateway` schema, so there is no D1 binding, no
   `DATABASE_BACKEND` selector, and no D1 rollback route: a Worker reading D1
   would find no `download_sessions` and reject every new token with
   `401 authorization_expired`. Rolling back means redeploying the previous
   Worker version *and* the previous Edge Function version together (see
   `SUPABASE_CUTOVER.md`). The SQL under `nightly-gateway/migrations/` and
   `migrate-d1-to-postgres.mjs` are historical records of the completed D1
   import; the live schema is owned by `supabase/migrations/`.
4. Keep the `NIGHTLY_FUNCTION_URL` var in `wrangler.jsonc` pointed at the
   deployed `nightly-gateway` Edge Function. Discord OAuth, the Discord bot
   token, and the website key are Edge Function secrets; the Worker holds no
   Discord secret. Delete the retired `DISCORD_CLIENT_SECRET`,
   `DISCORD_BOT_TOKEN`, and `TOKEN_ENCRYPTION_KEY` Worker secrets once the
   slimmed Worker is live.
5. `nightly.bannerlordcoop.com` is attached to this Worker as a custom domain
   (declared in `wrangler.jsonc` `routes`; the `bannerlordcoop.com` zone is on
   Cloudflare). The `workers.dev` host keeps serving identically until it is
   retired.
6. Optionally set `PIN_MINT_SECRET` with `wrangler secret put` to the same
   value as Bot_UP's `NIGHTLY_GATEWAY_PIN_SECRET` (at least 32 characters).
   `/v1/manifests/client` keeps working when this secret is absent. When it is
   set, `/create-build` can mint a one-time installer pin; its tables come from
   the step 1 schema migration. Add a one-day `pins/` lifecycle rule on
   `bannerlordcoop-patron-nightlies`. Do not require this secret at Worker
   start.
7. Create and bind a private R2 bucket named
   `bannerlordcoop-patron-nightlies` as `RELEASES`. Do not enable its `r2.dev`
   URL or attach a public custom domain. Artifacts reach installers only
   through the Worker's own hosts.
8. Keep `/create-build` output and the public publication pointer in the
   separate `bannerlordcoop-nightly-releases` bucket, bound as `PUBLIC_RELEASES`.
   Its copyable links remain valid until Bot_UP's existing 24-hour expiry
   cleanup; never disable public access on that bucket as part of the
   Patron-nightly rollout.
9. Migrate Bot_UP/Managed Hosting to scoped R2 S3 reads from the private Patron
   bucket. Machine-to-machine hosting downloads do not use Discord OAuth.
10. Deploy the updated client, dedicated-server, and website publishers and
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

The dry run is intentionally non-deploying. Deployment also requires the
Hyperdrive configuration, the deployed Edge Function, private Patron bucket, and
the Garrett Cloudflare account configured in `wrangler.jsonc`. The Worker binds
no D1 database.
