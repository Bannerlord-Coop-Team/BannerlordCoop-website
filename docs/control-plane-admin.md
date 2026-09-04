# Control Plane administration page

`/admin/control-plane` is the website presentation layer for managed-hosting administration. Supabase `Admin` access protects the page, and the browser sends typed requests to the `control-plane-admin` Supabase Edge Function. The function accepts only configured website origins, reauthenticates the current access token, requires the protected `Admin` role and a verified Discord identity, then forwards the unchanged request envelope to the Oracle web-admin adapter. The adapter independently revalidates the token and uses the control plane's typed Unix-socket contract.

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

The website does not query the private `control_plane` schema, call OVH, connect to runner agents, or construct container operations. Browser request UUIDs become the control-plane correlation and idempotency identity. Server and job mutations carry the current `updatedAt` value selected from the page, so stale forms fail rather than overwrite newer state.

The administrator presentation resolves Discord usernames only from bounded Supabase Auth accounts that signed in with Discord. Numeric Discord IDs remain visible and accepted as a fallback. Dates and provider-check times render only after browser hydration so they use the administrator's browser locale and time zone rather than the Netlify or Oracle server time zone.

The Operations page's **Register existing OVH VPS** card is the normal additive host-ingestion path. It verifies that an already-purchased service belongs to the configured OVH account, derives the reviewed image within the control plane, records `floor(vCPU / 2)` empty slots, and writes an administrative audit event. It never purchases, renews, powers, assigns, or installs the VPS. Managed-runner enrollment is still required before an assigned slot can Start. Server creation assigns an existing prepared OVH slot in the selected region; it never orders a VPS, and unavailable capacity fails without creating or billing anything. The normal Releases view hides non-validated history, but pending, rejected, and revoked receipts remain retained for explicit inspection and audit rather than being deleted.

Deploy the Edge Function from the repository root:

```sh
npx supabase secrets set --project-ref <project-ref> \
  CONTROL_PLANE_ADMIN_URL=https://control-plane.example.com \
  CONTROL_PLANE_WEB_ORIGINS=https://bannerlordcoop.com,https://bannerlordcoop.netlify.app
npx supabase functions deploy control-plane-admin --project-ref <project-ref>
npx supabase functions deploy my-servers --project-ref <project-ref>
```

The `my-servers` function accepts authenticated GET inventory requests and
strict POST lifecycle requests for Start, Stop, or game-container Restart.
Only current durable owner and manager access can enqueue an operation; support
and server-level admin access remain read-only. Requests carry the current
exact UTC-millisecond `updatedAt` value, and the control plane derives idempotency
from the request UUID while rechecking access when the durable job begins.
After acceptance, one shared page poller disables lifecycle controls and refreshes
for at most 60 seconds; it stops sooner when the target reaches a newer stable
state. A manager Stop rejected after its ACL is revoked but before the durable
mutation boundary performs no external work, while one already beyond that
boundary finishes safely. Entitlement-revocation and administrative-suspension
Stops remain deliberate safety continuations. Stop never powers off the VPS, and
Restart never becomes a VM reboot.

`CONTROL_PLANE_ADMIN_URL` is the Oracle adapter's HTTPS origin; each function appends its fixed `/v1/admin/control-plane` or `/v1/user/control-plane` path. `CONTROL_PLANE_WEB_ORIGINS` is a comma-separated exact allowlist of HTTPS browser origins. Neither value may contain credentials, query parameters, fragments, or path prefixes. JWT verification remains enabled in `supabase/config.toml`.

The website itself needs only the existing public Supabase URL and publishable key. It does not need an Oracle URL or control-plane credential in Netlify.
