# Control Plane administration page

`/admin/control-plane` is the website presentation layer for managed-hosting administration. Supabase `Admin` access protects the page, and the browser sends typed requests to the `control-plane-admin` Supabase Edge Function. The function accepts only configured website origins, reauthenticates the current access token, requires the protected `Admin` role and a verified Discord identity, then forwards the unchanged request envelope to the Oracle web-admin adapter. The adapter independently revalidates the token and uses the control plane's typed Unix-socket contract.

The page provides:

- fleet health, provider capacity, reconciliation, and global controls;
- searchable servers with desired/observed state, runtime, release, save, backup, and audit detail;
- durable job state and retry/cancellation controls;
- Stable and Nightly release catalogs and validation/revocation actions;
- lifecycle, update, rollback, restore, diagnostics, password, suspension, and deletion controls;
- ownership transfer, manager access, quota, provider replacement, and server creation;
- bounded provider orphan review/cleanup, fleet reconciliation, batch maintenance, and owner announcements; and
- the hash-chained audit history.

The website does not query the private `control_plane` schema, call OVH, connect to runner agents, or construct container operations. Browser request UUIDs become the control-plane correlation and idempotency identity. Server and job mutations carry the current `updatedAt` value selected from the page, so stale forms fail rather than overwrite newer state.

Deploy the Edge Function from the repository root:

```sh
npx supabase secrets set --project-ref <project-ref> \
  CONTROL_PLANE_ADMIN_URL=https://control-plane.example.com \
  CONTROL_PLANE_WEB_ORIGINS=https://bannerlordcoop.com,https://bannerlordcoop.netlify.app
npx supabase functions deploy control-plane-admin --project-ref <project-ref>
```

`CONTROL_PLANE_ADMIN_URL` is the Oracle adapter's HTTPS origin; the function appends the fixed `/v1/admin/control-plane` path. `CONTROL_PLANE_WEB_ORIGINS` is a comma-separated exact allowlist of HTTPS browser origins. Neither value may contain credentials, query parameters, fragments, or path prefixes. JWT verification remains enabled in `supabase/config.toml`.

The website itself needs only the existing public Supabase URL and publishable key. It does not need an Oracle URL or control-plane credential in Netlify.
