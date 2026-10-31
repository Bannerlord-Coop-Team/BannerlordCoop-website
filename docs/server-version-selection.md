# Server version selection (rollback pin)

Owners of a Stable server can choose a public game-server version on the Settings tab of `/servers/<id>`, or return to **Latest**. The control plane owns the catalogue and every decision; the website only relays three closed operations through the `my-servers` Edge function and presents their results.

| Edge request | Control-plane operation | Result |
| --- | --- | --- |
| `GET ?resource=build-options&serverId=` | `server-build-options` | The installable public versions (newest first), what runs, the pinned and the latest version, and per version whether it is older or newer, whether its save compatibility is verified, and whether the owner must acknowledge a save risk. `selectable: false` carries a reason (`nightly-channel`, `not-installed`, `no-public-builds`). |
| `GET ?resource=build-status&serverId=` | `server-build-status` | The current or latest update job as fixed steps (queued, stopping, backup, installing, starting, verifying) with per-step state, a plain progress line, the pre-update restore point, whether the previous version was restored automatically, and a plain failure reason with a next step. |
| `POST {action: "set-server-build", serverId, buildId, expectedUpdatedAt, acknowledgeSaveRisk}` with `x-request-id` | `set-server-build` | `enqueued`/`existing` with a job id, or `pinned`/`unpinned` with no job when the chosen version already runs. `buildId` is a public `vX.Y.Z` tag, or `null` for Latest. |

Contracts live in `supabase/functions/_shared/server-build-contract.ts` (exact-key parsers shared by the Edge function and the website). They are new operations, so older control planes answer with an unsupported-operation error; the page then reads no options and renders no version card, and the existing `update-now`, `update-status` and release-channel shapes are untouched. Deploy the website before the control plane.

## Behaviour

- Choosing any version other than Latest pins the server: the control plane records the pin only after the install is verified, and no automatic update, maintenance wave, Start, relocation or reconciliation moves it forward. Only selecting Latest clears the pin; automatic updates then apply to future releases. Changing the release channel also clears it.
- Registry builds publish no save format, so every earlier version is shown as not verified against the campaign. The confirmation explains the risk plainly and the owner must tick an acknowledgement before **Install** is enabled; the control plane enforces the same rule (`save_risk_unacknowledged`).
- A backup is taken before anything changes and is listed under Backups as `pre-update`. If the game does not start on the new version, the control plane returns the server to the previous version and the card says so.
- Choosing the version that already runs only pins or unpins it and does not restart the server.
- Progress is polled every 3 seconds for up to 15 minutes (`Check progress` resumes), the step list uses icons as well as colour, the bar is a `progressbar` with step text, and status and failures are announced through live regions. A page reload re-attaches to a running change; older outcomes are not replayed.
- The request identity is kept for a retry after an uncertain answer and released after a definitive refusal, so a repeat can never queue a second change.
