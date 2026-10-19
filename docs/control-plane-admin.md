# Control Plane administration page

`/admin/control-plane` is the website presentation layer for managed-hosting administration. Supabase `Admin` access protects the page, and the browser sends typed requests to the `control-plane-admin` Supabase Edge Function. The function accepts only configured website origins, reauthenticates the current access token, requires the protected `Admin` role, then forwards the unchanged request envelope to the Oracle web-admin adapter. The adapter independently revalidates the token and uses the control plane's typed Unix-socket contract.

For server-rendered pane reads, the page starts its closed read operation as soon as
it has a refreshed session token. Successful reads reuse Oracle's fresh authority
instead of repeating the user and session-context calls in the website.
The seven server-rendered reads (`overview`, `vps-hosts`, `servers`,
`server-dashboard`, `jobs`, `audit`, `release-catalog`) use a server-only helper to call
`https://control-plane.bannerlordcoop.com/v1/admin/control-plane` directly. The server-only
`CONTROL_PLANE_ORIGIN` setting can replace that origin (see the README); an invalid value fails closed.
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
The Releases view records each verified channel/image digest's first observation in
`public.release_observations` after its authorized catalog read. The Releases page
shows **First observed** from that immutable display timestamp, rather than the
control plane's request observation time. Reloads, alias changes and website
restarts retain it; a replacement image digest receives a new timestamp. These
records never supply release availability, authorization or deployment selection.
Apply `202610020003_release_first_observations.sql` before deploying this UI. The
migration seeds the earliest retained observation from verified registry deployment
records; the website does not read private control-plane tables at runtime. Dates
discarded before this table existed cannot be reconstructed; other images receive
their first retained date when next viewed in Releases. Browser roles have no table access,
and the website service role may only select and insert these records.
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
- registered VPS capacity (OVHcloud and Contabo) plus reviewed location IDs and live read-only cost, expiration, and auto-renew metadata;
- searchable servers with Discord usernames, durable state explanations, desired/observed state, runtime, release, save, backup, and audit detail;
- durable job state and action explanations plus retry/cancellation controls;
- installable validated Stable and Nightly release catalogs, source commit revisions, and validation/revocation actions;
- lifecycle, update, rollback, restore, diagnostics, password, suspension, and deletion controls;
- ownership transfer, manager access, quota, and server creation;
- fleet reconciliation and batch maintenance;
- a co-tenancy placement dry run whose steps open the relocation dialog, and the automatic placement executor's settings;
- server notices shown at the top of selected servers' pages; and
- the hash-chained audit history.

The website does not query the private `control_plane` schema, call a VPS provider, connect to runner agents, or construct container operations. Browser request UUIDs become the control-plane correlation and idempotency identity. Server and job mutations carry the current `updatedAt` value selected from the page. A correlated `stale_interaction` rejection refreshes the UI without clearing the form. For server lifecycle jobs, updates, rollbacks, restores, and diagnostics only, the card reads the exact server's authoritative dashboard and retries once with its new generation, the original request UUID, and unchanged user input. These workflows reject stale generations before accepting a job. An error carrying an accepted operation ID, a timeout, or a network failure is never automatically retried. Job retry/cancellation and failure acknowledgement are not replayed against a newer attempt; other mutations also require another explicit submission after refresh. Managed backup requests similarly read fresh backup status and replay at most once with the original durable UUID and backup selection; repeated stale or uncertain responses retain the pending request for manual reconciliation. Direct container commands and file-transfer/visibility contracts are unchanged.

The administrator presentation resolves Discord usernames only from bounded Supabase Auth accounts that signed in with Discord. Numeric Discord IDs remain visible and accepted as a fallback. Dates and provider-check times render only after browser hydration so they use the administrator's browser locale and time zone rather than the Netlify or Oracle server time zone.

The Operations page's **Onboard existing VPS** card is the normal additive host-ingestion path. Its choices are the inventory's `availableHosts` (unregistered hosts from every enabled provider account, labelled `<provider> · <service name>`); each option carries that host's `provider` and `serviceName`, and the card sends both. The inventory's `providerReads` reports each enabled provider's account read; a failed read withholds only that provider's unregistered hosts and billing, and the Operations and VPS views name the failed provider. The control plane verifies that the already-purchased service belongs to that provider's account, derives the reviewed image within the control plane, records `floor(vCPU / 2)` empty slots, and writes an administrative audit event. It never purchases, renews, or powers the VPS. The VPS view's per-host **Onboard runner**, **Retry onboarding**, and **Update runner** buttons send the host row's own `provider` with its service name; the control plane requires it and rejects a provider that differs from the stored host. Server creation assigns an existing prepared VPS slot in the selected region; it never orders a VPS, and unavailable capacity fails without creating or billing anything. The Region choices are the stored-catalog entries that `hosting-regions` reports `available: true` (a free slot admissible under the owner admission rules), in stored order, labelled from the website catalog or the humanized key. That flag is advisory: only the region key (`friendlyRegion`) is sent, and the control plane revalidates capacity. If the stored catalog cannot be read, Create server is shown unavailable with the read error. The VPS view also reads the stored catalog and labels each host with every stored region whose placement its provider-reported country and zone satisfy, then the country and zone. A host no stored placement covers is labelled **No stored region** until a catalog entry is published, and **Regions unavailable** when the catalog cannot be read. The normal Releases view hides non-validated history, but pending, rejected, and revoked receipts remain retained for explicit inspection and audit rather than being deleted.

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
The server-rendered directory reads inventory directly from the
fixed `https://control-plane.bannerlordcoop.com/v1/user/control-plane` endpoint (origin overridable
only through the validated server-only `CONTROL_PLANE_ORIGIN`),
using only the current bearer and closed `my-servers` operation. Oracle freshly
verifies the user, session context and durable owner/grant access on every page;
the website's existing viewer gates still apply. These reads omit cookies and
API keys, refuse redirects, disable caching, and retain correlated owner envelopes,
ten-page/100-item pagination and streamed 8MiB/8192-chunk response bounds. Caller
cancellation and a 30-second overall deadline cover fetch and response bodies.
The detail page and guarded stale-generation recovery for settings, visibility,
release channel and console commands instead read `server-summary` with only
`input: { serverId }` over that same authenticated route. It returns one current
inventory projection (including access role and update generation) with a 64 KiB
response limit, independent of fleet size or target order. The caller verifies
server identity and the closed DTO; authorization failures and malformed responses
never fall back to listing inventory. The directory retains its paginated read.
Deploy the additive ControlPlane #362 contract before this website; no Edge Function
or runner update is required. Current session checks, owner-only settings checks,
field-conflict checks and one-retry limits remain in force. Console recovery occurs
only after a confirmed pre-enqueue stale rejection and retains its command/request
UUID; uncertain delivery and accepted Start use their existing recovery paths.
The compact accepted-Start read remains `server-start-status`.

The server-rendered onboarding summary also reads the closed `server-onboarding`
operation directly after account synchronization, with its strict DTO and 64 KiB
response bound. Browser reads, console commands and mutations retain the Edge route.
**My Servers** links each accessible server to `/servers/[serverId]`. The route
derives access from the freshly authenticated summary, never from the URL. Only current
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
If the control plane rejects a request because another operation is already active, the page
refreshes the authoritative server state and keeps that rejection separate from an uncertain
operation submitted by the current tab. After sixty seconds without confirmation, polling pauses
and **Check status again** resumes only the reads; it never sends another Stop. Explicit rejection
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

Forced reconciliation and build inspect/validate/reject/revoke are removed from
everyday Operations; their backend operator APIs and durable audit history
remain intact. Provider orphan review/cleanup, provider-generation replacement
(resize, rebuild, migrate region), the `reboot-vm` lifecycle action, and owner
announcements were retired from the control plane with dynamic provisioning, and
**Import Latest Stable** (`import-latest-stable`) was removed with it, so the
website no longer offers or sends them. Historical jobs with those actions
still display and filter. Releases
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

The bottom of the VPS view also loads the pending region-request queue through
the `region-requests` operation. Each row shows the requested region, the
captured requester email or a current verified account-directory match for older
requests, any current allocated friendly regions (or an empty marker while the
owner is waiting), and timestamp, with an inline **Dismiss** action. An email
remains unavailable only when neither the request nor the current verified
account directory contains one. A successful action removes the row and records the administrator
resolution; the browser does not collect a free-form reason.

Rows whose request captured a requester email also offer **Notify**, which
emails the requester that the region now has capacity, with a link to
`https://bannerlordcoop.com/servers` (the canonical public site URL committed in
`control-plane-admin/index.ts`, independent of the admin's origin). The browser
sends `notify-region-request`; the `control-plane-admin` Edge Function handles it
instead of forwarding it, and the notifier validates that its input is exactly
`{ requestId: <uuid> }`. It first calls the control plane's
`claim-region-request-notification`, which atomically stamps `notified_at` on the
request only while it is unset, then sends the email through the shared site
sender and Resend SMTP account in `supabase/functions/_shared/mail.ts` (`SMTP_PASS`),
the same one the region alerts use. If delivery fails, including when the SMTP
sender rejects the requester address, it calls
`release-region-request-notification` to clear the stamp so the administrator can
retry. A second click or tab finds the stamp already set and sends nothing.
Notified rows stay pending with a **Notified** badge until dismissed. Without `SMTP_PASS` the operation returns `notifications_unavailable`. This needs
control-plane migration 097, and the control-plane rollout must come before the
Edge Function deploy.

Focused verification:

```sh
npx tsx --test supabase/functions/control-plane-admin/index.test.ts
npx eslint supabase/functions/_shared/control-plane-admin.ts supabase/functions/control-plane-admin/index.test.ts
```

### VPS inventory loading

The VPS tab first requests `vps-hosts` with `input: { includeLiveData: false }`.
Registered hosts, capacity, and assignments render without live provider or runner
reads. Independent browser requests then load Oracle's card through
`control-plane-host-resources`, fleet telemetry/runner details with
`{ includeLiveData: true, includeProviderInventory: false }` and provider billing
with `{ includeLiveData: false, includeProviderInventory: true }`. Each has its own
loading, error, retained-reading and retry state. Oracle's card never takes its
reading from a later fleet response. A slow runner or billing response cannot
delay Oracle's metrics. Deploy the control-plane operation before this website
change; an older backend produces an explicit Oracle read error without falling
back to the slow fleet request. A slow billing response cannot
hold up resource readings or runner controls; a slow telemetry response cannot
hold up billing. Provider fields merge by host name without replacing current
capacity, assignments, runner state or telemetry.
While visible, Oracle telemetry refreshes five seconds after each completed request;
fleet telemetry refreshes fifteen seconds after each completed request and uses the
normal control-plane request horizon so complete resource readings are retained.
Runner onboarding and update state remains visible from the initial inventory response
while the resource cells refresh independently.
Oracle has its own ten-second browser deadline and retry control.
billing refreshes after 60 seconds and has a separate 15-second browser deadline.
Each loop prevents overlapping requests. Failed refreshes label retained readings
as old and retry automatically. A successful response with missing fields clears
older measurements. Hidden tabs pause all three loops and refresh on return. Leaving
the tab cancels their requests; superseded responses cannot replace new inventory.
Expanded host details remain open during either refresh.
Each collapsed Billing cell shows `Renews MM/DD/YYYY` beneath the price when
auto-renew is enabled, using the provider's expiration date in UTC to preserve
its calendar date. Disabled auto-renew shows `Won't Renew`. Missing renewal
settings or dates remain explicitly unknown; pending or unavailable billing
does not claim a renewal status.
Legacy full responses without `liveDataIncluded` render directly. Deploy the
backend that honors explicit provider exclusion before this website change.
No Edge Function deployment is needed. This isolates the provider failure; it does
not establish or repair the cause of the slow provider call.

### Unused VPS renewal alert

The `vps-renewal-alert` Edge Function emails the administrators about unused
VPSes. It runs daily at 14:00 UTC from pg_cron and authenticates with the
Patreon scheduler secret (`x-patreon-sync-key`). It reads the control plane's
OVHcloud renewal snapshot through the service-role-only
`vps_renewal_alert_hosts` RPC. That snapshot covers every account VPS,
registered or not, and is refreshed every six hours. The function then lists
each VPS whose renewal date is within five days and that has no slot assigned to
a non-deleted server. A stopped server's slot counts as used.

- Manual-renewal VPSes are included and labelled; they expire unless renewed in
  OVHcloud. Dates that have already passed are included.
- VPSes on the account that are not registered as control-plane hosts are
  included and labelled.
- The email repeats daily until the VPS renews, gains a server, or leaves the
  account.
- An empty snapshot, one older than 36 hours, or one that cannot be read sends a
  "could not verify" warning instead of staying silent. A failed RPC call,
  timeout, oversized response, or malformed row counts as unreadable; the cause
  is logged, never emailed.
- Only a failed email delivery returns `503`; it is logged and nothing is
  retried until the next run.

Recipients are the committed region alert recipients in
`supabase/functions/my-servers/alerts.ts`. The sender is the shared site mail in
`_shared/mail.ts`. `SMTP_PASS`, `PATREON_SYNC_SECRET`, `SUPABASE_URL`, and
`SUPABASE_SERVICE_ROLE_KEY` must be set or the function fails at boot. The RPC and
cron come from control-plane migration 098
(`20261011120000_control_plane_ovhcloud_vps_renewals.sql`). Deploy this function
before that migration is applied, so the first cron run finds it:

```sh
npx supabase functions deploy vps-renewal-alert --project-ref <project-ref>
```

The alert only informs. Cancelling, renewing, or resizing a VPS remains a manual
OVHcloud operation.

### Subscription removal warning

The `subscription-grace-alert` Edge Function emails a server owner when the
control plane starts the 72-hour removal grace for their membership-funded
server. Grace starts on confirmed loss of paid benefits, or when the account
unlinks the funding Patreon identity or replaces it with one that does not
qualify. The function runs hourly at minute 20 from pg_cron and authenticates
with the Patreon scheduler secret (`x-patreon-sync-key`).

- It lists active graces not yet notified through the service-role-only
  `subscription_grace_alerts` RPC. The RPC returns the server name, the deadline,
  and the account's Auth email.
- For each grace it calls `claim_subscription_grace_alert`, which records that
  exact grace ID once, then sends the email. A grace another run already claimed
  is skipped. A new grace for the same server gets its own email.
- If delivery fails, `release_subscription_grace_alert` clears that exact claim
  so the next run retries, and the response is `503`.
- Accounts without an email are skipped. At most 20 emails go out per run; the
  rest wait for the next run. Logs name the server ID, never the recipient.

The sender is the shared site mail in `_shared/mail.ts`. `SMTP_PASS`,
`PATREON_SYNC_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` must be
set or the function fails at boot. The RPCs, claim columns and cron come from
control-plane migration 099
(`20261012120000_control_plane_subscription_grace_notifications.sql`). Deploy
this function before that migration is applied, so the first cron run finds it:

```sh
npx supabase functions deploy subscription-grace-alert --project-ref <project-ref>
```

The email only informs. Removal is decided by the control plane and is
cancelled automatically when a qualifying membership is verified.



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
## Server and job progress

Active server details and displayed jobs use the control plane's closed `server-progress`
(`{ serverId }`) and `jobs-progress` (`{ jobIds }`, 1–100 unique IDs) reads. Every browser
request uses the current session and the existing Edge/control-plane authorization path.
There is no cached authority or full-page refresh timer. A single request runs at a time;
the next is scheduled four seconds after completion, widening to 8, 16 and at most 30
seconds when status is unchanged. Progress changes reset the interval. A 30-second
browser deadline bounds slow reads. Hidden tabs cancel the browser read and pause the
timer; returning to the tab reads again and ignores late cancelled responses.

The table retains displayed terminal outcomes and stops when those jobs finish. Newly
created jobs require navigation/reload. On server completion, one authorized dashboard
read updates composition, backups and audit. A deleted server ends the view directly.
Transient failures label retained data and back off; authority loss clears that data
and stops. Changing views/unmounting cancels pending reads.

Initial server detail resolves only its displayed owner using Auth `getUserById`; it
never enumerates the directory, including on lookup failure. Unknown/legacy owners use
the existing ID label. Other views retain their existing directory/selector behavior.
Progress reads make no account-directory calls. A transferred owner's ID remains the
fallback until the page next resolves its label.

Deploy the paired ControlPlane #361 contract first. Older backends produce an explicit
progress error without falling back to whole-page polling. The deterministic API query
counts and website fake-timer/component checks demonstrate reduced scheduled work,
not production timing or bandwidth savings. Linux API coverage and control-plane
verification remain separate from native Windows website tests/builds and live evidence.

## Placement planner

The **Placement** tab shows the control plane's co-tenancy planner, which learns
from reconcile history when each OVH slot server is usually online and proposes
which servers should share a VPS so fewer of them are online at once. See the
control-plane repository's `docs/managed-hosting/placement-planner.md` for the model.

The dry run is never requested on page load. The administrator sets the options
(`historyDays` 14–90, `halfLifeDays` 1–90, `maximumMoves` 0–64,
`minimumGainHours` 0–168 and where always-on servers may move) and selects
**Run dry run**, which sends `placement-plan` from the browser through the
`control-plane-admin` Edge Function. A plan takes a few seconds, so the tab shows
elapsed time; the control plane allows each administrator six plans per five
minutes (`rate_limited`) and one differing plan at a time
(`placement_plan_busy`), and both show retry text. The default `alwaysOnTargets`
value `any` is omitted from the request so a control plane that predates the
option still accepts it, and a plan without per-server `alwaysOn` reads as not
always-on.

The result shows current and proposed fleet totals (co-online pair-hours, hours
with two and three servers online, and the observed replay), the plan's options,
history start, samples and unsequenced servers, then three tables:

- **Moves** in step order, with the from and to VPS, target region, the step's own
  gain (zero or negative for an enabling leg of a swap), a staging badge, and the
  server's quiet window in UTC with its next occurrence in local time.
- **Servers**, moving ones first, with current and proposed VPS, why a server is
  pinned, an always-on badge, weekly online hours, observed days and a 7×24 heatmap
  of its hourly online probability (Monday first, UTC). Each square has a title and
  the grid has a text summary for assistive technology.
- **VPS hosts**, most contended first, with capacity, whether relocation may target
  them, current and proposed contention and their servers.

Nothing is relocated by the plan. Each step's **Relocate** reads the server's
`server-dashboard` for its current `updatedAt`, then opens the Relocate tab's
dialog preselected to the step's `targetRegion` and `toServiceName`. The dialog
keeps its own request UUID, stale-generation replay and confirmation; it sends
`relocate-server` with the reason `Placement plan step N`. The tab's server-rendered
reads are only the fresh slot inventory (`vps-hosts` without live data), the region
catalog and active jobs, so each step is checked against where its server is now:
only the first unfinished step may run, a step whose server already reached its
VPS reads **Done**, a server with another active job waits, and a server no longer
on the step's source VPS asks for a new dry run. **Refresh status** re-reads those
without discarding the plan. Relocation stops a running game and changes the
server's address and game port. No Edge Function change is required.

### Automatic executor

The top of the Placement tab shows the automatic placement executor, read in the
browser with `placement-executor` when the tab opens. Its current state is shown
first: **On · relocating servers automatically** or **Off · nothing moves
automatically**, with who last changed it, when and why (or that the defaults
were never saved). The form edits all five settings (`enabled`,
`maximumRelocationsPerDay` 1–24, `minimumGainHours` 1–168, `alwaysOnPolicy` and
`noticeLeadHours` 1–168) plus an optional audit reason, and **Save settings**
sends `set-placement-executor` with `expectedUpdatedAt` set to the `updatedAt` it
read (null when never saved). Turning it on asks for a browser confirmation that
spells out what it does: the control plane relocates customer servers by itself
within the daily cap, each move stops the game and changes the server's address
and game port, and always-on servers move only in their quiet window after a
notice on their page. The `single-slot` policy means one-slot VPSs only, which
the server never shares. A `stale_interaction` rejection reloads the settings
someone else saved and asks the administrator to review them before saving again;
`relocation_provider_unsupported` explains that enabling needs live OVH mode.
Below the form, the 50 newest automatic relocations show their mode (offline or
announced), state, gain, scheduled, queued and completed times and error code.

## Server notices

A server notice is a plain-text message at the top of selected servers' pages,
shown to everyone who can view the server until they dismiss it, it expires or an
administrator withdraws it. It is not email or a Discord message; the retired
owner announcements have no website form. See the control-plane repository's
`docs/managed-hosting/server-notices.md`.

The **Notices** tab renders the first 100 servers from the existing `servers`
read on the server, so the page keeps its fresh administrator authority. The
search box re-reads `servers` with its query filter from the browser, and
**Load more servers** follows its cursor, so selections survive searches. An
administrator can tick servers one by one or **Select all shown**, sees the
selected count and can remove each one; a notice targets at most 500 servers.
The form takes a one-line title (at most 120 characters), a plain-text message
(at most 2,000; line breaks kept), severity, an optional expiry and an audit
reason. The expiry is entered as browser-local `datetime-local` time and sent as
UTC with milliseconds; it must be in the future and within a year. Posting asks
for confirmation and sends `create-notice`. Its request UUID is the idempotency
key: an unchanged retry after an error or uncertain response reuses it (a replay
reports that the notice already exists), and changed content or a submission
after success gets a new one. Validation failures show the control plane's
message.

The list below reads `notices` 25 at a time, newest first, with **Load older
notices** following `nextCursor`. Each notice shows its state (active, expired or
withdrawn), severity, kind, message, creation and expiry times, target and
dismissal counts, up to five target names with how many more, its author and
reason. **Withdraw** asks for confirmation and sends `withdraw-notice`.

### Owner banner

`/servers/[serverId]` reads the viewer's undismissed notices with the closed
owner read `server-notices` through `getMyServerNotices` (strict DTO, at most ten,
64 KiB response) whenever the page has a managed server, both on the managed page
and on a live page linked to one. The read has a five-second bound and any
failure, including an older control plane that lacks the operation, renders the
page without notices. `ServerManagementWorkspace` shows them in its `banner` slot
between the back link and the header. Each card is plain text with its line
breaks; `info` cards are `role="status"` and `warning` cards `role="alert"`.
Administrator notices show their title and message untranslated. The two
placement kinds are written in the viewer's language from their parameters:
`placement-scheduled` from `scheduledAt` and `windowMinutes`, in the viewer's time
zone, and `placement-completed` with the new `address` when it is a valid
`ip:port` (a variant without it otherwise). A scheduled notice without a usable
`scheduledAt` falls back to the stored English title and message.

**Dismiss** calls the `dismissManagedServerNotice` server action, which sends the
`my-servers` Edge Function the closed mutation
`{action: "dismiss-server-notice", serverId, noticeId}` with a request UUID; the
function forwards `dismiss-server-notice` to the control plane and accepts only
`{dismissed: true}`. The card hides on success, and also on `notice_not_found`,
since that notice is not for this server. An administrator impersonating a user
gets HTTP 403 `impersonation_read_only` and a short localized explanation; other
failures keep the card with a localized retry message.

### Owner move status

The same pages read the owner operation `server-move-status` through
`getMyServerMoveStatus`, in parallel with the notices and with the same
five-second bound; any failure, including an older control plane without the
operation, shows no move. The DTO is strict: exact keys, one of the six states,
millisecond UTC timestamps, one of the seven steps, an `address` that is a real IPv4
or bracketed IPv6 address with a valid port, and exactly these fields per state
(anything else is rejected):

| State | `scheduledAt` | `startedAt` | `completedAt` | `step` | `address` | `stayedOnOriginal` |
| --- | --- | --- | --- | --- | --- | --- |
| `scheduled`, `starting` | set | null | null | null | null | null |
| `moving` | set or null | set | null | set or null | null | null |
| `returning` | set or null | set | null | null | null | null |
| `moved` | null | set | set | null | set or null | null |
| `failed` | null | set | set | null | null | set (boolean) |

`ManagedServerMoveProvider` wraps the workspace and polls the
`readManagedServerMoveStatus` server action while the page is visible: every 60 s
with no move or a finished one, every 30 s while one is scheduled, and every 5 s
from two minutes before `scheduledAt`, while `starting` and while `moving` or
`returning`. A failed read keeps the status shown and backs off to at most five
minutes. Showing the page again always reads at once, and a read that was under
way meanwhile is followed by another as soon as it returns. A new state, address
or completion time calls `router.refresh()` once so the header, address and
notices follow; a new step alone does not. A refreshed page that renders a
different move status is shown at once and confirmed by an immediate read; a read
that only restores the status shown before does not refresh again, and a refresh
that renders no move (which a failed server-side read also produces) is not
adopted. While a moved server's new address differs from the header address the
page passes in, the next reads refresh the page again, at most three times per
move. On a live page linked to a managed server, the header uses the managed
server's address when it has one.

`ManagedServerMoveStatus` is the first card in the `banner` slot: a countdown and
the start time in the viewer's zone while scheduled, the steps with the current
one and the elapsed time while moving (an "In progress" line and no current step
before the job reports one), a progress line while returning, and the new address
with **Copy address** once moved; a failed move says whether the server stayed on
its original machine. Once moved, the header address is revealed once per move,
as soon as the header shows that address: after the refresh that delivers it, or
on a page opened later, unless the card was dismissed.

Only finished moves can be dismissed. The dismissal is remembered in this browser
by `completedAt` under `bannerlordcoop.servers.moveDismissed.<serverId>`. A
`placement-completed` notice belongs to the moved card when it was created at or
after `completedAt` and, if both name one, has the same address; servers keep
earlier moves' completion notices for 14 days and those are left alone. The notice
banner hides every `placement-scheduled` notice whenever the card has a move (the
control plane withdraws the announcement only when the move settles, up to about a
minute after the job finishes, and administrators cannot write placement kinds) and
the moved card's own completion notice. Dismissing the card dismisses that notice,
including one that only reaches the page after the dismissal (once per notice per
page). While `moving` or `returning` the header lifecycle names the move instead of
"Maintenance", Start, Stop, Restart and Update now are disabled with an
explanation, and the stopped console says the server is moving.

Deploy the control plane that adds these operations before merging this website
change. Merging to main redeploys `my-servers` through the Supabase hosting API
workflow; the notice read degrades to no banner against an older control plane,
and the admin Notices tab and executor panel show the control plane's error.
