# Control Plane administration page

`/admin/control-plane` is the website presentation layer for managed-hosting administration. Supabase `Admin` access protects the page, and the browser sends typed requests to the `control-plane-admin` Supabase Edge Function. The function accepts only configured website origins, reauthenticates the current access token, requires the protected `Admin` role, then forwards the unchanged request envelope to the Oracle web-admin adapter. The adapter independently revalidates the token and uses the control plane's typed Unix-socket contract.

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
**My Servers** links each accessible server to `/servers/[serverId]`. The route
derives access from the authenticated inventory, never from the URL. Only current
durable owner/manager access can operate; support and server-level admin remain
read-only. The control plane rechecks durable permission immediately before dispatch.

The Edge Function maps these actions to fixed `POST /api/v1/start`, `/api/v1/stop`,
and `/api/v1/restart` routes with only `{serverId}` and the caller's bearer token.
These commands operate on an existing container. They do not provision, queue a
job, verify saves, warn players, or wait for game readiness. Stop/Restart require
UI confirmation warning of unsaved progress loss. A container removed by the old
safe Stop cannot be recreated by direct Start. Stop never powers off the VPS;
Restart never becomes a VM reboot.

The Edge retains the website's correlated version-1 envelope: success contains
`result: {exitCode: 0}`; nonzero exit returns HTTP 409 with
`container_command_failed` and the actual exit code in the bounded error message.
No stdout/stderr is forwarded. Transport failure means an unknown outcome, not
proof of non-execution. Each HTTP request is a new command; there is no automatic
retry, lifecycle polling, or operation ID. The page is revalidated once after a
response, without claiming readiness. Existing backup polling/interlocks remain.

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


## Release-list Edge cache

The existing `control-plane-admin` Edge Function caches successful `builds`
responses in memory for five minutes per function instance. The browser keeps
using the same authenticated version-1 API; no new endpoint, secret, database
table, Redis service, or GHCR credential is required in Supabase. The control
plane still owns GHCR access and label/integrity validation.

Authentication and the protected Admin role are checked on **every** request,
including cache hits. Only release-list pages are cached, with at most one page
per Public/Nightly channel. Cursor and page size must match; requesting another
page replaces that channel's cached page. Responses use the current request ID
and origin and retain `Cache-Control: no-store` for browser/proxy caches. Tokens,
account records, lifecycle operations and upstream errors are never cached.
Expired pages are not served after an upstream failure. Instances do not share
cache state; cold starts and concurrent misses may query the control plane again.

Deploy this change only through a separately authorized Edge Function rollout,
coordinated with control-plane PR #198's on-demand `RegistryReleaseApi`. That
backend removes the local cache and background release refresh loop: direct
Builds requests and lifecycle selections query GHCR, while the Edge endpoint
caches presentation responses only. Health probes and ordinary Start/Stop/Restart
remain independent of release discovery. Do not deploy this cache in front of an
older caching backend; the two lifetimes would compound.

Focused verification:

```sh
npx tsx --test supabase/functions/control-plane-admin/index.test.ts
npx eslint supabase/functions/_shared/control-plane-admin.ts supabase/functions/control-plane-admin/index.test.ts
```
