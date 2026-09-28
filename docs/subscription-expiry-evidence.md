# Confirmed paid-access loss for managed hosting

The creator-authenticated Patreon allocation refresh can now add optional
`paidAccessEndedAt` evidence after validating a former patron with a paid charge
history, no currently entitled tiers and zero entitlement amount. It is the
observation time, not a guessed billing or historical expiration date. Cancellation
with remaining benefits, declined charges, ambiguous data, outages and stale
observations do not produce it. OAuth linking remains unchanged.

`202609280006_membership_paid_access_end.sql` accepts this bounded evidence through
the existing worker lease, account and link-generation fence. Old eight-field
producer evidence remains valid. `202609280005_control_plane_subscription_grace.sql`
is an exact mirror of the paired ControlPlane migration; applied migrations are
never rewritten. Both copies and their hashes are recorded in the migration inventory.

The paired ControlPlane change for issue 205 records new membership-funded
allocations, starts a 72-hour grace after confirmed loss, cancels on renewal, and
rechecks current binding and fresh post-deadline evidence before deletion. Existing
servers are grandfathered because their funding source cannot be reconstructed
reliably. No production backfill is included.

Roll out the reviewed shared migrations, then the compatible ControlPlane reader,
then this website producer. Older strict snapshot readers reject the new field.
Existing signed webhook and six-hour recovery scheduling is reused. Tests are
synthetic; production enablement and deletion require a separately authorized
coordinated rollout and verification of the actual configured campaign/tier policy.
Do not roll back the reader while the new evidence remains produced or stored.
