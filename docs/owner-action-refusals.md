# Owner action refusals

An HTTP status alone does not establish whether a mutation happened. The shared
`ownerRefusalMessage` classifier accepts only a strictly parsed owner envelope,
a known admission-refusal code, `retryable: false`, and no accepted `operationId`.
Suspensions use `action.refusal.serverSuspended` in all 11 locales; other known
admission refusals use the control plane's bounded safe message. Local errors,
future codes, authorization before receipt lookup, request conflicts, accepted
jobs, timeouts and malformed responses keep their existing recovery paths.

## Handler audit

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
