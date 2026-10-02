# Control Plane administration page

`/admin/control-plane` is the website presentation layer for managed-hosting administration. Supabase `Admin` access protects the page, and the browser sends typed requests to the `control-plane-admin` Supabase Edge Function. The function accepts only configured website origins, reauthenticates the current access token, requires the protected `Admin` role, then forwards the unchanged request envelope to the Oracle web-admin adapter. The adapter independently revalidates the token and uses the control plane's typed Unix-socket contract.

For server-rendered pane reads, the page starts its closed read operation as soon as
it has a refreshed session token. Successful reads reuse Oracle's fresh authority
instead of repeating the user and session-context calls in the website.
The seven server-rendered reads (`overview`, `vps-hosts`, `servers`,
`server-dashboard`, `jobs`, `audit`, `release-catalog`) use a server-only helper to call
`https://control-plane.bannerlordcoop.com/v1/admin/control-plane` directly.
Each sends the current Bearer token and `x-control-plane-protected-admin: 1`.
Oracle freshly verifies the Supabase user and durable session context and requires
the protected `Admin` role, regardless of bootstrap email admission. The reader
requires the exact response acknowledgment, HTTP success and a successful
correlated envelope before returning data. It never falls back to the relay.
An older backend or backend rollback therefore fails closed; deploy the companion
[ControlPlane #270](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/pull/270) adapter before this website change. Website rollback to Edge
reads remains compatible. Browser reads and all mutations retain the Edge route.
The fixed direct route omits cookies/API keys, disables caching, refuses redirects
without following them, bounds requests to 64KiB and streamed responses to 8MiB
and 8192 chunks, and keeps caller cancellation plus the 90-second read deadline.
Oracle also returns `x-control-plane-authenticated-session` containing the freshly
verified Supabase user UUID, current request UUID and enforced session constraint. Before releasing the page,
the reader matches both identifiers to the refreshed session and the exact read,
requires the protected-role acknowledgment and `Cache-Control: no-store`, and
refuses redirects. Without an impersonation marker it sends
`x-control-plane-ordinary-session: 1` and requires the `ordinary` response constraint;
Oracle must freshly prove a null impersonation context. A native impersonation token
with its website marker removed therefore remains rejected. With a fully validated
marker, the response constraint is `validated` and the existing actor/target checks
still finish before any read starts. Cached role claims never grant page access. Result data still
requires complete bounded decoding and a successful correlated envelope. Missing,
duplicate or mismatched attestations reject the read data. An unavailable, denied
or older adapter retains the website's fresh user/context validation only to show
the existing error UI; that path cannot release the rejected data. Deploy the
companion identity-attestation adapter before this website change. Backend rollback
fails closed for read data; website rollback remains compatible.
The page withholds all content until fresh identity, session context and administrator
access are confirmed, and cancels pending reads on rejection. Service-key account
lookups start only after those checks. Impersonation actor/target validation finishes
before any early read starts. No mutation uses this path and no response or permission
is cached across requests.

Jobs and Audit retain server-rendered table contents, but their table components
receive only the displayed fields across the React client boundary. This avoids
serializing each row's markup again into the navigation payload. Shortened display
identifiers remain shortened in the props; failure acknowledgement keeps the exact
job ID and current `updatedAt`. Reads, pagination, viewer validation and mutation
requests retain the same paths and freshness requirements.

Releases and release choices in Operations request one `release-catalog` result
with separate Stable/Nightly pages, rather than authenticate two `builds` reads.
Both pages use one freshly verified and mapped registry observation, retaining
independent null cursors, current-first ordering and limit100 per channel. GHCR
discovery has a global100-version bound; aliases mark matching versions without
adding rows, so these pages cover the full current catalog. Errors remain visible.
Deploy the companion ControlPlane #266 operation before switching this website;
older backends reject it without a fallback. Browser `builds` reads and all
mutations retain their existing Edge contract.

Operations requests Overview with `input: { operations: true }` for its current
global controls, 100 server choices and 100 job choices, retaining cursors and
the `updatedAt` values used by mutations. It omits the unused health snapshot and
fleet summary, while full release choices, fresh provider service names and an
optional selected-server dashboard keep their existing reads. The page still
requires fresh protected administrator/session authority before rendering data.
Deploy [ControlPlane #280](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/pull/280) before the website change; an
older backend rejects the request without a fallback. Earlier website versions
remain compatible with the API's original full Overview response.

The page provides:

- clickable fleet health summaries, exact registered-VPS/managed-server/slot capacity, reconciliation, and global controls;
- registered OVH VPS capacity plus reviewed location IDs and live read-only cost, expiration, and auto-renew metadata;
- searchable servers with Discord usernames, durable state explanations, desired/observed state, runtime, release, save, backup, and audit detail;
- durable job state and action explanations plus retry/cancellation controls;
- installable validated Stable and Nightly release catalogs, source commit revisions, and validation/revocation actions;
- lifecycle, update, rollback, restore, diagnostics, password, suspension, and deletion controls;
- ownership transfer, manager access, quota, provider replacement, and server creation;
- bounded provider orphan review/cleanup, fleet reconciliation, batch maintenance, and owner announcements; and
- the hash-chained audit history.

The website does not query the private `control_plane` schema, call OVH, connect to runner agents, or construct container operations. Browser request UUIDs become the control-plane correlation and idempotency identity. Server and job mutations carry the current `updatedAt` value selected from the page. A correlated `stale_interaction` rejection refreshes the UI without clearing the form. For server lifecycle jobs, updates, rollbacks, restores, and diagnostics only, the card reads the exact server's authoritative dashboard and retries once with its new generation, the original request UUID, and unchanged user input. These workflows reject stale generations before accepting a job. An error carrying an accepted operation ID, a timeout, or a network failure is never automatically retried. Job retry/cancellation and failure acknowledgement are not replayed against a newer attempt; other mutations also require another explicit submission after refresh. Managed backup requests similarly read fresh backup status and replay at most once with the original durable UUID and backup selection; repeated stale or uncertain responses retain the pending request for manual reconciliation. Direct container commands and file-transfer/visibility contracts are unchanged.

The administrator presentation resolves Discord usernames only from bounded Supabase Auth accounts that signed in with Discord. Numeric Discord IDs remain visible and accepted as a fallback. Dates and provider-check times render only after browser hydration so they use the administrator's browser locale and time zone rather than the Netlify or Oracle server time zone.

The Operations page's **Register existing OVH VPS** card is the normal additive host-ingestion path. It verifies that an already-purchased service belongs to the configured OVH account, derives the reviewed image within the control plane, records `floor(vCPU / 2)` empty slots, and writes an administrative audit event. It never purchases, renews, powers, assigns, or installs the VPS. Managed-runner enrollment is still required before an assigned slot can Start. Server creation assigns an existing prepared OVH slot in the selected region; it never orders a VPS, and unavailable capacity fails without creating or billing anything. The normal Releases view hides non-validated history, but pending, rejected, and revoked receipts remain retained for explicit inspection and audit rather than being deleted.

### Import Latest Stable

The Builds page provides **Import Latest Stable** with a required audit reason. It sends the existing admin envelope with `operation: "import-latest-stable"`, a request UUID, and `input: { reason }`. No repository, tag, digest, workflow, or actor is selected by the browser. The backend discovers and verifies the authoritative receipt from the latest successful Stable publication, then atomically registers, validates, and audits the build. Success displays the build ID and immutable image digest and refreshes the catalog. While the card remains mounted, retrying unchanged input after an uncertain response retains its request UUID; a changed reason or a submission after confirmed success starts a new request. Reloading the page loses this browser-held retry identity.

Deploy the companion control-plane backend and configure its dedicated optional Actions-read credential before using this action; see that repository's managed-hosting deployment documentation. Missing configuration or unverifiable publication evidence returns an error, not an unverified import. The website never receives the Actions credential. No Edge Function routing change is required: existing authenticated forwarding and backend authorization apply.

Import advances the Stable catalog but does not directly enqueue an installation or restart. Existing server update policies may subsequently select the imported build. The action does not repair Discord publication or re-run a build.

Deploy the Edge Function from the repository root:

```sh
npx supabase secrets set --project-ref <project-ref> \
  CONTROL_PLANE_ADMIN_URL=https://control-plane.example.com \
  CONTROL_PLANE_WEB_ORIGINS=https://bannerlordcoop.com,https://bannerlordcoop.netlify.app
npx supabase functions deploy control-plane-admin --project-ref <project-ref>
npx supabase functions deploy my-servers --project-ref <project-ref>
```

The `my-servers` function accepts authenticated GET inventory requests and
strict POST direct commands `{action: "start" | "stop" | "restart-game", serverId}`.
The server-rendered directory and detail pages read inventory directly from the
fixed `https://control-plane.bannerlordcoop.com/v1/user/control-plane` endpoint,
using only the current bearer and closed `my-servers` operation. Oracle freshly
verifies the user, session context and durable owner/grant access on every page;
the website's existing viewer gates still apply. These reads omit cookies and
API keys, refuse redirects, disable caching, and retain correlated owner envelopes,
ten-page/100-item pagination and streamed 8MiB/8192-chunk response bounds. Caller
cancellation and a 30-second overall deadline cover fetch and response bodies.
The server-rendered onboarding summary also reads the closed `server-onboarding`
operation directly after account synchronization, with its strict DTO and 64 KiB
response bound. Browser reads, console commands and mutations retain the Edge route.
**My Servers** links each accessible server to `/servers/[serverId]`. The route
derives access from the authenticated inventory, never from the URL. Only current
durable owner/manager access can operate; support and server-level admin remain
read-only. The control plane rechecks durable permission immediately before dispatch.

The Edge Function maps these actions to fixed `POST /api/v1/start`, `/api/v1/stop`,
and `/api/v1/restart` routes with only `{serverId}` and the caller's bearer token.
Start uses the durable managed lifecycle to recreate a missing container with
the selected save and configuration, and confirms success only after readiness.
If the response deadline expires with a durable operation ID, the website shows
that Start was accepted and follows its progress; it does not claim
the game is ready or submit another request. Stop/Restart operate directly on
the existing container and require UI confirmation warning of unsaved progress
loss. Stop never powers off the VPS;
Restart never becomes a VM reboot.

The Edge retains the website's correlated version-1 envelope: success contains
`result: {exitCode: 0}`; nonzero exit returns HTTP 409 with
`container_command_failed` and the actual exit code in the bounded error message.
No stdout/stderr is forwarded. Transport failure means an unknown outcome, not
proof of non-execution. Each HTTP request is a new command; commands are never
automatically retried. Start timeout errors retain the durable operation ID.
Stop immediately shows pending feedback. After a successful command or an
uncertain response, the existing page poller refreshes authenticated server
status every four seconds. Lifecycle controls stay disabled until a newer
server revision confirms both the stopped lifecycle and observed game state.
After sixty seconds without confirmation, polling pauses and **Check status
again** resumes only the reads; it never sends another Stop. Explicit rejection
or a nonzero exit remains an error. Only successful lifecycle Start claims
readiness; direct Restart success reports the exit code. Existing backup
polling/interlocks remain.

Before enabling these controls, commission compatible ControlPlane #156 agent,
controller **and persistent process owner**, allow the three exact direct paths
through the adapter's HTTPS proxy, and deploy the updated `my-servers` Edge
Function. Do not bypass the process-owner protocol upgrade gate or fall back to
the generic lifecycle APIs. This website change performs no deployment.

`CONTROL_PLANE_ADMIN_URL` is the Oracle adapter's HTTPS origin; functions append their fixed API paths (including the three direct command routes above). `CONTROL_PLANE_WEB_ORIGINS` is a comma-separated exact allowlist of HTTPS browser origins. Neither value may contain credentials, query parameters, fragments, or path prefixes. JWT verification remains enabled in `supabase/config.toml`.

The website itself needs only the existing public Supabase URL and publishable key. It does not need an Oracle URL or control-plane credential in Netlify.

## Simplified server operations

Update server includes build selection: keep the current selection, install the
latest release and remove a pin, or install and pin a specific release. Only
installable builds in the selected server's channel are offered. Selection and
pinning are a single control-plane transaction. Deploy the control-plane version
supporting optional `update-server.input.buildId` before publishing this website.

Reinstall previous build installs and pins the preceding channel release while
keeping the current campaign. Restore backup instead replaces the campaign with
an older snapshot. Selecting a server loads a bounded backup page; the list shows
creation time, type, size, and build, with expiry in the selected backup details.
Older pages, empty lists, request failures, and retries are supported. Changing
servers clears the selected backup and ignores late responses from the previous
server. In-game date is not yet recorded in the backup catalog.

Orphan cleanup/review, forced reconciliation, provider-generation replacement,
and build inspect/validate/reject/revoke are removed from everyday Operations.
Their backend operator APIs and durable audit history remain intact. Releases
is a read-only view of installable builds; approval belongs to the release pipeline.
Missing save compatibility metadata is assumed compatible without a checkbox;
safety backups, integrity checks, and known incompatibility checks remain.

Administrators may sign in with any supported Supabase authentication provider;
a linked Discord identity is not required. The Oracle adapter attributes all
administrator operations to `supabase:<user UUID>`, derived from the independently
verified session. Customer ownership and owner/manager Discord identities are
unchanged. Deploy the control-plane principal migration and adapter before the
Edge Function change; the old adapter will reject accounts without Discord.

## Latest game log download

The existing **Download logs** button uses the authenticated `my-servers` Edge
Function (`GET ?resource=download-server-log&serverId=<UUID>`). The function now
forwards `POST /api/v1/logs/latest` with only `{serverId}`, the user's bearer token,
and `Accept: application/octet-stream`, as introduced in ControlPlane #157.

The existing binary streaming, original filename, 100 MiB limit, and server-side
access checks remain in place. No queue, polling, or automatic retry is added.
The direct API returns `404 log_not_found` when no file exists rather than a
successful JSON null result; the existing button displays that error.

Deployment requires the merged ControlPlane #157 code running, the updated
`my-servers` Edge Function deployed, and `/api/v1/logs/latest` included in the
exact HTTPS proxy allowlist. Merging the backend PR alone does not deploy the
website's Edge Function or expose the loopback route through the proxy.


## Fresh release reads and Operations inventory

Every authenticated release-list request reaches the control plane. There is no
five-minute Edge response cache, so removed or replaced registry tags appear on
the next read and upstream failures cannot return a preceding catalog. The service
reuses only digest-verified immutable image metadata while revalidating tag
membership and manifest bytes. Requests retain current authentication, session
revocation checks, request IDs, origin restrictions, and `Cache-Control: no-store`.
Deploy the `control-plane-admin` Edge Function separately after merging this change.

Operations requests registered VPS capacity and authenticated provider inventory
with `includeLiveData: false, includeProviderInventory: "service-names"`. It reads
fresh available VPS names without fetching unused per-host billing metadata,
CPU/memory samples or the runner target revision. Registered-host membership and
the available-service limit are still checked against the current provider list;
failures remain visible. Deploy the control-plane version supporting this literal
before the website rollout; older backends reject it without a fallback. The VPS
pane's live readings and billing remain unchanged.

Focused verification:

```sh
npx tsx --test supabase/functions/control-plane-admin/index.test.ts
npx eslint supabase/functions/_shared/control-plane-admin.ts supabase/functions/control-plane-admin/index.test.ts
```

### VPS inventory loading

The VPS tab first requests `vps-hosts` with `input: { includeLiveData: false }`.
Registered hosts, capacity, and assignments render without live provider or runner
reads. Two independent browser requests then load telemetry/runner details with
`{ includeLiveData: true, includeProviderInventory: false }` and provider billing
with `{ includeLiveData: false, includeProviderInventory: true }`. Each has its own
loading, error, retained-reading and retry state. A slow billing response cannot
hold up resource readings or runner controls; a slow telemetry response cannot
hold up billing. Provider fields merge by host name without replacing current
capacity, assignments, runner state or telemetry.
While visible, telemetry refreshes five seconds after each completed request;
billing refreshes after 60 seconds and has a separate 15-second browser deadline.
Each loop prevents overlapping requests. Failed refreshes label retained readings
as old and retry automatically. A successful response with missing fields clears
older measurements. Hidden tabs pause both loops and refresh on return. Leaving
the tab cancels both requests; superseded responses cannot replace new inventory.
Expanded host details remain open during either refresh.
Legacy full responses without `liveDataIncluded` render directly. Deploy the
backend that honors explicit provider exclusion before this website change.
No Edge Function deployment is needed. This isolates the provider failure; it does
not establish or repair the cause of the slow provider call.



## Fresh gateway authentication

The admin gateway fetches the current Supabase user and durable website session
context concurrently. It forwards only after both validate, the context matches
the verified identity and has not expired, and the current user has the Admin
role. Each request makes fresh checks; no authentication or response cache is
used. Either check failing aborts its sibling. A successful context RPC can record
an authentication attempt even if the concurrent user lookup fails; this is not
successful authorization. Membership and Patreon retain their existing verified
identity calls to the shared session verifier.

The read-only Servers page and administrator read-error fallback obtain a fresh
viewer after normal session refresh. User verification and the session-context RPC run concurrently
with the same explicit access token; this also avoids serializing the RPC behind
the auth SDK's session lock. Neither result is cached across requests. Existing
impersonation validation completes before this viewer is returned. Server actions
continue using their existing authorization path.

Authenticated admin gateway responses include numeric `Server-Timing` durations:
`edge_auth` covers both fresh authorization reads and `control_plane` covers the
upstream request and complete bounded response. These are measured per request;
no tokens, identities, request inputs, upstream timing text, or internal URLs are
included. Denied gateway requests do not expose stage timings. This diagnostic
header does not cache data or change authorization, forwarding, or deadlines.

## Applied administrator job index history

`supabase/migrations/20260930142800_control_plane_admin_job_index.sql` is an exact Git-byte mirror of ControlPlane commit `142cd4bed948a6c354d2e7f1ed1bec63755a3ba0` (PR255). Its SHA-256 is `2eb71c8b41be2db7ca610964cbbccee99b9f5b5842c6e0debb9368d36c8220d0`. The shared production project already records version `20260930142800`; this mirror restores the website migration inventory expected by its Supabase integration. Do not replay, edit, or repair this applied migration history. It does not introduce a new database change. The original membership release inventory remains a frozen snapshot; this later mirror is verified separately.
