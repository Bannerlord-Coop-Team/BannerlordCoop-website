# Server mods

The owner summary accepts optional `runtimeInsight.modLoadFailure` with the same
bounded diagnosis as Start status (`modId`, closed `reason`, and `assembly` only
for `missing-assembly`). Deploy this website compatibility change before the
control plane adds the field. It keeps the latest failed Start's diagnosis visible
after Stop, until a newer Start replaces it, only while the game is stopped or
failed. Immediate failures, polled status and returning owners receive localized
repair guidance: a missing assembly names the mod and assembly and asks the owner
to disable it and dependent mods before starting again. It does not assume the
owner should upload a DLL or that a UI-named assembly cannot load on a dedicated
server. Missing server-provided Harmony retains its hosting-problem explanation;
uploading Bannerlord.Harmony again will not fix it. Unknown diagnoses use generic
copy; raw logs are never shown. The response keys and three closed reason values
are unchanged, so this copy change accepts the current control plane as well as
the fatal-attribution fix.

The managed server page's **Mods** tab lists, orders, enables, uploads and deletes
custom Bannerlord modules through the control plane's custom-mods API. The
control-plane repository's `docs/managed-hosting/custom-mods.md` (section 7 and its
**Website transport contract**) is the source of truth; this page describes only
the website's side of it.

## What owners see

- A banner at the top of the tab says that mod support is experimental and may
  have bugs; everyone who opens the tab sees it.
- Owners and managers (the control plane's `manage-mods` capability) load the list
  when the tab is first opened. Support and administrator roles see that only owners
  and managers can view and change mods; the website sends no request for them.
- Core modules remain enabled, image-owned and not deletable. When the control
  plane reports `reorderable: true`, each core module has its own drag handle and
  arrow-key movement, so owner mods may precede Native or sit between core
  modules. The control plane validates the complete dependency order; a refused
  order restores the saved list and names the module that broke a rule.
  Without that optional field, Native, SandBoxCore and SandBox remain fixed at
  the top and DedicatedServer.Linux at the bottom, preserving older runners.
  Bannerlord Co-op can be moved but stays enabled, with no "Required" badge. Owner mods can be
  dragged by their handle or moved with the arrow keys, and toggled with the gold
  switch. Each change saves itself: a toggle saves at once, a drag when it ends,
  and arrow-key moves 600 ms after the last key (or at once if the owner leaves
  the page sooner). Every save sends the complete
  list (`load-order`) against the last confirmed revision; one save runs at a
  time, and edits made meanwhile are saved next against the revision it returned
  (a drag or arrow-key run still in progress is saved when it ends).
  A refused save shows the saved list again with the reason; a stale revision or
  an unknown outcome reloads it. If that reload fails too, the tab shows the last
  confirmed list with the error and keeps Refresh available. At most 32 owner
  mods can be enabled.
- **Upload mod folder** opens a folder picker. The browser zips the folder (see
  below), confirms before replacing an installed Id, and shows the upload phases
  with a percentage while chunks are sent. The control plane installs a new mod
  enabled, immediately before DedicatedServer.Linux, unless a dependency or the
  enabled limit leaves it disabled; the panel says which happened.
- Deleting asks for confirmation. Pinned modules and Coop have no delete button.
- Each mod shows its notes (stripped assemblies, missing or misordered
  dependencies, removed dedicated-server or no-render tags, a mod known not to run
  headless, no code that runs on the server, a SubModule class or DLL the mod does
  not contain or cannot read). The reorder handles carry a screen-reader-only
  arrow-key hint.
- **Runs on** (control-plane contract C3, mod runtime v1). When the list reports
  `runsOn`, each owner mod shows where its code runs: **Server and players**, or
  **Players only**, where the module stays in the server's launch list (so Coop's
  join check still matches it) but none of its code runs on the server. The choice
  is separate from the enabled switch, saves like a toggle, and the save names
  `runsOn` only for the mods whose value changed, so an unchanged list sends what
  it always did.
  - The control plane owns the policy; the website keeps no list of mod ids. Each
    entry reports its `runsOnDefault` (what a new upload of that id gets) and, when
    the owner cannot change it, `runsOnLocked` with a `runsOnLockReason`.
  - Choosing players only for a mod whose `runsOnDefault` is `server` asks for
    confirmation and keeps a warning on its row: the server won't run its code, so
    a gameplay mod can make players' games disagree with the server or stop them
    joining. A mod that defaults to players only (today ItemQualityIndicator,
    Bannerlord.FamilyTree and FamilyAppearanceEditor) gets no warning.
  - A locked mod shows its value and the reason, without a choice:
    `server-provided` ("the server provides Harmony"), `submodule-invalid` (its
    server code is missing or unreadable; the note names the
    `submodule-class-missing:<Class>`, `submodule-dll-missing:<File>` or
    `submodule-dll-unreadable:<File>` issue), `runner-unsupported` (the server needs
    a runner update first) and `core-module` (core modules and Coop, which show no
    runs-on line). A reason the website does not know is shown as locked with
    generic copy rather than failing the list.
  - A refused switch to the server explains the control plane's issue only when
    the refusal names one (` Issue: <issue>.` after the module); otherwise, such as
    a dependency order the same save broke, the ordinary load-rule message is shown.
  - A change refused with `runner_unsupported` says so and reloads the list, so the
    runner-update locks appear at once.
  - A list without `runsOn` (a control plane that predates it) shows no choice. This
    fallback goes once the control plane's writer gate is on for good (see Rollout).
- **Mods players need**, below the list, names every enabled owner mod with its Id
  and exact version, players-only mods included (labelled "Players only: not run
  on the server"), and says that players need exactly these mods at these versions
  and no other community mods besides Bannerlord Co-op, because Coop's join check
  compares community modules both ways. It also says players must disable any
  official DLC (such as War Sails), which Coop's join check refuses. Disabled mods
  are left out. It reads the
  saved list, so it changes once an edit is saved.
  - **Download mod list**, shown when players need at least one mod, saves
    `BannerlordCoop-mod-list.json`: every module a player enables to join, in load
    order. That is the enabled core modules, Coop and owner mods, without
    `DedicatedServer.*`, which only the server loads. The shape is
    `{ format: "bannerlord-coop-mod-list", formatVersion: 1, serverId, exportedAt,
    mods: [{ order, id, name, version, kind: "core" | "coop" | "mod", playersOnly }] }`,
    where `order` starts at 1.
- When the running game uses an older list (`restartRequired`), the tab says that a
  restart applies the changes. Nothing restarts the server automatically.
- Saving changes nothing in a running game, so it needs no confirmation; the
  restart that applies it is the owner's choice. Refresh, upload and delete wait
  until pending saves finish, so every mutation is based on the list the owner sees.

## Transport

```
browser ─► /api/servers/<id>/mods?route=<route>       (POST, JSON)  ┐ website route handlers
browser ─► /api/servers/<id>/mods/chunk?uploadId&index (PUT, bytes) ┘ (same origin, session revalidated)
        ─► my-servers Edge Function ?resource=mods&route=<route> | ?resource=mod-chunk&uploadId&index
        ─► Oracle adapter /api/v1/mods/{list,load-order,uploads,uploads/complete,uploads/status,delete}
                          /api/v1/mods/uploads/chunk?uploadId=&index=
```

The browser talks only to the website's own route handlers
(`src/app/api/servers/[serverId]/mods`). They are route handlers rather than server
actions so a chunk relay of up to two minutes never blocks the page's sequential
server-action queue (Start, Save, status polling). Each request:

- is refused unless it is same-origin (`sec-fetch-site`/`Origin`);
- names one of six allowlisted route keys, or a chunk's upload UUID and index (0–12);
  no caller value ever becomes an upstream path;
- carries a body validated by `supabase/functions/_shared/server-mods-contract.ts`,
  the closed contract shared with the Edge Function, and a `serverId` equal to the
  page's server;
- revalidates the Supabase user and session, refreshing the session when it is
  within five minutes of expiry. After a `401` the browser retries once with
  `x-mods-refresh-session: 1`, which forces one refresh; a second `401` ends the
  call.

The `my-servers` Edge Function (`_shared/my-servers-mods.ts`) forwards only those
routes:

| Edge request | Upstream | Body bound | Upstream wait |
| --- | --- | --- | --- |
| `POST ?resource=mods&route=list\|load-order\|uploads\|complete\|status\|delete` | `POST /api/v1/mods/...` | 64 KiB JSON | 90 s |
| `PUT ?resource=mod-chunk&uploadId=<UUID>&index=<n>` | `PUT /api/v1/mods/uploads/chunk?uploadId=&index=` | 8 MiB `application/octet-stream` | 120 s |

- Mutations must send an `x-request-id` equal to the body `requestId`, so the website
  and control plane share one replay key.
- A chunk needs exactly one `x-chunk-sha256`. The function reads the whole chunk
  (refusing a larger declared or streamed body with `413`) before forwarding it with
  an exact `content-length`, so the adapter's 30-second request deadline only covers
  a fast Oracle-side transfer.
- Both waits stay below Supabase's 150-second response deadline. The website waits
  100 s (JSON) and 130 s (chunk) for the function; the browser waits 150 s and 180 s.
- Results are validated per route (a list of at most 133 entries, upload sessions
  whose chunk count matches the archive, a status bound to the requested upload)
  and returned in the website's versioned envelope with `Cache-Control: no-store`.
  Responses carrying a list may be up to 8 MiB; the others 64 KiB.
- Typed refusals pass through with their status. Unreadable `408`, `502`, `503` and
  `504` replies become retryable `503 control_plane_unavailable`; an unreadable
  `413` stays a non-retryable `request_too_large`; anything else that breaks the
  contract is a retryable `502 invalid_response` (an identical resend replays safely).
- CORS preflight lists `PUT` and `x-chunk-sha256`.

## Retries, polling and reconciliation

`src/app/lib/hosting/server-mods-client.ts` implements the contract's retry rules:

- Mutations resend the same `requestId`; chunks resend the same index and digest.
  Retryable failures (`429 rate_limited`/`busy`, retryable `mods_unavailable`,
  unreadable gateway replies, network loss) back off 1, 2, 4, 8 and then 15 seconds
  for at least 150 seconds. A plain list gives up after about 20 seconds and offers
  **Try again**.
- A reply without the website route's envelope is retried only when its status is
  `2xx` (a result that broke the contract), `408`, `429` or `5xx`. Any other status,
  such as the route's own `404` for a cross-site or malformed request, ends the call.
- One chunk is sent at a time, in order.
- After `complete`, `status` is polled after 2 s, growing to every 10 s, for up to
  12 minutes. `installed` returns the new list; `rejected`, `failed` and `expired`
  are reported. `unconfirmed`, any status the website does not know, a forgotten
  upload (`upload_not_found`), a completion whose answer was lost, and an install
  that outlives the poll window are all reconciled through `list`: the upload counts
  as installed only when its Id is listed with the uploaded archive's sha256.
- A stale revision, or any outcome the website could not confirm, reloads the list.

## Archive shape

`src/app/lib/hosting/server-mod-archive.ts` zips the picked folder with `fflate` into
the single shape the runner accepts and checks the runner's limits first, for
clearer feedback; the runner remains authoritative.

- The folder must contain `SubModule.xml` (exact name) at its top level. Its single
  `Id`, `Name` and `Version` must match the runner's patterns, the Id must not be
  reserved (Native, SandBoxCore, SandBox, StoryMode, CustomBattle, Multiplayer,
  BirthAndDeath, NavalDLC, Coop, CoopNightly, `DedicatedServer.*`), and `ModuleType`
  and `Official` must be absent, `Community` and `false`. DTDs, entities, CDATA and
  numeric character references are refused.
- The archive's single top-level directory is named exactly the `Id`, whatever the
  picked folder was called.
- At most 5,000 files, 512 MiB uncompressed and 100 MiB compressed; paths of at most
  240 bytes and 16 levels, without backslashes or control characters, unique after
  NFC and case folding.
- Entries above 1 MiB that would compress beyond 100:1 are stored uncompressed
  instead; an archive above 16 MiB that still exceeds 100:1 overall is refused.
- A fixed timestamp makes the same folder produce the same archive and sha256.

Which mods run headless is the control plane's and the dedicated server's concern
(custom-mods.md "Known limitations"); the tab only shows the notes the list carries.

## Start failures caused by mods

- A Start whose status reports `modLoadFailure` shows "Mod <Id> failed to load
  (missing assembly <Name>). Disable it in Mods and start again." (or the missing-DLL
  and generic variants) in the Start progress card.
- An immediate `mod_load_failed` refusal reads the Start's recorded diagnosis once
  and falls back to the control plane's own message.
- `crash_loop_cooldown` shows the control plane's message, which carries the
  remaining wait ("Start is paused for about N minutes. Changing its enabled mods
  ends the pause now."). Neither refusal starts status polling or a retry.

## Rollout

Deploy this website's optional `reorderable` reader before the control-plane
writer emits that field. Core movement appears only when the assigned runner
supports it. The control plane retains its reader-first store rollout and
rollback gates; the website never infers support from a build or mod id.

The tab depends on, in order:

1. the control-plane custom-mods release and runners updated with
   `install-managed-runner.sh --enable-mods` (older runners answer
   `runner_unsupported`);
2. the separately authorized Oracle Caddy change adding the `@mods` and `@modChunk`
   matchers on both hostnames;
3. this website's `my-servers` Edge Function (deployed from main by
   **Deploy Supabase hosting APIs**), after probing that the deployed function accepts
   an 8 MiB `PUT` body and recording one full chunk's end-to-end time.

Until all three are in place the tab is visible but its requests fail (a missing
proxy route reads as "The hosting service could not be reached"). Local tests use
synthetic fixtures; they do not prove the Supabase body limit, chunk latency through
Oracle, or that real mods load on the Linux server.

### Players-only mods (contract C3)

The website rolls out first. Both website deployments validate mod lists with the
shared contract and reject fields they do not know, so **both** must be live before
the control plane turns on its runs-on writer gate:

- the Next app (its mods route handlers and browser client), and
- the `my-servers` Edge Function, deployed by **Deploy Supabase hosting APIs**.

If only the Next app is updated, the Edge Function rejects every list that carries
`runsOn` and the Mods tab fails with `invalid_response` for every owner. Both accept
entries with all of `runsOn`, `runsOnDefault` and `runsOnLocked` (plus
`runsOnLockReason` exactly when locked) or with none of them (anything in between is
malformed), the new notes, the F17 issues, typed refusals that end in
` Issue: <issue>.`, and `mod_assembly_conflict`.

The "none of them" case exists only for a control plane below the writer gate.
Remove it, and make the fields required, once the gate is on in production and a
rollback below it is ruled out (tracked in #384).

## Run locally against the hosting sandbox

The control-plane repository's hosting sandbox
(`docs/managed-hosting/local-sandbox.md` there) runs the real control plane and web
adapter on `127.0.0.1:8796` with its own local Supabase stack (API on port 55421).
No Supabase Edge Function runs locally; under `next dev` the website runs the
`my-servers` Edge handler in its own server process instead:

```
browser ─► /api/servers/<id>/mods[/chunk]                 Next route handlers (as in production)
        ─► requestMyServersApi ─► fetchMyServersEdge      src/app/lib/control-plane/transport.ts
        ─► my-servers Edge handler, in process            src/app/lib/control-plane/local-gateway.ts
        ─► CONTROL_PLANE_URL /api/v1/mods/*               the sandbox adapter (path and query kept)
server-rendered reads (inventory, summary, Start status) ─► CONTROL_PLANE_ORIGIN /v1/user/control-plane
```

1. Start the sandbox as its document describes (`npm run hosting:sandbox:supabase`,
   then `npm run hosting:sandbox -- --dev-email <email>` in WSL). It prints the
   values for step 2.
2. Put these in `.env.local` (Git-ignored; never commit it), then restart `next dev`
   if it is running, because `NEXT_PUBLIC_*` values are compiled in:
   - `NEXT_PUBLIC_SUPABASE_URL`: the sandbox Supabase API origin (`http://127.0.0.1`,
     port 55421).
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`: that stack's
     keys (`npx supabase status --workdir scripts/hosting-sandbox` in the
     control-plane repository).
   - `DEV_AUTH_EMAIL`: the sandbox's `--dev-email` account.
   - `CONTROL_PLANE_URL`: the sandbox adapter origin (`http://127.0.0.1`, port 8796).
     Turns on the in-process gateway.
   - `CONTROL_PLANE_ORIGIN`: the same adapter origin. Server-rendered owner reads go
     to it directly; without it they go to production and the page has no servers.
3. `npm run dev`, open `http://localhost:3000/auth/dev-login?next=/servers`, then the
   seeded **Sandbox Server** and its **Mods** tab.

Loopback `http://` is accepted for `NEXT_PUBLIC_SUPABASE_URL`, `CONTROL_PLANE_ORIGIN`
and `CONTROL_PLANE_URL` only when `NODE_ENV` is `development`; production builds keep
HTTPS only, compile the gateway out and ignore `CONTROL_PLANE_URL`. A non-loopback
`CONTROL_PLANE_URL` fails closed. `NEXT_PUBLIC_LOCAL_CONTROL_PLANE`, which the sandbox
also prints, is not read by the website and can be left out.

Requests the browser sends straight to an Edge Function (latest-log download), other
Edge Functions (account, Patreon and region alerts, `control-plane-admin`) and the
console stream are not served locally.
