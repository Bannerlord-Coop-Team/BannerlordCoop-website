# Server versions and update progress

GHCR is the only source of truth for which game build a hosted server runs. Every
server runs its release channel's current build (Public or Nightly). Owners choose
the channel on Settings; nobody, owner or administrator, can pin a server to a
version. A bad release is fixed by publishing a new build to the channel.

## What the website relays

The `my-servers` Edge function relays one closed read for this feature:

| Edge request | Control-plane operation | Result |
| --- | --- | --- |
| `GET ?resource=build-status&serverId=` | `server-build-status` | The current or latest update job as fixed steps (queued, stopping, backup, installing, starting, verifying) with per-step state, a plain progress line, the pre-update restore point, whether the previous version was restored automatically, and a plain failure reason with a next step. |

The contract lives in `supabase/functions/_shared/server-build-contract.ts`
(`parseBuildStatus`, an exact-key parser shared by the Edge function and the
website). Versions are shown bare (`0.1.6`); the parser strips the registry's
leading `v`.

The Settings tab's **Server version** card and the Console's update controls poll
this read every 3 seconds for up to 15 minutes (`Check progress` resumes). The
Settings card appears only while an update runs, or until a running update this
page followed has finished, and shows no version choice. The step list uses icons
as well as colour, the bar is a `progressbar` with step text, and status and
failures are announced through live regions. A page reload re-attaches to a
running update; older outcomes are not replayed.

## Retired version selection

[ControlPlane #1125](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/pull/1125)
retired the owner's Stable "Choose a public version" rollback pin. The control
plane keeps `server-build-options` and `set-server-build` on the wire, but both
always refuse with HTTP 409 `owner_build_selection_retired`. Migration 138 clears
every stored pin.

The website no longer offers the selector and the Edge function no longer relays
either operation: `?resource=build-options` and `{action: "set-server-build"}`
are refused locally with HTTP 400 before any control-plane call. If a stale
caller still receives `owner_build_selection_retired`, `ownerRefusalMessage`
shows the control plane's plain refusal text.

### Rollout

The website change is safe in either order with ControlPlane #1125:

- **Website first.** It only stops calling operations the older control plane
  still supports. Existing pins stay in effect until #1125 and migration 138
  clear them; owners just cannot add or remove one from the website meanwhile.
- **Control plane first.** The older website's selector receives the 409
  refusal (or renders nothing when the options read fails) until the website
  deploys. `server-build-status` is unchanged in both versions.
