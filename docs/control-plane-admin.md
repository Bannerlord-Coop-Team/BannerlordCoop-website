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
- registered VPS capacity (OVHcloud and Contabo account inventory, plus manually entered HostHatch and VPS.TC hosts) and reviewed location IDs and live read-only cost, expiration, and auto-renew metadata;
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

The Operations page's **Onboard provider-account VPS** card is the normal additive host-ingestion path for providers with an account API (OVHcloud and Contabo). Its choices are the inventory's `availableHosts` (unregistered hosts from every enabled provider account, labelled `<provider> · <service name>`); each option carries that host's `provider` and `serviceName`, and the card sends both. The inventory's `providerReads` reports each enabled provider's account read; a failed read withholds only that provider's unregistered hosts and billing, and the Operations and VPS views name the failed provider. The control plane verifies that the already-purchased service belongs to that provider's account, derives the reviewed image within the control plane, records `floor(vCPU / 2)` empty slots (more after a [slot capacity raise](#raising-a-vps-slot-capacity)), and writes an administrative audit event. It never purchases, renews, or powers the VPS. The VPS view's per-host **Onboard runner**, **Retry onboarding**, and **Update runner** buttons send the host row's own `provider` with its service name; the control plane requires it and rejects a provider that differs from the stored host. Server creation assigns an existing prepared VPS slot in the selected region; it never orders a VPS, and unavailable capacity fails without creating or billing anything. The Region choices are the stored-catalog entries that `hosting-regions` reports `available: true` (a free slot admissible under the owner admission rules), in stored order, labelled from the website catalog or the humanized key. That flag is advisory: only the region key (`friendlyRegion`) is sent, and the control plane revalidates capacity. Its optional **Provider** select pins the new server to one provider (sent as `provider`, which the control plane accepts only for an enabled provider); it lists the providers holding at least one registered VPS, by name, and its default **Any provider** sends nothing, so the control plane tries the enabled providers in their configured order. Pin a newly onboarded provider to verify it end to end before owners land on it. If the stored catalog cannot be read, Create server is shown unavailable with the read error. The VPS view also reads the stored catalog and labels each host with every stored region whose placement its provider-reported country and zone satisfy, then the country and zone. A host no stored placement covers is labelled **No stored region** until a catalog entry is published, and **Regions unavailable** when the catalog cannot be read. The normal Releases view hides non-validated history, but pending, rejected, and revoked receipts remain retained for explicit inspection and audit rather than being deleted.

A provider without an account API (HostHatch, VPS.TC) is onboarded with the
**Add manual VPS** card (`#onboard-manual-vps-host`), which the VPS view's
**Add manual VPS** button also opens. Its providers are the `vps-hosts`
result's `manualEntryProviders` (`{ provider, displayName }`); a backend that
omits the field is treated as offering none, and the card then explains that it
is unavailable instead of showing the form. The administrator types the host's
facts from the provider panel: a permanent server name
(`^[A-Za-z\d][A-Za-z\d.-]{0,63}$`), the SSH login as exactly `root@<public IPv4>`,
the vCPU count (2–64; the card shows the resulting `floor(vCPU / 2)` game
slots), a region from
the stored catalog (every region, not only those with free capacity), a country
limited to that region's placement countries, a location chosen from the
region's location IDs when it names them and otherwise typed as a short code
such as `ams`, and the optional player hostname and datacenter label. The
server name, location and datacenter placeholders and the server-name help
follow the chosen provider (`vpstc-ist-1`, `ist` and Istanbul for VPS.TC);
neutral ones show when no provider is chosen or the provider has none of its
own. The card validates these grammars in the browser, asks the administrator to confirm the
IPv4 address once more, and sends `onboard-manual-vps-host` with exactly those
nine fields; blank optional fields are sent as `null`. The card asks for no
host key: as for an account VPS, the control plane scans the host key at the
entered address on first contact and pins it for every later connection, so the
administrator need not copy anything from the provider console. Because that
first contact trusts whatever machine answers at the address, the IPv4 address
is the fact to double-check. The control plane remains authoritative for every
check. Success
opens the VPS view, and a failed attempt is retried there with the existing
**Retry onboarding** button, which sends `onboard-vps-host` with the host row's
own provider, its service name and `mode: "retry"`. The `control-plane-admin`
Edge Function forwards the envelope unchanged, so it needs no redeploy; deploy
the control-plane release that adds `onboard-manual-vps-host` and
`manualEntryProviders` before this website change. Against an older backend the
card stays unavailable. The control plane's strict schema rejects the
`hostPublicKey` field earlier releases required, so deploy the control-plane
release that drops it (and scans the key itself) no later than this website
change; a control plane that still requires the field rejects the card's
request.

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


## Custom mods

The managed page's **Mods** tab uses the same `my-servers` Edge Function with two
explicitly allowlisted resources: `POST ?resource=mods&route=<route>` relays one of
the six JSON routes to its fixed `/api/v1/mods/...` path (64 KiB bodies, 90 s
upstream wait), and `PUT ?resource=mod-chunk&uploadId=<UUID>&index=<n>` reads one
whole chunk of at most 8 MiB before forwarding it to
`/api/v1/mods/uploads/chunk` with its `x-chunk-sha256` (120 s upstream wait). The
browser never calls the Edge Function directly; same-origin website route handlers
revalidate the session and relay through it. Start refusals `mod_load_failed` and
`crash_loop_cooldown`, and a Start status's `modLoadFailure`, are shown to owners.
[Server mods](server-mods.md) has the complete contract, retry rules and rollout
order (control-plane release and `--enable-mods` runners, the separately authorized
Oracle `@mods`/`@modChunk` proxy matchers, then this function).

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

### Raising a VPS slot capacity

Each expanded VPS row ends with a **Slot capacity** field and a **Raise slots**
button. It sends `raise-vps-slot-capacity` with the row's own `provider` and
service name, the entered `slotCapacity` and a fixed audit reason, after a
confirmation. A slot reserves no cores: the placement planner plans about 1.6
vCPU for each server online together and prefers VPSs whose servers rarely are, so
a VPS may hold more servers than its vCPUs suggest. More online at once than that
fits (about three on a 6-vCPU VPS) share its cores and slow each other. The field takes a whole number above the current capacity and at
most 32, since a capacity is never lowered; the control plane checks the same
bounds against the stored host. The button is disabled until the row's runner
onboarding has succeeded and once the VPS holds 32 slots.

The control plane refuses the request unless it runs with
`HOSTING_DYNAMIC_SLOT_CAPACITY` on, which is off by default, and while the VPS's
onboarding, runner revision, runner update, slots or relocations are not settled.
The form shows each refusal as a sentence naming what to do. A success is accepted
only when the result names the requested host and capacity
(`parseRaiseVpsSlotCapacityResult` in `src/app/lib/control-plane/slot-capacity.ts`);
anything else is reported as an unexpected result. After a raise the row's runner
onboarding is queued again and refreshes automatically while the new slots are
commissioned; the VPS takes no new server until it succeeds, and its current
servers keep running. Deploy the control plane that has the operation first: an
older one rejects the unknown operation. While the VPS has an unsettled slot
decommission the control plane refuses a raise with
`vps_slot_capacity_decommission_planned`, which the form explains.

### Decommissioning VPS slots

Below **Raise slots**, each expanded VPS row has the slot decommission controls
(`VpsSlotDecommission`; the control plane's `docs/managed-hosting/ovhcloud-vps.md`,
"Decommissioning VPS slots", defines the operations). The control plane page is
administrator-only, so a member never sees them, and the `control-plane-admin` Edge
Function, which needs no change, refuses anyone but an administrator. The control
plane decommissions slots on OVHcloud VPSs only (`vps_slot_decommission_provider_unverified`
otherwise), so any other VPS's row shows "Slot decommissioning is not supported on
this VPS" instead of the controls.

- **Decommission slots** takes **Keep slots**, a whole number from 1 to 31 below the
  current capacity with no leading zero, and a **Reason** of 3 to 1,000 characters for the audit log.
  After a confirmation that names the slots it retires (the slot table's numbering,
  so a 4-slot VPS kept at 2 retires Slots 3–4), it sends `decommission-vps-slots`
  with the row's `provider`, service name, `slotCapacity` and `reason`. It is
  disabled for a VPS never onboarded, while its runner onboarding is queued, running
  or waiting to retry, and at one slot.
- **Cancel decommission** sends `cancel-vps-slot-decommission` with a fixed reason
  after a confirmation. It stays available while the onboarding runs, since a queued
  decommission job meets a cancel; with no plan open the control plane answers that
  nothing changed.
- **Resolve / accept** appears only when the row's onboarding `failed` with exactly
  one of the codes the control plane resolves (its
  `VPS_SLOT_DECOMMISSION_RESOLVABLE_CODES`): `slot_decommission_kept_units_restarted`,
  `_controller_unavailable`, `_game_newly_failed`, `_game_changed`,
  `_canary_changed`, `_assignment_changed` or `_tunnel_refused`. Other kept-slot
  codes are not resolved: `slot_decommission_kept_unsettled` and
  `slot_decommission_kept_unobservable` call for a cancel, and
  `slot_decommission_kept_health_unavailable` for a retry. The form names the slot
  the check failed on from the onboarding's `slot-decommission-kept-slot-<k>` stage
  ("Slot 2 (index 1)") and what failed. After a confirmation that names that slot,
  its code and the onboarding time it answers, it sends
  `resolve-vps-slot-decommission-kept-slots` with exactly the row's `provider` and
  service name, `slots` (each kept slot's zero-based index, without a leading zero,
  with `disposition` `accept` or `repair`), a reason and
  `expectedOnboardingUpdatedAt`. It names no `token` or `expectedEvidenceVersion`
  (both optional, and given together or not at all), so the control plane resolves the
  VPS's open retired plan at its stored evidence version.
  `expectedOnboardingUpdatedAt` is the row's `runnerOnboarding.updatedAt` exactly as
  the VPS read returned it for the failure the form shows, which the form also names;
  the page reads nothing again at submit. If the onboarding moved on since (a requeue,
  or a later failure), the control plane refuses with
  `vps_slot_decommission_onboarding_changed`, shown as "The runner state changed since
  this page loaded. Refresh and review the current failure before resolving."

A decommission job the switch paused waits in `retry-wait` with error code
`slot_decommission_disabled` and stage `slot-decommission-paused`, spending no
attempt. The Runner column shows it as a waiting state, not an error: "Decommission
paused: the dynamic slot capacity switch is off. The host takes no new servers until it
is switched on again."

Like the raise, every request carries a fresh `requestId`, which the control plane
uses as the decommission's correlation id; the inputs carry no correlation id. A
plan answered `draining` (its retired slots still hold a server) is queued only by a
new request, so the result asks for the same decommission to be submitted again once
the named slots are empty.

Each result is accepted only with exactly its keys, for the requested host
(`parseDecommissionVpsSlotsResult`, `parseCancelVpsSlotDecommissionResult` and
`parseResolveVpsSlotDecommissionResult` in
`src/app/lib/control-plane/slot-decommission.ts`): a decommission's
`occupiedSlotIndexes` must ascend within the retired slots, and a resolution's
`runnerOnboarding` must be present. Anything else is reported as an unexpected
result. Every outcome (`draining`, `queued`, `unchanged`, `completed`, `cancelled`,
`superseded`; `cancelled` or `unchanged` for a cancel; `requeued` for a resolution)
has its own sentence; `unchanged` reads "Nothing changed: this VPS already has a
decommission or runner job queued or under way. Follow the Runner column.", which
holds for each path that answers it. Every refusal code, and each operation's
`request_conflict` message, has a sentence naming what to do.

**With the switch off**, the production setting, the control plane answers a
decommission with `vps_slot_decommission_disabled` and changes nothing. The form shows
it as a calm note, not an alert: "Slot decommissioning is switched off on this
control plane (HOSTING_DYNAMIC_SLOT_CAPACITY is off), so nothing was changed." An
older control plane with the operations but no worker (`vps_slot_decommission_worker_unavailable`,
which the control plane with the worker no longer answers) and one without the operation (HTTP 400 `invalid_request`, or `unsupported_operation`)
read as calm notes too; the decommission form checks every field the control
plane checks before it answers `invalid_request` (the slot count and the reason), so
there it means the operation is unknown. A cancel answers `unchanged`. The control
plane that has the resolution is the release with the decommission worker; until it
deploys, a resolution reads "This control plane cannot resolve kept slots yet, or
refused the request as invalid", as a calm note (the form checks the slots and the
reason first). A resolution is not gated by the switch. Every other refusal is an
alert.

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

The **Placement** tab shows, in this order, the **measured host overlap** (what
actually happened on each shared VPS over the last week), the **automatic
placement** panel (its switch, status, waiting-to-retry list and live moves) and
the control plane's co-tenancy planner, which learns from reconcile history when
each OVH slot server is usually online and proposes which servers should share a
VPS so fewer of them are online at once and, where measured, so each VPS has the
CPU its online servers need. See the control-plane repository's
`docs/managed-hosting/placement-planner.md` for the model and the measured overlap.

Since control plane #522 the planner and the automatic executor are
capacity-aware: they minimize pair-hours plus 20 times the expected CPU shortage
in core-hours a week, from each server's measured CPU demand against each VPS's
measured usable cores. Without those measurements they plan exactly as before.
The responses keep their shapes, and every gain the tab shows
(`gainPairHoursPerWeek`) is still pair-hours only, so a move made for the CPU
shortage it removes can show a small, zero or negative gain; the executor stores
it as at least 0, shown as 0.0. The tab's texts say so: the dry run's gain
titles, the minimum-gain help and the totals' pair-hours help, the executor's
description and `set-placement-executor` explanation, and the live moves' gain
title. Deploy control plane #522 first, then this wording. The control plane
change needs no website change, and the wording reads true of a control plane
that already plans on capacity.

### Measured host overlap

The tab's first pane, **Host overlap** ("Measured over the last 7 days"), sends
`placement-overlap` with `{}` from the browser when the tab opens, through the
same `control-plane-admin` Edge Function as `placement-executor`. That function
forwards any administrator's operation to the control plane without an
allowlist, so no Edge Function change is needed. It needs control plane #517 or
later; an older control plane rejects the unknown operation as
`invalid_request`, and the pane then says the control plane does not report
measured overlap yet. The read is kept while the tab stays open and is not
polled: **Refresh** reads it again (one read at a time), and the control plane
allows each administrator six reads per five minutes (`rate_limited`, with retry
text). While it loads the pane says so; a failed read shows its message with
**Retry**, keeps any overlap it already showed and never affects the rest of the
tab.

#### Burst capacity

A server averages about 1.2 vCPU and 1.5 GB of RAM, so sharing a VPS only hurts
when servers that are online together cannot burst. Each server needs room to
burst to 1.6 vCPU and 2.5 GiB, the fleet capacity model's burst targets, and a VPS
has room for `burstServers` of them at once:
`min(floor(vCpu / 1.6), floor(memoryBytes / 2.5 GiB))`, or `floor(vCpu / 1.6)` when
the runner's RAM could not be read. An hour is red when more of a VPS's servers were
online than that, because if they all burst at the same time they would be
throttled. Per hour, with *k* the occupants with data that were online at least
half the hour and *u* the occupants without data, `overBurst` is `1` when *k* is
more than `burstServers`, `-` when *k* is not but *k* + *u* is, and `0`
otherwise; a VPS with no more occupants than `burstServers` is all `0`, and
`overBurstHours` counts the `1` hours.

Today every VPS's `burstServers` equals its slots (4 vCPU and 7.58 GiB give 2,
6 vCPU and 11.41 GiB give 3), so no VPS can be red. Red appears once a VPS holds
more servers than its burst capacity, such as four on 6 vCPU after a
[slot capacity raise](#raising-a-vps-slot-capacity).

#### Response shapes

The response is parsed strictly, in one of two shapes, and every host in a
response has the same one; a mix is an unexpected response. Both shapes need
exact keys, `hours` 168, a window of exactly 168 hours whose bounds fall on whole
UTC hours, millisecond UTC times, 168 `online` entries that are null or finite
and non-negative, `hoursWithData` 0–168, finite measured pair-hours and coverage
(0–1), no more occupants than slots, each server on one VPS only and no hour with
more online than occupants. Online counts are rounded to two decimals, so the
online bounds allow 0.01. The parser does not check slots against vCPUs: the
control plane owns slot capacity.

- **Burst capacity**, from control plane `ao/placement-burst-overlap` on. Each
  host has, in order, `serviceName`, `regionKeys`, `vCpu`, `memoryBytes`,
  `slots`, `burstServers`, `occupants`, `online`, `overBurst`, `overBurstHours`,
  `measuredPairHours` and `coverage`. `memoryBytes` is null or a positive safe
  integer. `burstServers` is a non-negative integer no more than
  `floor(vCpu / 1.6)` and, when `memoryBytes` is not null, no more than
  `floor(memoryBytes / 2.5 GiB)`. Earlier control planes counted 2 vCPU or 3 GiB
  per server, which never gives more, so their responses still parse.
  `overBurst` matches `^[01-]{168}$` and
  `overBurstHours` is its count of `1`. A VPS with no more occupants than
  `burstServers` must be all `0`. On any other VPS a `0` or `1` hour needs data
  (`online` not null), and a `1` hour needs `online` of at least half of one more
  than `burstServers`, less 0.01, because each of those servers was online at
  least half the hour.
- **Legacy**, from control plane #517 (`98d1f12a`) before burst capacity, kept so
  that a control-plane rollback still renders. Each host has `allBusy` and
  `allBusyHours` in place of `memoryBytes`, `burstServers`, `overBurst` and
  `overBurstHours`. `allBusy` matches `^[01-]{168}$` with `allBusyHours` its
  count of `1`; a `0` or `1` is only for a VPS with as many occupants as slots in
  an hour with data, and a `1` needs `online` of at least half the number of
  occupants, less 0.01. The pane does not draw this verdict.

From control plane #550 the response has a third shape, **at once**: every host
of the burst-capacity shape adds exactly `atOnceServers` (N, the servers the VPS
can run at once at what they usually need, from the capacity model of the same
inventory; null or a non-negative integer), `overAtOnce` (encoded as
`overBurst`, but against N) and `overAtOnceHours` (its count of `1`). Which hours are over N is the
control plane's to work out, so the website checks only their format and count,
not each hour against N. The burst fields are then information only and still
checked as before. A read is in one
shape throughout: at once, burst capacity or legacy.

The control plane sends the burst-capacity response. Until control plane #529
its `burstServers` counts 3 GiB per server; from #529 it counts 2.5 GiB, which
counts more servers on a VPS whose memory, not CPU, is the limit (none today).
Deploy this website (#357) before #529: it accepts both counts, while the
website before it bounds `burstServers` by 3 GiB and would reject a higher one.

#### What the pane shows

The pane opens with one sentence for both response shapes: "How the servers on
each VPS with more than one slot were online together in each of the last 168
hours." Every VPS with more than one slot is listed, empty ones too, grouped by
region (alphabetical, hosts without a region last). Each row shows the service
name without `.vps.ovh.net` (the full name in its title), its slots and current
servers (or **Empty**), a 168-cell strip and, on the right, "N h over burst" for
a VPS with more occupants than `burstServers` (**Bursts fit** for any other), the
measured pair-hours ("7.5 pair-h measured") and the coverage ("71% measured").
The burst capacity itself is not shown.

The pair-hours and coverage figures are `MetricHint` buttons
(`src/app/components/admin/MetricHint.tsx`, shared with other admin views), each
described by a tooltip (`role="tooltip"`, linked with `aria-describedby`, so a
screen reader announces it with the figure). A tooltip opens when a mouse or pen
hovers the figure (a finger does not hover, and a tap's emulated hover does not
count), when the figure takes keyboard focus, and on a tap. It closes when the
mouse or pen leaves, focus leaves the figure or moves to any other control (a
capture-phase `focusin` outside the figure), Escape is pressed (wherever focus
is, through one capture-phase `keydown` listener held only while a tooltip is
open), the figure is tapped again, anything outside the figure is pressed, or the
window or the strips scroll or the window resizes. Because focus moving elsewhere
closes it, a tooltip is never left open over a dialog opened from another
control, such as the Placement tab's relocate dialog: `showModal()` moves focus
into the dialog, which closes the tooltip before the dialog's own Escape (its
`cancel` event) can matter. Escape with a tooltip open closes only the tooltip
and stops the key there (`stopPropagation`, without `preventDefault`), so Escape
handlers further along, such as a menu's, act only on the next Escape, which the
tooltip leaves untouched. A native modal dialog that a tooltip itself sits in
still closes on that Escape too, through its `cancel` event, which stopping the
key cannot block. Enter or Space toggles it by its own state and never by an
earlier pointer press; a press that never becomes a click (a right-click, a
cancelled touch, a press dragged off before release, or one whose figure lost
focus) is forgotten, so it cannot sway a later activation. A finger leaving the
figure between its release and its click still counts as a tap, but a released
press waits for its click only until a scroll, a press anywhere else or one
second passes, any of which forgets it. Only one tooltip is open on the page at a
time: opening one, by hover, focus or tap, closes any other. It is fixed to the
window, right-aligned with its figure, below it or above it near the window's
foot, so the strips' scroll box never clips it. The coverage tooltip says what
is measured: the share of the 168 hours in which every current server had at least
one counted check, wherever it ran then, with 0% for a VPS with no servers (the
control plane reports `coverage` 0 for an empty VPS); the control plane's check
about every five minutes (`running` online;
`stopped`, `awaiting-save` or `failed` offline; `drifted` or `degraded` not
counted); a server's online share in an hour as its running checks over its
counted ones; and an hour without a counted check as unknown, not offline, with
an hour no server has data for hatched. The pair-hours tooltip says they add up,
for every pair of servers that both have data in an hour, the product of their
online shares (1 for both online all hour, 0.25 for both online half of it), with
examples, and that lower means less overlap and less competition for the VPS.
These match the control plane's `coverage` and `measuredPairHours` definitions in
its `docs/managed-hosting/placement-planner.md`.

The strip is the window's real hours, oldest first, under a day axis of UTC dates.
A window that starts mid-day begins and ends with part of a day, and every date
segment gets a label that fits it: "Mon 12 Oct" from 14 hours, "12 Oct" from 8, the
day of the month ("12") from 3, and no visible text for a one- or two-hour sliver.
Each segment's title gives its full date.
Each cell is shaded by `online` over slots on the heatmap's ten bands, and an hour
with no data (`online` null) is hatched, never the shade of an hour with nobody
online. Only under a VPS with more occupants than `burstServers`, the only kind
that can be red, a thin row marks the `1` hours of `overBurst` in red, shows `0`
hours as a faint measured cell and hatches `-` hours (servers without data could
have put it over). Each cell's title gives its date and hour, the online count and
how many can burst together ("Wed 14 Oct 20:00 UTC · 4 online; 3 can burst
together"), adding "over burst capacity" on a red hour. Each strip has a text
summary (slots filled, how many can burst together, the hours over burst or
"bursts fit", the busiest hour and the coverage, or "empty"). After its shading
and no-data keys the legend adds "Red: more servers online than can each burst
to 1.6 vCPU and 2.5 GiB".

An at-once response marks its red row from `overAtOnce` instead, under a VPS
with more occupants than `atOnceServers`, and its legend reads "Red: more servers
online than the VPS can run at once at what they usually need". Each row's right
column says "Fits at once", "*N* h over at once" or "At once not modelled yet",
then, as information, "3 can burst together (1.6 vCPU, 2.5 GiB each)", the
overlap's own burst capacity, not the capacity tab's burst headroom. A cell's title adds
"can run *N* at once" and, on a red hour, "over at-once capacity", before the
burst capacity it keeps as information ("Wed 14 Oct 20:00 UTC · 4 online; can run
4 at once; 3 can burst together, over burst capacity").

A legacy response is shaded the same way but has no red row, no red legend
entry and no "over burst" or "Bursts fit"; the legend keeps its shading and
no-data keys, and the pair-hours and coverage tooltips are the same. The pane
notes "This control plane predates burst capacity; red hours appear after it
updates." A footer reads
"Measured *start*–*end* UTC · generated *time*".

### Dry run

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
history start, samples and unsequenced servers, then these sections:

- **Moves** in step order (by pair-hours and weighted CPU shortage removed
  together), with the from and to VPS, target region, the step's own gain in
  pair-hours (zero or negative for an enabling leg of a swap or for a move made to
  relieve a CPU shortage, which its title says), a staging badge, and the server's
  quiet window in UTC with its next occurrence in local time.
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

This switch-only panel requires control plane #516 or later, which fixes the
rules below, and must be deployed after it; an older control plane still applies
the stored minimum gain, notice lead and always-on policy.

Below the measured host overlap and above the dry run, the Placement tab shows the
automatic placement executor, read in the
browser with `placement-executor` when the tab opens. It has nothing to configure:
a heading, one sentence on what it does, a single **Automatic placement** switch
(`role="switch"`, with **On · relocating servers automatically** or **Off ·
nothing moves automatically** beside it and "On since" or "Off since" the
settings' `updatedAt`), the status line, the waiting-to-retry list and **Live
moves**. It never shows who switched it or why. The rules are fixed by the
control plane: a move must save at least 20 pair-hours a week, remove at least 1
core-hour a week of expected CPU shortage, or a mix of the two (control plane
#522; before it, 20 pair-hours alone), a stopped server
moves at once and stays stopped, a running server gets an hour's notice on its
page and in-game warnings before it moves and starts again, and always-on
servers move only to one-slot VPSs, which they never share.

The status line from the read's `status` says what it is doing: **Moving now**
with the server, its VPSs and, once its job has reported one, its current step;
**Announced** with the server and when it moves; **Returning** while a failed
move puts its server back on its original VPS; **Move failed**, **Move
cancelled** or **Move finished** when a queued move's job has ended but the
executor has not recorded the outcome yet; or **No move under way**. Then "N
moves queued in the last 24 hours" from `queuedInLast24Hours`, an informational
count: only one move runs at a time. Below it, each server in `status.backedOff`
reads "Waiting to retry: *server* until *time* (*reason*)": the executor leaves a
server whose latest automatic move failed, or was cancelled other than by
switching the executor off (`placement_disabled`), alone until then. The name
comes from the listed move with that `relocationId` or `serverId`, else the
server ID is shown, and the reason is the plain explanation of its `errorCode`
(or the code itself).

Switching sends `set-placement-executor` with `enabled`, `expectedUpdatedAt` set
to the `updatedAt` it read (null when never saved) and a fixed audit reason,
"Switched automatic placement on from the admin panel" or "… off …", because the
control plane requires one. Switching on first asks for a short browser
confirmation that the control plane will start moving servers by itself and
that each move stops the game for a few minutes and changes the server's address
and game port; switching off saves at once. The settings read can also carry
`maximumRelocationsPerDay`, `minimumGainHours`, `noticeLeadHours` and
`alwaysOnPolicy`, legacy fields: control planes before #516 require them on every
save (#514 already accepts the cap as optional and ignores it), and #516 and later
ignore all four. The panel never shows them: each
switch sends each one back exactly as the latest read of any kind gave it (the
first read, a poll, the stale reload or the previous switch's response) and
leaves out any that read did not carry, so a save succeeds in either deploy order
and after a rollback. The panel still deploys after #516, so the fixed rules it
states hold. A `stale_interaction` rejection reloads the state someone else saved
and asks the administrator to switch again if they still want to;
`relocation_provider_unsupported` explains that enabling needs live OVH mode.

**Live moves** lists the 50 newest automatic relocations, those
announced or queued first. Each shows the server, its from and to VPS (without the
`.vps.ovh.net` suffix; the full names are in the title), target region, mode,
gain in pair-hours (its title says a move made to relieve a CPU shortage can show
0.0) and state, and a track from each relocation's `progress`: **Warned** →
**Starting** → **Saving & stopping** → **Restore point** → **Restoring** →
**Switching address** → **Starting game** → **Finishing** → **Done**. Each step
the job reached shows when it first reached it, in the viewer's time zone with
seconds, and the step under way is marked `aria-current="step"`. The stops are
equal columns of one grid (at least 5.5rem each), with a small chevron drawn in
the gap between them; their labels, times and notes wrap inside the stop, and a
panel too narrow for the row scrolls the track rather than cutting it off. Every stop says
its phase in words (done, current step, not reached, not needed, failed or
cancelled) and any note in visible text, so colour only repeats it. **Warned**
lists the 60- and 10-minute in-game warnings as sent (with the time), pending, not
possible on this runner or not sent; an offline move says no warning was needed
because the server was stopped. When `restartsGame` is false the game step reads
**Stays stopped**: the relocator never starts a game that was stopped. With no job
yet (`null`) it reads **Starting game** with the note that it starts only a game
still running when the move begins. While `progress.returning` is true a
**Returning** stop is the current step, saying the server is being put back on its
original VPS, so the move never looks stalled. A queued move whose job failed or
was cancelled (`jobState`) has no current step and reads as such until the
executor records it; the relocation's `errorCode` is set then, as the job's code
is not part of `progress`. In both cases **Done** is not reached and says why. A
finished move shows how long its job took; a failed or cancelled one shows its
`errorCode`, with a plain explanation for the executor's own codes
(`placement_disabled`, `placement_window_missed`, `server_not_found`,
`placement_job_missing`, `placement_job_cancelled`). For an older control plane,
a relocation without usable `progress` shows the move's scheduled, queued and
completed times instead of a track; `progress` without `returning` is treated
as not returning; a read without `status` shows no status line, and one without
`backedOff` shows no servers waiting to retry.

While any relocation is announced or queued, the panel reads `placement-executor`
again every 15 seconds, only while the page is visible; showing the page again
reads at once, and the reads stop once nothing is active. They update only the
status, the moves and the four legacy values: the switch's state and its
`updatedAt` stay as last read, so a switch is still checked against the state the
panel shows. Polls, the stale reload and **Retry** share one read at a time: a
poll joins a read under way, and the stale reload waits for it and then reads
again, since a read that started before the rejected switch may predate the other
administrator's. If that reload fails, the message says the current state could
not be loaded and asks for a page reload before switching again. The track scrolls
in a focusable group (labelled "*server* move steps"), so a keyboard can reach
stops past the panel's edge.

## Fleet capacity

The **Capacity** tab, after **Placement**, is for allocating servers across the
fleet from measurements instead of the static rule. It shows what a game server
needs while it runs, how much CPU each VPS loses to other tenants (steal), and
how many servers each instance type and each VPS could run at once at those
needs, against today's slots. It compares providers too, so CPU-steal hotspots
and weak VPSs stand out, for example when deciding whether to keep a provider.
It also shows the control plane's recommended slot count for each VPS
([slot sizing](#slot-sizing)). Nothing on the tab moves or changes anything.

### Reading it

The page's own server read for the tab is a small `hosting-regions` read, which
lets the control plane authorize the page as every other tab's read does. The tab
then sends `fleet-capacity` with `{}` from the browser when it opens, through the
same `control-plane-admin` Edge Function as `placement-overlap`; that function
forwards any administrator's operation without an allowlist, so no Edge Function
change is needed. The read is kept while the tab stays open and is not polled:
**Refresh** reads it again (one read at a time, keeping what it showed while it
loads), and the control plane allows each administrator six reads per five
minutes (`rate_limited`, with retry text). A failed read shows its message with
**Retry** and keeps what the tab already showed. An older control plane rejects
the unknown operation as `invalid_request`, and the tab then says the control
plane does not report fleet capacity yet. A response that does not match the
contract below reads "The control plane returned an unexpected fleet capacity."

### The model

The control plane's `docs/managed-hosting/fleet-capacity.md` defines every
figure; the tab presents them as follows.

- **Per-server demand** comes from the intervals, about 5 minutes each, between
  a server's resource samples while it was running. Its CPU is the average
  number of cores it used in the interval, its memory its working set at the
  interval's end, and the figures are nearest-rank percentiles over those
  intervals: CPU p50, p90, p95, p99 and max, memory p50, p95 and max. p95 means
  95% of the intervals were at or below it. The model takes the CPU p50
  (`model.cpuPercentile`) as a server's stable use and shows the memory p95
  (`model.memoryPercentile`) for comparison; what it plans is under **Per
  server**. **Throttled** is the share of running time in which a server's CPU
  quota throttled it. **Running server-hours** sums the hours servers ran, as a
  sense of how much the figures can be trusted.
- **Steal** is the share of a VPS's CPU time that the hypervisor gave to other
  tenants of the same physical machine, in percent (time-weighted mean, p95 and
  max over the week's intervals).
- **Busy cores** is how many of a VPS's cores were busy (user, nice, system and
  interrupt time), game servers and everything else together.
- **Overhead** is the median cores and memory in use beyond the game servers'
  own: the operating system, the runner and anything else on the VPS.
- **Usable** is what is left for game servers: vCPU × (1 − steal p95 ÷ 100) −
  overhead cores, and RAM − overhead memory, each clamped at zero by the control
  plane.
- **Per server** is the demand a VPS is modelled with: every online server
  bursting at once to `model.cpuBurstVcpu` (1.6 vCPU) and
  `model.memoryBurstBytes` (2.5 GiB), or to the peak CPU and peak working set of
  its demand source where those are higher. The source is the servers that ran on
  the VPS itself once they have run `minimumRunningHours` (six today) in the
  window (**This VPS**), else its instance type's once they have (**Type**), else
  the whole fleet's (**Fleet**), else none yet (**None yet**). Under the figures
  the source says how they are made, leaving out a target whose peak is above it:
  "This VPS · 1.6 vCPU, 2.5 GiB burst · peaks 1.372 cores, 2.26 GiB". A control
  plane without a memory burst target plans memory at the source's p95 instead,
  and the label describes the CPU only ("This VPS · 1.6 vCPU burst · peak
  1.372").
- **Servers at once (modelled)** is floor(min(usable cores ÷ per-server cores,
  usable memory ÷ per-server memory)), and **Limited by** says whether CPU or
  memory runs out first. It is compared with today's slots, floor(vCPU ÷ 2) from
  the static rule of 2 vCPU and 3 GiB per server (an instance type's slots are
  worked out the same way from `model.staticBurstVcpuPerServer`). Fewer than its
  slots is **At risk** (the VPS cannot run all its slots' servers at their needs
  at once), more is **Headroom**, equal is **Matches**. It is null, and shown as
  not modelled, while the VPS's steal, overhead or memory is unknown, or while
  none of its own servers, its instance type and the fleet has
  `minimumRunningHours` of running data (`demandSource` `none`).
- An **instance type** is a provider, vCPU count, RAM rounded to whole GiB, CPU
  model and clock rounded to 100 MHz, keyed `provider|vCpu|GiB|model|MHz`, for
  example `ovhcloud-vps|6|12|Intel Core Processor (Haswell, no TSX)|2400`. A VPS
  has none until its first host sample.

### What the tab shows

1. **Fleet capacity** ("Measured over the last 7 days"): what the tab is, the
   window ("Measured 12 Oct 00:00 – 19 Oct 00:00 UTC"), the fleet's servers and
   VPSs, when the read was generated and, while there is little or no data, a
   note saying so (see below).
2. **What a server needs**: the fleet's per-server CPU p50, p95 and max in
   cores, memory p50, p95 and max in GiB, running server-hours and throttled
   share, and a sentence comparing them with the static rule and saying what is
   planned ("A running server uses 1.18 cores at p50 (59% of 2 vCPU) and 1.73 GiB
   at p95 (58% of 3 GiB). Every online server is planned to burst to 1.6 vCPU and
   2.5 GiB at once, or to its VPS's measured peaks where higher; no CPU peak is
   above its target (the fleet's highest is 1.492 cores), so every VPS plans 1.600
   cores per server (80% of 2 vCPU), and no memory peak is above its target (the
   fleet's highest is 2.26 GiB), so every VPS plans 2.50 GiB per server (83% of
   3 GiB)."). No VPS's source peaks above the fleet, so above a target the plans
   range from the target to the fleet's peak, and the sentence says each VPS's own
   is in its per-server column. Until the fleet has `minimumRunningHours` nothing
   is planned and the sentence stops after what a server uses.
3. **Providers**: VPSs, servers, steal mean, p95 and max, and per-server CPU p50
   and p95 and memory p95, one row per provider. Providers are named OVHcloud,
   Contabo, HostHatch and VPS.TC here and in the other tables and VPS groups.
4. **Instance types**: provider, vCPU, RAM, CPU model, MHz, VPSs, servers,
   per-server CPU p50 and p95, memory p95, steal p95, servers at once against the
   type's static slots, and the demand source. The type's key repeats those
   columns, so it is only the provider cell's title.
5. **Slot sizing**: the recommended slots per VPS and region, from its own read
   (see [slot sizing](#slot-sizing)), just above the VPSs' servers at once.
6. **VPSs**: one row per VPS, grouped by provider and then region (alphabetical,
   hosts without a region last in their provider), with VPSs whose `samples` is
   0 (no observation on them carried server or host counters yet) last in their
   group and marked "no data yet". Each row has the service name without
   `.vps.ovh.net` (the full name in its title), size, CPU model and MHz, its
   servers and slots, and each server's own stable and peak CPU and p95 memory,
   with its memory peak once there is a memory burst target ("0.55 cores stable
   (p50), peak 1.10 · 1.65 GiB at p95, peak 1.65"); servers at once
   against its slots, limited by, steal mean · p95 · max, busy cores p95 of its
   vCPU, overhead, usable and per-server cores and GiB with their source; and
   two 168-cell strips, steal and busy, one cell per UTC hour oldest first under
   each group's axis of UTC dates (labelled as in the overlap pane). Steal is
   shaded on the heatmap's ten bands from under 0.5% to 20% or more, busy by
   tenths up to 90% or more, and an hour without data is hatched, never the
   shade of zero. Each cell's title gives its hour and value ("Wed 14 Oct 20:00
   UTC · steal 25.5% or more"), and each strip has a text summary (its highest
   hour, the mean and how many hours were measured, or "no data yet"). An at-risk
   row has a red edge and an **At risk −N** badge with a warning icon, a row with
   headroom a green edge and **Headroom +N**; neither relies on colour alone.

#### Typical demand (control plane #550)

A read in the typical-demand shape (see [response shape](#response-shape)) fits
each online server at what it usually needs, not at its peak. CPU is planned at
least at the 1.6 vCPU target, at its demand source's p95 where that is higher,
and never above 2 vCPU. Memory is planned at 2.5 GiB, or its peak where higher, up
to 3 GiB. The tab then shows:

- **Servers at once** as the control plane's verdict of N (`modelledServers`)
  against its co-online servers M and slots S: "Can run 3 at once", then "co-online
  3 · slots 6", the badge (**Matches**, **At risk −1**, **Headroom +1**) and, as
  information, "Burst headroom: 3 could burst at once (1.600 cores each)".
  - Where some server has too few samples, M reads "co-online 3 (some servers
    counted as always online)".
  - A VPS with no servers, which counts every slot, reads "co-online unmeasured,
    using slots".
  - Unknown N reads "Not modelled yet".
  - An instance type reads "Can run 3 at once" and "static slots 3", its verdict
    against its static slots.
  - A day/night VPS raised to 6 slots that runs its 3 co-online servers at once
    **matches**. Burst headroom never changes a badge.
- **Steal p50 · p95 · max** in place of mean · p95 · max (providers: **Steal p50**;
  instance types: **Steal p50 · p95**), since steal lowers the effective vCPU at
  its p50. Under **Usable** each VPS adds its effective vCPU ("5.982 effective
  vCPU"), as does each instance type under its vCPU.
- **Per server** at the fit, labelled by what sets it:
  - "This VPS · 1.6 vCPU target (p95 1.200) · 2.5 GiB memory target · peaks
    1.950 cores, 2.00 GiB" when the p95 is under the target;
  - "· p95 1.800 ·" when the p95 is above it;
  - "· p95 2.150 capped at 2 vCPU · 3 GiB memory cap ·" at the caps.

  Each server's own needs add its p95 ("0.55 cores stable (p50), p95 1.10, peak
  1.10 · 1.65 GiB at p95, peak 1.65").
- **The summary sentence**: "Each VPS is fitted at what its servers usually need,
  not at their peaks: CPU at the 1.6 vCPU target, or the p95 of its demand source
  where higher, at most 2 vCPU (the fleet's p95 is 1.200 cores, which fits at
  1.600 cores per server, 80% of 2 vCPU), and memory at 2.5 GiB or the peak where
  higher, at most 3 GiB; *memory plan*. Bursting to 1.6 vCPU, or the peak where
  higher, at most 2 vCPU, is shown as burst headroom and never decides a verdict.
  Each VPS's own figures are in its per-server column."
- **The tooltips** say the same:
  - the fit at p95 between the target and the cap;
  - the static floor, min(floor(vCPU ÷ 2), floor(RAM ÷ 3 GiB)), where steal lowers
    the vCPU only once its p50 reaches 5%;
  - co-online and its worst cases;
  - the verdict rule;
  - burst headroom as information only.

A read from before #550 renders exactly as above.

Every figure's label is a button with a tooltip explaining it (steal, busy
cores, overhead, usable, p50/p95/max, per server and its source, servers at
once, limited by, throttled share, running server-hours and the hourly strips).
The memory tooltips say that the model plans memory at the burst target, or the
peak where higher, and that the p95 is shown for comparison; without a memory
burst target they say that the p95 is planned.
A tooltip opens on hover, focus or a tap and closes on Escape, when the pointer
or focus leaves, or when the window scrolls or resizes; only one is open at a
time. These are the shared `MetricHint` buttons described under the measured
host overlap; their tooltip resets the text case, weight and letter spacing, so a
hint in an upper-case table header still reads as a sentence. Units are on every
value: cores, GiB, %, MHz and server-h. A figure without data shows "—" (read
out as "No data yet").

### Sparse data

The figures come from resource counters that runners only report from the
release that adds them, so the first reads have few samples and many nulls. The
control plane leaves out a malformed sample as if its observation had no
counters and only logs it; the response has no field for skipped samples, so the
tab cannot show them. Before any sample arrives (the fleet's demand and every
VPS's `samples` are 0) the header says "Not enough data yet: no resource samples
have arrived" and every figure shows "—"; tables and rows are still listed,
servers at once shows "— / N slots" without a badge, and every strip is hatched.
While the fleet has less running data than `minimumRunningHours` (or no demand
figures), the note says how many server-hours it has against what the model
needs and that no VPS is modelled until then. A VPS with an observation but no
interval yet is listed with the measured VPSs, its strips still hatched.

A VPS's steal and busy cores come from host counters, which it can lack while
its servers report their own, so the fleet's demand can be complete while some
VPSs have no host metrics. Such a VPS (`steal` or `busyCores` null) says "Host
metrics not measured yet" under its servers and slots, and its steal, busy
cores, overhead, usable and servers-at-once cells show "—". Unless no sample has
arrived at all, the header adds "Host metrics not measured yet on *N* of *M*
VPSs: …", beside the fleet's own note when there is one.

### Response shape

The response is parsed strictly; anything else is an unexpected response. Every
object has exactly its keys. `generatedAt` and both window bounds are
millisecond UTC times, `hours` is 168 and the window is exactly 168 hours long
(it need not start on the hour; hour labels then show the minutes). `model`
percentiles are above 0 and at most 100, `minimumRunningHours` is a finite
non-negative number, `staticBurstVcpuPerServer` is positive and
`staticBurstMemoryBytesPerServer` a positive integer. Counts (hosts, servers,
samples, slots, modelled servers) are non-negative integers, vCPU at least 1;
bytes are non-negative integers and RAM positive; MHz is non-negative, and 0 (a
VPS that reports no clock, or an instance type whose clock rounds to 0) shows as
unknown ("—"). Text is 1–256 characters, and an instance-type key, which holds a
whole CPU model, up to 512; its format is not checked. A demand's running
server-hours is a finite non-negative number, its CPU percentiles and memory
percentiles are null or ordered p50 ≤ p90 ≤ p95 ≤ p99 ≤ max (memory p50 ≤ p95 ≤
max), and its shares are null or 0–1. A steal stat is 0–100 and a busy-cores
stat non-negative, each with its mean and p95 at most its max. Figures are
rounded to three decimals, so each ordering allows 0.001. Usable cores and
memory are null or non-negative, as the control plane clamps them.
Every `provider`, in the provider list, on an instance type and on a VPS, is one
of the control plane's closed `VPS_PROVIDER_IDS`: `ovhcloud-vps`,
`contabo-vps`, `hosthatch-vps` or `vpstc-vps` (the website's `VPS_PROVIDERS`).
A VPS's `demandSource` is `vps`, `type`, `fleet` or `none`, an instance type's
`type`, `fleet` or `none`, and `limitedBy` null, `cpu` or `memory`.
`stealHourly` and `busyHourly` are 336 characters, 168 hours of two
lowercase hex digits or `--`; steal is permille capped at 255 (`ff` is 25.5% or
more) and busy is a percent no more than 100 (`64`). Each provider,
instance-type key and VPS service name appears once. So that a malformed
response cannot make the tab draw thousands of rows of 336 cells, a read holds
at most 256 VPSs, 64 servers and 32 regions on any one VPS, and 256 instance
types (`FLEET_CAPACITY_LIMITS`). These are well above the control plane's own
bounds, 64 VPSs and 512 placed servers today, so they leave room for them to
rise. Providers need no cap: each appears once and is one of the three ids.

The read comes in one of three shapes, keyed by its model and every part of it in
the same one; a mix, or a key outside a shape's set, is unexpected. All have
`model.cpuBurstVcpu`, above 0 and at most 256, and each VPS's `stableCpuCores` and
`peakCpuCores`.

- **Typical demand**, from control plane #550 on, is the memory-burst shape plus
  exactly these keys:
  - `model`: `cpuTypicalPercentile` and `stealPercentile` (percentiles),
    `stealFloorThresholdPercent` (0 to 100), `concurrentBusyFraction` and
    `concurrentHourShare` (0 to 1);
  - every steal and busy-cores measure: `p50`, with `p50 ≤ p95 ≤ max`;
  - each instance type: `effectiveVcpu`, `typicalCpuCores`, `burstServers` and
    `verdict`;
  - each VPS: `effectiveVcpu`, `typicalCpuCores`, `burstCpuCores`,
    `burstServers`, `concurrentServers`, `concurrentSource`,
    `concurrentCoverage` and `verdict`.

- **Memory burst**, from control plane `ao/memory-burst` on, adds
  `model.memoryBurstBytes`, a positive safe integer of at most 64 GiB, and each
  VPS's `peakMemoryBytes`, null or a non-negative integer.
- **Earlier**, from control plane #524 to `47c881b3`, has neither and plans
  memory at its p95. The website reads it with `memoryBurstBytes` and every
  `peakMemoryBytes` null.

A VPS without a source (`none`) has every per-server figure null, and one with a
source has every one, with a stable CPU above 0 and a CPU peak no lower. Its
`demandCpuCores` is `max(cpuBurstVcpu, peakCpuCores)` within 0.001, and in the
memory-burst shape its `demandMemoryBytes` is exactly
`max(memoryBurstBytes, peakMemoryBytes)`.

In the typical-demand shape the website does not work the planned figures out
again from #550's formulas, so a control plane that adjusts a formula or its
rounding does not break the tab. The figures are `demandCpuCores` (`min(2,
max(1.6, p95))`), `burstCpuCores`, `typicalCpuCores`, `effectiveVcpu` and
`burstServers`. It checks only their ranges and the obvious caps:

- `demandCpuCores` and `burstCpuCores` are at most `staticBurstVcpuPerServer`
  (2 vCPU, allowing 0.001);
- `demandMemoryBytes` is at most `staticBurstMemoryBytesPerServer` (3 GiB);
- `effectiveVcpu` is null or at most the vCPUs;
- `typicalCpuCores` is null or non-negative;
- `burstServers` and `modelledServers` are null or whole numbers from 0.

The current shape keeps its own check, `demandCpuCores = max(cpuBurstVcpu,
peakCpuCores)`, as before. Each VPS's `concurrentServers` (M) is at most its slots, and equals them when
`concurrentSource` is `slots`. Its `verdict` must be what N, M and S give:
`unknown` while N is null, `at-risk` by M − N when N < M, `headroom` by N − S
when N > S, else `matches`, whose `servers` is 0. An instance type's verdict uses
its static slots, floor(vCPU ÷ 2), as both M and S. The typical-demand shape comes
back exactly as it is, and the website shows the control plane's verdict rather
than working out its own. A read from before the CPU burst target,
without `cpuBurstVcpu`, is no longer sent by any control plane and is unexpected.
Nothing else between fields is checked: an unknown `instanceTypeKey`, occupants
beyond slots or fleet totals that do not add up still render.

### Deploy order

Deploy the control plane's `fleet-capacity` operation first, then this website
change. Deployed the other way round, the tab only says the control plane does
not report fleet capacity yet until the control plane catches up.

The memory burst target goes the other way: deploy this website change
(`ao/memory-burst`) first, then control plane `ao/memory-burst`. The website
reads the current control plane's capacity and overlap and the new ones; deployed
the other way round, an older website shows the new capacity read as unexpected,
and would reject the overlap of any VPS whose memory lets more servers burst at
2.5 GiB than at 3 GiB (none of today's). Roll back in the other order: the control
plane first.

Typical demand (control plane #550) also goes website first. Its new keys make a
website before this change reject the capacity, slot-sizing and overlap reads as
unexpected, so deploy this website change, then #550. This website reads both
the current control plane's reads and #550's, so roll back the control plane
first.

A VPS provider the control plane adds to `VPS_PROVIDER_IDS` needs a website
update first: add it to `VPS_PROVIDERS` with a readable name in
`VPS_PROVIDER_LABELS` (`src/app/lib/control-plane/vps-providers.ts`), and
deploy that before the control plane reports the provider. Until then the
capacity read is an unexpected response, the **Onboard provider-account VPS**
card refuses its hosts, and other views show its raw id.

### Slot sizing

The **Slot sizing** pane, between **Instance types** and **VPSs**, shows the
control plane's read-only `slot-sizing` recommendation (control plane #530): how
many slots each VPS could have so that servers rarely online together share it.
A slot reserves no cores, so a VPS may hold more servers than it runs at once.
The control plane's `docs/managed-hosting/placement-planner.md` ("Slot sizing
(recommendation)") defines every figure; this section says how the pane shows
them.

**It is a recommendation only.** The pane has no apply, raise or lower action,
nothing on the website or the control plane acts on the read, and no slot count,
server or placement changes until automatic sizing is built and turned on.
**Raise slots** in the VPS view ([Raising a VPS slot
capacity](#raising-a-vps-slot-capacity)) stays the separate, manual action.

#### Reading slot sizing

The pane sends `slot-sizing` with `{}` from the browser when the tab opens,
beside `fleet-capacity` and through the same `control-plane-admin` Edge
Function, which needs no change. It has its own state: it shows whatever the
capacity read does, and the capacity panes show whatever it does. It is not
polled. Its own **Refresh** reads it again (one read at a time, keeping what it
showed while it loads). The control plane allows each administrator six reads
per five minutes, a budget separate from fleet capacity's, and answers more with
`rate_limited`, which the pane shows as "You can read slot sizing six times
every five minutes. Wait a few minutes, then refresh." with **Retry**. Any other
failure, such as `slot_sizing_unavailable` without an enabled VPS provider,
shows the control plane's message with **Retry** and keeps what the pane
already showed. A response that does not match the shape below reads "The
control plane returned an unexpected slot sizing."

#### What the slot sizing pane shows

- What the pane is and that it is a recommendation only, then the two budgets
  and the typical new server, each from the read's `model`: "Each VPS gets the
  most slots, from floor(vCPU ÷ 2) to 32, at which its servers now plus typical
  new servers in the rest keep two budgets: at most 1 core-hour a week of
  expected CPU shortage, and more servers online at once than its memory holds
  in under 1% of the week." and "A typical new server needs 1.6 vCPU and 2.5 GiB
  while online and is online 41.37 hours a week, the mean of servers' weeks over
  the last 28 days (14-day half-life). A server observed for under 7 days counts
  with that typical week." From control plane #550 the model adds exactly
  `typicalServerCpuCores` (above 0, at most 256), and the typical server reads "A
  typical new server needs 1.600 cores and 2.5 GiB while online: what servers
  usually need, the 1.6 vCPU target or the fleet's p95 CPU where higher, at most
  2 vCPU (the target before the fleet has data). …". The recommended-slots
  tooltip then counts a server without a measured need "at the typical 1.600
  cores", and the capacity tooltip plans memory "at most 3 GiB".
- When `model.capacityErrorCode` is set, a note: "Capacity samples could not be
  read (*code*), so no VPS's usable cores or memory are known: every VPS is
  unmeasured and has no recommendation."
- **Recommended slots per VPS**, grouped by provider and then region as the VPSs
  table groups them, in the read's order within a group. A provider the website
  does not know (the control plane leaves its VPSs unmeasured) is named by its
  id. Each row has the service name without `.vps.ovh.net`, its vCPUs and, for a
  VPS that does not accept relocations, "Takes no moved servers". Its columns:
  - **Slots** (its stored slot capacity now) and **Servers** (servers in its
    slots now);
  - **Recommended**, with a badge against its slots now: **+N**, **−N** or
    **same**, each with an icon and a title sentence, so it does not rely on
    colour alone;
  - **Reason** in words with a sentence for the VPS, using only what the read
    says:
    - **CPU budget** or **Memory budget**: one more slot would break that
      budget.
    - **Floor**: the most slots that keep both budgets, if any, is below
      floor(vCPU ÷ 2), but a VPS keeps that many, so a budget breaks at the floor. The budgets named are
      those whose flag is false. When its servers fill the floor, they break it
      themselves: "Its 2 servers already break the CPU and memory budgets. A VPS
      keeps its floor of 2 slots (floor(vCPU ÷ 2)), and this one has no more
      servers than that, so nothing moves." With fewer, the free recommended
      slots are the room left within the budgets: "Beside its 1 server, 1 more
      typical server fits within the budgets. A VPS keeps its floor of 3 slots
      (floor(vCPU ÷ 2)) anyway; filled with typical servers, they would break
      the CPU budget." An empty VPS reads "2 typical servers fit within the
      budgets." or "Not even one typical server fits within the budgets.", and
      one with no room "no more typical server fits".
    - **Maximum**: 32 slots keep both budgets.
    - **Drain**: its servers alone break a budget, so some would move. Above the
      floor: "Its 7 servers alone break a budget, so 2 would move, and the 5
      that stay keep both budgets." At the floor, by the flags: "…, down to its
      floor of 3 slots (floor(vCPU ÷ 2)), where the 3 that stay keep both
      budgets." or "… still break the CPU budget."
    - **Unmeasured**: names the missing figure, "Its usable memory is neither
      measured nor borrowable, so there is no recommendation." (or cores, or
      both).
  - **CPU shortage / week** in core-hours with the control plane's three
    decimals ("0.842 core-h") and **Memory over** as a percent with its four
    decimals of share ("0.21%"). Each is marked **Over budget** when its flag,
    `withinCpuBudget` or `withinMemoryBudget`, is false. The marks come from the
    flags, not the rounded figures, which cannot tell a figure at the edge:
    "1.000 core-h" can be over the 1 core-hour budget and "1.00%" under the 1%
    one. Only Drain and Floor can be over;
  - **To move** and **Free recommended** slots;
  - **Capacity**: each usable figure's own source, then the figures it knows.
    Sources read "Cores and memory measured", "Cores and memory borrowed
    (type)" or "… borrowed (provider and vCPU)", or, when they differ, "Cores
    measured · memory borrowed (type)". The figures read "5.580 cores, 10.90 GiB
    usable".

  An unmeasured VPS shows "—" (read out as "Unmeasured") for its
  recommendation, shortage and memory over. Its capacity still shows the figure
  it knows and names the missing one ("Cores measured · memory unknown", "1.500
  cores usable"), or "Cores and memory unknown".
- **By region**: each region the read lists, in its order, with **To move**,
  **Free recommended** and **Shortfall**. A shortfall above zero reads "*N*
  servers without a slot" with a warning icon. The read reports servers, not how
  many VPSs a shortfall needs, so the pane names no VPS count.

Every column label is a `MetricHint` button whose tooltip explains it as the
control plane computes it, with the read's own budgets and targets: the slots
now, the recommendation and how occupants and typical servers count, each
reason, the shortage (the cores that servers online together are expected to
want beyond the usable cores, summed over the week's half-hours), memory over
(the expected share of the week with more online than floor(usable memory ÷
memory per server)), each with how **Over budget** follows the control plane's
flags on the exact figures, servers to move, free recommended slots (and that
only a VPS accepting relocations offers them to its region), where each usable
figure comes from (each is borrowed on its own) with the planned memory per
server, and each region figure (regions overlap, so a VPS in several offers the
same slots to each).

#### Slot sizing response shape

`parseSlotSizing` in `src/app/lib/control-plane/slot-sizing.ts` parses the read
strictly against the control plane's `HostingAdminSlotSizing`
(`src/hosting/fleet/slot-sizing-contract.ts`), checking only what the control
plane's `sizeVpsSlots`, `slotSizingHostEntry` and `readSlotSizing` guarantee;
anything else is an unexpected response. Every object has exactly its keys, and
`generatedAt` is a millisecond UTC time.

- **Model**: the CPU budget is finite and non-negative, the memory budget above
  0 and at most 1, `cpuBurstVcpu` above 0 and at most 256, `memoryBurstBytes` a
  positive integer of at most 64 GiB, `historyDays`, `halfLifeDays` and
  `maximumSlots` positive integers, `minimumObservedDays` a non-negative integer,
  `typicalWeeklyOnlineHours` 0 to 168 with at most two decimals, and
  `capacityErrorCode` null or text.
- **Each VPS**: its service name and provider are text (any provider id: one the
  control plane does not know is unmeasured), it has at most 32 region keys and
  at least 2 vCPUs, its counts are non-negative integers, its slots run from
  floor(vCPU ÷ 2) (at least 1) to `maximumSlots` with no more servers than slots
  (the control plane's hosts CHECK and slot triggers keep both), usable cores
  have at most three decimals, usable memory
  is whole bytes, and memory per server is whole bytes no less than
  `memoryBurstBytes`. Its `reason`, `coresSource` and `memorySource` are in
  their enums.
- **Sources**: `coresSource` is `none` exactly when `usableCores` is null, and
  `memorySource` exactly when `usableMemoryBytes` is.
- **Reason against figures**:
  - `unmeasured` exactly when either source is `none`, and then
    `recommendedSlots`, the shortage, memory over and both budget flags are
    null, and servers to move and free slots are 0;
  - otherwise `recommendedSlots` is an integer from floor(vCPU ÷ 2) to
    `maximumSlots`, the shortage is non-negative with at most three decimals,
    memory over is 0 to 1 with at most four, and `withinCpuBudget` and
    `withinMemoryBudget` are booleans;
  - the flags are of the exact figures, so a true flag's rounded figure is at
    most its budget plus half its last decimal, and a false flag's at least its
    budget less half its last decimal. With the budgets of 1 core-hour and 1%,
    a broken CPU budget reads at least 1.000 and a broken memory budget at
    least 0.0100;
  - only `drain` has servers to move: at least one, with the recommendation
    equal to its servers less them, and no free slots. It keeps both budgets
    unless the recommendation is floor(vCPU ÷ 2), where either may break;
  - `floor` recommends exactly floor(vCPU ÷ 2), with free slots no more than the
    recommendation less its servers, and at least one flag false;
  - `cpu`, `memory` and `maximum` have both flags true, free slots equal to the
    recommendation less its servers, and `maximum` recommends `maximumSlots`,
    the other two fewer.

  Each rule has its own rejection test in
  `src/app/lib/control-plane/slot-sizing.component.test.tsx`, and removing any
  one of them fails that test.
- When `capacityErrorCode` is set, every VPS is `unmeasured`.
- **Each region**: its key is text and its counts are non-negative integers. Its
  shortfall is at most its servers to move and at least its servers to move less
  its free slots. Its servers to move are at most all VPSs' servers to move, and
  its free slots at most those of all VPSs that accept relocations.
- Each service name and region key appears once, and a read holds at most 256
  VPSs and 32 regions (`SLOT_SIZING_LIMITS`), as the capacity read caps its
  VPSs.

#### Slot sizing deploy order

This website change deploys **before** control plane #530. Control plane `main`
has no `slot-sizing`: after authenticating the administrator it fails the
request's operation schema and answers HTTP 400 `invalid_request` ("The control
plane request is invalid."), with an empty request id because the Edge Function
forwards no `x-request-id`, so the browser client reads the bare error. The pane
shows `invalid_request` (and `unsupported_operation`) as a calm note, not an
alert, with no tables: "Slot sizing is not available on this control plane yet.
It appears here once the control plane that recommends slot counts is deployed;
the rest of this tab does not depend on it." The capacity panes work as before.
The pane always sends `{}`, which #530 accepts, so `invalid_request` here only
means the operation is unknown. Once #530 deploys, **Refresh** or reopening the
tab shows the recommendations. Rolling #530 back returns the pane to the note.
A later change to the slot sizing contract, such as a new reason, key or rule,
needs the website updated first, or the read is unexpected. The pane reads #530
with each usable figure's own source and both budget flags; a build of #530
from before them (with `capacitySource`) reads as unexpected.

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
zone, and `placement-completed` with the new `address` when it is a join address
`isJoinAddress` accepts (a real IPv4 address or a bracketed IPv6 address, with a
port from 1 to 65535, the same check the move status uses), and a variant without
it otherwise. A scheduled notice without a usable
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
