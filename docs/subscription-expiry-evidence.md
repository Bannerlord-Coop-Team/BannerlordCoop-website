# Confirmed paid-access loss for managed hosting

A complete creator-authenticated Patreon allocation read adds `nonqualifying`
evidence with `paidAccessEndedAt` when an `active_patron`, `declined_patron` or
`former_patron` (any last charge status except `Pending`) has no currently entitled
tier from the reviewed $20+ qualifying set. `tierIds` keeps the remaining paid tiers,
for example a $5 tier, and drops $0 tiers. It is the observation time, not a guessed
billing or historical expiration date. A still-entitled qualifying tier, a pending
charge, incomplete or conflicting data, free trials, gifts, outages and OAuth reads
never produce it. `20261122120000_paid_access_end_keeps_paid_tiers.sql` lets the
Patreon and Boosty validators accept loss with non-empty paid `tierIds`.

`202609280006_membership_paid_access_end.sql` accepts this bounded evidence through
the existing worker lease, account and link-generation fence. Old eight-field
producer evidence remains valid. `202609280005_control_plane_subscription_grace.sql`
is an exact mirror of the paired ControlPlane migration (catalog entry 091, after
main's retirement 089 and website-account ownership 090 migrations); applied migrations are
never rewritten. Both copies and their hashes are recorded in the migration inventory.

The paired ControlPlane change for issue 205 records new membership-funded
allocations, starts a 72-hour grace after confirmed loss, cancels on renewal, and
rechecks current binding and fresh post-deadline evidence before deletion. Existing
servers are grandfathered because their funding source cannot be reconstructed
reliably. No production backfill is included. Funding uses the durable website
account binding, including accounts without Discord; optional Discord profile
changes do not transfer ownership or reset subscription grace.

Roll out the reviewed shared migrations, then the compatible ControlPlane reader,
then this website producer. Older strict snapshot readers reject the new field.
Existing signed webhook and six-hour recovery scheduling is reused. Tests are
synthetic; production enablement and deletion require a separately authorized
coordinated rollout and verification of the actual configured campaign/tier policy.
Do not roll back the reader while the new evidence remains produced or stored.
