# Control Plane administration page

`/admin/control-plane` is the website presentation layer for managed-hosting administration. Supabase `Admin` access protects both the page and the same-origin API route. The API route forwards the current access token to the Oracle web-admin adapter, which independently revalidates it and uses the control plane's typed Unix-socket contract.

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

Set the server-only deployment variable:

```env
CONTROL_PLANE_ADMIN_URL=https://control-plane.example.com
```

The URL is an HTTPS origin; the client appends `/v1/admin/control-plane`. It must never contain credentials, query parameters, or fragments. Local development may use `http://127.0.0.1:<port>` outside production.
