# Server update progress

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

`?resource=build-options` and `{action: "set-server-build"}` are refused locally
with HTTP 400 before any control-plane call, so the Edge function never relays
version listing or selection.

## Where progress is shown

Update progress appears in the server's **Console**, in the lifecycle controls'
status area, for owners and managers. `ManagedServerControls` renders
`ServerUpdateProgressStatus` from the `useServerUpdateProgress` hook; it shows
the `ServerUpdateProgress` card and any progress error, and `hasUpdateStatus`
tells the Console when there is either to show. The hook is the only poller of
this read on the server page.
It reads the status when the page loads and again whenever a page refresh
brings a new server revision, so it follows any running update whoever started
it: the owner's Update now, a maintenance-window update or hosting support.
While an update runs it polls every 3 seconds for up to 15 minutes, and
refreshes the page once when a followed update ends; that finished update stays
on screen after the refresh. An update the page never saw running is not shown
once it has finished, so older outcomes are not replayed after a reload. A
failed read while following an update shows that progress is unavailable and
keeps polling; at the end of the window it shows that checks are paused. A
failed read while nothing is followed keeps polling quietly so a running update
is still picked up, and that loop ends without a message at the end of the
window. Each read's outcome is decided by the pure `nextUpdatePollStep`.

The step list uses icons as well as colour, the bar is a `progressbar` with step
text, and status and failures are announced through live regions.

### Rollout

The website change is safe in either order with
[ControlPlane #1125](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/pull/1125),
which retired the owner's Stable "Choose a public version" rollback pin. #1125
keeps `server-build-options` and `set-server-build` on the wire but always
refuses them with HTTP 409 `owner_build_selection_retired`, and its migration
138 clears every stored pin.

- **Website first.** It only stops calling operations the older control plane
  still supports. Existing pins stay in effect until #1125 and migration 138
  clear them; owners just cannot add or remove one from the website meanwhile.
- **Control plane first.** The older website's selector receives the 409
  refusal (or renders nothing when the options read fails) until the website
  deploys. `server-build-status` is unchanged in both versions.
