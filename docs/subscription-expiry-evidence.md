# Confirmed paid-access loss for managed hosting

A member qualifies only while entitled to a paid tier or level whose list price is at
least $20 (`minimumCents` / `minimumPrice`), whatever its id and whatever discount they
pay; `qualifyingTierIds`/`qualifyingLevelIds` stay in the policy but no longer gate.
A complete creator-authenticated Patreon read adds `nonqualifying` evidence with
`paidAccessEndedAt` when an `active_patron`, `declined_patron` or `former_patron`
(any last charge status except `Pending`) has no such tier. `tierIds` keeps the
remaining paid tiers, for example a $5 tier, and drops $0 tiers. It is the
observation time, not a guessed billing or historical expiration date. A
still-entitled $20+ tier, a pending charge, incomplete or conflicting data, free
trials, gifts, outages and OAuth reads never produce it. A member with
`patron_status: null` (free, never paid) stays `review_required`, not loss. Boosty's rules are in
[Boosty membership adapter](boosty-membership.md#evidence).
`20261123000000_membership_price_and_loss_breaker.sql` lets the Patreon and Boosty
validators accept loss with paid `tierIds` and Patreon qualifying evidence on any tier.

**Mass-loss breaker.** Each Patreon worker run and Boosty poll reports the linked accounts
that newly flipped to loss. Accounts whose loss was already recorded don't count.
`public.membership_loss_breaker` keeps one row per newly lost account for 6 hours. A provider
trips while those accounts are more than 25% of the members its worker re-reads: linked
Patreon members with a campaign membership (306 on 2026-11-23), or linked Boosty heads. Below
10 such members it never trips. Because the window spans runs, short or failing runs and
webhook runs of one or two members add up. A trip withholds the reporting run's new loss:
those members keep their current evidence, while qualifying and other evidence, including
renewals that cancel grace, is still written. It records `tripped_at` in
`public.membership_loss_breakers` and alerts operators at most every 6 hours. After a
glitch, withheld members are re-read on their next refresh, and new loss resumes once the
window drains.

Once operators have confirmed the losses are real (for example, the first refresh after this
policy change), an administrator allows them for 1-24 hours from the SQL editor. Edge
functions cannot call this:
`select public.membership_loss_breaker_allow('patreon', 3, '<operator>', '<why these losses are real>');`
It records `allowed_at`, `allowed_until`, `allowed_by` and `allowed_reason`. A check rejects
any allowance longer than 24 hours or without who and why. Trips still alert during an
allowance. Then mark only the linked Patreon members due:
`update patreon_roles.memberships m set due_at = now(), priority = 2 from public.patreon_accounts a where a.patreon_user_id = m.patreon_user_id;`
At 20 members per 5-minute run, 306 members take 16 runs (about 80 minutes).

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
