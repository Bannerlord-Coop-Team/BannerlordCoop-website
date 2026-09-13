# Server file transfers

The owner server page implements the unified **Saves, configs & backups** design.
Existing backup polling, restore confirmations, and retained request recovery
remain in `ManagedServerBackups`. Campaign and configuration transfers appear
above them, with a responsive two-card layout and native import review dialogs.

- Import a downloaded `.blcexport` or a `.sav` and its matching `.json` companion,
  up to 20 MiB total (including archive metadata/encoding). Both
  filenames must be simple basenames. Backend/runner limits may be stricter.
  The stopped-server workflow creates a protective backup, validates the import,
  selects the imported campaign and retains its normal rollback behavior.
- Export the active campaign through a durable job and download its archive.
  Save transfers require the server to be stopped. No server is stopped silently.
- Import an exported version-1 configuration JSON file, up to 64 KiB. Review
  changed values before confirmation. Import is owner-only; settings apply on
  the next Start. Passwords, campaign paths and host settings are excluded.
- Export the current validated configuration. Managers can export this non-secret
  configuration and manage saves; they cannot import configuration settings.

Server actions revalidate the authenticated Supabase user against the page user
and forward the original bearer token to the existing `my-servers` Edge Function.
The control plane independently checks Discord identity, current ACL/capability,
server generation and request identity. The browser never receives a privileged
provider, storage, control-plane or service-role credential.

Transfers retain an exact UUID, server generation and file SHA-256 fingerprints
in account/server-scoped session storage before sending. No file bytes, config
contents or credentials are persisted in browser storage. A lost response keeps
that intent. Refresh/retry uses the same request and requires the same files;
polling is bounded to one minute and can be resumed explicitly. Confirmed
completion/rejection permits a new request. Storage failures pause transfers.
The existing backend validates archive shape, companion JSON and all config keys.

The dedicated Edge POST resource `file-transfer` accepts at most 28 MiB of JSON;
other request limits are unchanged. The Next server-action body allowance is
22 MiB to carry the bounded 20 MiB multipart pair. Each action still applies its
own format, count and size limits before encoding. Save downloads allow 36 MiB
of JSON for at most 25 MiB of inline attachment data. Larger exports use the
existing expiring private download service. Responses are private/no-store and
read with streaming byte limits. Actual worker memory/timeout limits can reduce
usable maximum sizes; no production maximum-size transfer has been exercised.

`supabase/functions/_shared/managed-server-configuration.ts` mirrors the control
plane's `src/hosting/runner/contracts/managed-server-configuration.ts` exactly.
`server-file-contract.ts` mirrors its `lifecycle/owner-file-contract.ts` (with only
the import path adjusted). Update both repositories together when that contract
changes; the authoritative backend always repeats validation.

## Rollout and validation

Requires the companion ControlPlane owner-file-transfers PR. Roll out the reviewed
backend and its explicit `/v1/user/files` TLS proxy allowlist entry first, then
`my-servers` Edge Function and this website. The proxy is a separately authorized
live configuration change. No deployment or merge was performed for this PR.
An unavailable backend disables transfer actions while backups remain visible.

Tests cover Edge forwarding/limits/validation, browser request retention and
permissions, bounded polling, configuration review, and authenticated actions.
Control-plane tests exercise HTTP through IPC, encrypted synthetic storage,
protective backup, import/export jobs, idempotency and authorization. These are
local synthetic checks, not real Bannerlord runtime evidence.

Screenshots are real Playwright captures of the implemented components in a
local Next development page with a fixed owner fixture, stopped game state,
Northern Campaign save and two backup rows. The preview route was temporary
and is not shipped. The outer management layout was taken from the actual
owner page, inspected at bannerlordcoop.com before implementation. No live
server operations or production transfers were performed.

- [Desktop](screenshots/server-files-desktop.png)
- [Configuration review dialog](screenshots/server-files-import.png)
- [Mobile](screenshots/server-files-mobile.png)
