# Campaign deletion outcomes

Rollout order for ControlPlane issue #581: deploy this website change (including
the Supabase `my-servers` Edge function) **first**, then deploy the additive
ControlPlane reader. Merging the website PR deploys the website through Cloudflare
Workers Builds; verify the Edge function's deployment separately. An older
control plane may refuse the read; Campaigns shows status unavailable and keeps
the original request without submitting another deletion.

The existing deletion response stays exactly `{action, jobId, outcome}`.
The new `delete-save-status` operation accepts exactly `{serverId, jobId}` and
returns exactly `{serverId, jobId, saveId, state, errorCode}`. Edge accepts a GET
with `resource=delete-save-status&serverId=<uuid>&jobId=<uuid>`; both parsers bind
the response to both requested identities. Every CP read requires current
save-management access. This reader cannot expose other job actions.

States are queued, running, retry-wait, succeeded, failed and cancelled. Claiming
means running; deferral stays queued; retry-wait remains pending. A failed
`queue_timeout` has specific copy; `save_still_loaded` explains how to unload the
campaign. Unknown bounded codes use generic translated copy. Failure alone
does not establish whether the runner changed a file.

The browser retains one deletion intent per authenticated account and server
in local storage before sending it, including its request UUID and confirmed
input. Lost replies offer explicit recovery with that same UUID and input.
Accepted receipts retain their job ID, including terminal outcomes. A refresh
reads fresh authorized status rather than trusting a cached result. A pending or
unreadable receipt blocks a new deletion. Polling backs off on unavailable reads,
pauses in hidden tabs and stops on a terminal result. Local storage must work to
submit a deletion; another browser/device does not inherit this browser's receipt.
Previously confirmed terminal receipts keep a terminal marker so pruned history
does not lock the controls, but cached outcomes are never displayed as fresh reads.

Unknown or corrupt receipts never automatically replay. **Check campaigns to
recover** requires owner confirmation and reads the complete current campaign
list. If a known target is absent it reports deleted; if still present it offers
**Try again**, with another exact-name confirmation and a fresh request UUID.
The control plane still refuses an incompatible active job. For a wholly corrupt
receipt there is no trustworthy target: successful list recovery clears the local
reference and asks the owner to choose a current campaign explicitly. Failed
authorized reads leave the receipt intact. Unavailable deletion status does not
disable campaign-list refresh or selection.
