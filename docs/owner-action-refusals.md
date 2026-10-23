# Owner action refusals

An HTTP status alone does not establish whether a mutation happened. The shared
`ownerRefusalMessage` classifier accepts only a strictly parsed owner envelope,
a known admission-refusal code, `retryable: false`, and no accepted `operationId`.
Suspensions use `action.refusal.serverSuspended` in all 11 locales. Existing
localized refusal messages and refresh behavior take precedence; newly recognized
admission refusals use the control plane's bounded safe message. Local errors,
future codes, authorization before receipt lookup, request conflicts, accepted
jobs, timeouts and malformed responses keep their existing recovery paths.
`operation_in_progress` is deliberately excluded: it can mean that the same
request ID is still being submitted. Its matching transfer receipt must survive.

## Handler audit

This table records website handling **when a typed refusal reaches the action**;
it does not establish that every deployed CP route exposes suspension that way.
The CP #611 / `97cc88e9` per-route source-and-test audit below establishes the
current route differences. Masked `container_command_unavailable`, successful `kind: "rejected"`
transfer results, retryable `mods_unavailable`, and configuration conflicts retain
their existing handling. Never infer suspension from those generic shapes.
The direct-controls typed-suspension regression is contract coverage, not proof
that a live direct route produces that envelope.

| Owner/manager action | Definitive admission refusal | Retryable refusal | Unknown outcome (network, timeout, unenveloped 5xx, malformed reply) |
| --- | --- | --- | --- |
| Start, Stop, Restart, Update now | Refusal copy; no status-confirmation prompt | Existing code-specific guidance or status following | Existing status following/unconfirmed copy |
| Password | Refusal copy | Existing unconfirmed copy | Existing password confirmation/status refresh |
| Import save/config, export save | Refusal copy; `rejected` settles the matching transfer intent | Existing transfer guidance; retain unconfirmed intent | Existing transfer unknown copy; retain original UUID |
| Export config, download exported save | Refusal copy | Existing download guidance | Existing transfer unknown copy; retained export is unchanged |
| Runner configuration | Refusal copy; `notSubmitted` releases the in-memory request | Existing per-code guidance | Existing unconfirmed copy; retain request UUID |
| Console command, result acknowledgement | Refusal copy; `uncertain: false` | Existing busy/rate guidance | Existing delivery-unknown copy; existing reconciliation |
| Campaign select/reset | Refusal copy; `notSubmitted` releases the in-memory request | Existing per-code guidance | Existing unconfirmed copy and recovery |
| Legacy save selection | Refusal copy | Existing selection failure copy | Existing selection failure copy |
| Campaign deletion | Refusal copy; existing `notSubmitted` path | Retain unresolved request | Existing deletion failure copy; retain UUID and prior receipt |
| Backup, backup restore, autosave restore | Refusal copy; `retrySameRequest: false` settles matching intent | Existing rate/busy/recovery guidance | Existing unknown copy; retain original UUID |
| Release channel, server settings, visibility | Refusal copy; `rejected` releases the matching request | Existing per-code guidance | Existing unconfirmed copy and recovery |
| Server deletion | Refusal copy; `rejected` releases the confirmed request | Existing per-code guidance | Existing unknown copy; retain original confirmed request |
| Grant/revoke manager | Refusal copy | Existing failure guidance | Existing unconfirmed copy |
| Dismiss notice | Refusal copy | Existing failure guidance | Existing dismissal-failure copy |
| Mods order/delete/upload | Localized suspension refusal; existing bounded-code refusals | Existing bounded retries with same request | Existing retry/reconciliation and unavailable copy |
| Server onboarding / region requests | Existing closed post-receipt refusal list | Existing recovery with same UUID | Existing unconfirmed copy and retained intent |

Onboarding creates a new server rather than mutating a suspended one. Log,
inventory, progress and status downloads are reads; their existing failure paths
do not describe acceptance of a mutation. No Edge contract changes are required.

After a mod upload completion is accepted or becomes uncertain, a suspended
reconciliation read reports `upload_status_unavailable`: that read cannot establish
whether the earlier upload installed. Suspension copy applies to the mutation's
admission refusal, not to recovery of its accepted or uncertain completion.

## CP #611 route shapes

Source and existing-test inspection at
`97cc88e9c3a5ce5855d180a2302c656474ca3779`; no production requests or CP tests
were run for this audit. These assume a fresh request from an authorized owner,
valid input and target, and an actual administrative/subscription hold. Earlier
validation can win; accepted-request replay can return its receipt before a hold.

| CP route / operation | Held-server reply | Evidence and limit |
| --- | --- | --- |
| Direct `/api/v1/start`, `/stop`, `/restart` | 409 `container_command_unavailable`, false retryability, no typed suspension | [Direct adapter](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/blob/97cc88e9c3a5ce5855d180a2302c656474ca3779/src/hosting/control-plane/web/control-plane-web-admin-server.ts#L648); generic envelope test `hosting-control-plane-web-user.test.ts:327`. Exact suspended HTTP cases not located. |
| Typed `server-operation` Start/Stop/Restart | 409 `server_suspended`, false retryability | `hosting-api/owner-files.test.ts:80-89` asserts subscription-held Start; Stop/Restart are source-derived. This differs from the website's direct lifecycle routes. |
| `console-command` | 409 `server_suspended`, false retryability | `console-command-dispatcher.ts:55`, `workflow.ts:1241`; no exact held HTTP test located. Retained result/acknowledgement reads remain available. |
| File `import-config` | 409 `server_suspended`, false retryability | `hosting-api/owner-files.test.ts:73-79` asserts the full envelope. |
| File `import-save`, `restore-save-generation` | 409 `safe_stop_required`, false retryability | `owner-file-transfers.ts:170-173`, `workflow.ts:1007-1014`; held cases source-derived. Existing localized handling remains. |
| File `export-save` | 200 job when eligible for subscription rescue; otherwise 200 `{kind:"rejected"}` | `hosting-api/owner-files.test.ts:50-71` covers rescue export/download; rejected projection in `hosting-owner-file-failure.test.ts:40-67`, exact held rejection HTTP case not located. Status/download retain their receipt contract. |
| Mods list/upload/chunk/complete/status/order/delete | 409 `mods_unavailable`, **retryable true** | `hosting-api/mods-uploads.test.ts:118-121`, `hosting-mods-web-retryable.test.ts:86-95`; not every held HTTP variant has an exact test. Preserve existing bounded retries and reconciliation. |
| Direct runner config GET/POST | 409 `configuration_unavailable`, false retryability | `application-controller.ts:449-460`, adapter `control-plane-web-admin-server.ts:622-624`; existing conflict HTTP test is not an exact held-envelope assertion. |
| Backup/create and restore | 409 `server_suspended`, false retryability | Full held create envelope: `hosting-api/owner-files.test.ts:80-89`; restore source-derived, earlier backup eligibility checks can win. |
| Campaign reset/select/delete, settings/password, release/update, server deletion | 409 `server_suspended`, false retryability | Hold gates in `workflow.ts:738,676,5135,1394,1455,1092,1139,489`. Most exact held HTTP tests are absent; delete has workflow evidence at `hosting-workflow.test.ts:2143-2153`. |
| Visibility, manager access, notices/dismissal | Hold alone does not refuse these metadata/access/viewer operations | `repository.ts:3405-3462`, `workflow.ts:3855-3910`, `application-controller.ts:292-305`. Suspended servers are independently excluded from public listing. |

Held/stopped console streaming maps an opening failure to 404; held but still
observed running is unverified. Onboarding targets a new server. This website
change does not infer suspension from any masked or generic reply. Preserving a
typed pre-effect suspension in direct lifecycle/config adapters requires a
separate CP change, deployed after this website's refusal presentation.

The backup renderer regression uses the source/test-confirmed typed envelope and
checks refused, unknown and successful outcomes. Browser console capture starts
after the server-action boundary; existing server diagnostics are separate output.

## Receipt safety

Website #375 / ControlPlane issue #581 retain a campaign deletion's confirmed
input before dispatch. A fresh confirmed retry may carry one previous accepted
receipt: a definitive refusal restores that receipt and resumes authorized status
reads. An unknown reply retains both identities. The existing request-ID check
adopts a newer cross-tab receipt before settling anything. Backup settlement also
compares request IDs; file transfers now check the current stored request after
each submission, including the one-time stale export retry. Late replies cannot
clear a replacement receipt.

The merge base is `8249dab` (resolve its full SHA from Git for rollback). Deployment
verification requires the Workers build at the merge SHA, live chunk copy, and
jsdom refusal/unknown/success rendering with the live CP envelope shape and no
console errors. This change does not authorize customer-server operations.
