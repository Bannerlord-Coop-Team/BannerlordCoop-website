# Patreon-funded server allocations

The $50+ benefit supplies one allocation allowance. Members claim an available
slot themselves through the existing Create flow. Webhooks do not purchase VPS
hosts, reserve capacity, create servers, or start containers.

The existing signed `patreon-roles` webhook queues a current Patreon V2 member
read. The worker evaluates a separate, versioned USD50 allocation policy, then
updates the linked account's normalized membership evidence and existing durable
outbox in the same transaction as role reconciliation. The control plane consumes
that outbox through its existing receipt/claim synchronizer (normally once per
minute). Website roles and manual allocation grants remain independent.

A qualifying member needs a reviewed campaign/tier mapping, a tier priced at least
5,000 USD cents, current entitlement of at least 5,000 cents, `active_patron`, a
`Paid` charge status, and complete valid billing evidence. Free trials and gifts
are excluded, matching the existing allocation policy. This is current benefit
eligibility, not proof that a specific $50 payment settled. Downgrades, loss of
qualification and cancellation/expiry updates withdraw the membership allowance.
A cancellation event is only a refresh signal; the current API evidence decides
eligibility. A former patron without reliable paid-access evidence becomes
`review_required` and cannot fund a new allocation. No next-charge date is treated
as paid-through access.

Evidence stays valid for less than 24 hours. The existing six-hour linked-member
refresh recovers missed events and renews eligibility; no second scheduler is
created. HTTP failures preserve the last finite evidence and retry through the
existing queue. Once evidence expires, new membership-funded allocations fail
closed even if the worker or synchronizer stops. Removing the allowance does not
stop or delete existing servers, erase data, revoke administrative quota, or
change suspension decisions. Existing used allocations continue to count.

Worker leases and member generations reject stale events. Each read also carries
the account's link generation and revision captured before the request. Unlinks,
relinks and intervening OAuth completions fence the response. Newly discovered
identities need a fresh read after resolving their current link. A webhook cannot
create a link, match by email, or transfer another account's benefit. The private
snapshot endpoint still rechecks authoritative Auth identities before CP admission.

## Coordinated rollout

Source validation does not activate this integration. Apply the append-only
`202609220001_patreon_allocation_webhooks.sql` migration through the coordinated
control-plane migration catalog; earlier applied migrations stay unchanged.
Deploy the CP reader accepting USD50 evidence and the website/Edge readers before
enabling the new policy. Old USD20 evidence remains readable for migration but
cannot qualify under USD50. Old role-only workers remain compatible with the
migration and do not extend allocation eligibility.

Verify the actual USD50-or-higher tier IDs through the creator API; the old $20
Mega Supporter tier must not be reused. Set the same reviewed policy in CP
`HOSTING_MEMBERSHIP_POLICY_JSON`, the website OAuth function's
`HOSTING_MEMBERSHIP_POLICY_JSON`, and the existing `patreon-roles` function's new
`HOSTING_MEMBERSHIP_WEBHOOK_POLICY_JSON`:

```json
{"campaignId":"<verified campaign ID>","qualifyingTierIds":["<verified $50+ tier ID>"],"currency":"USD","minimumCents":5000,"policyVersion":"patreon-paid-usd50-v1"}
```

Omitting the new webhook setting retains role-only behavior. Its first worker
acquisition pins the policy in private worker state; subsequent mismatches fail
closed. A later campaign/tier policy change needs a separately reviewed migration.
Reuse the existing webhook registration, creator credential, conditional dispatch,
and recovery cron. Never put credentials in source or command arguments. Migration,
Edge deployment and live configuration changes require separate authorization.

Validate an authorized real member through grant, self-service claim, downgrade,
cancel/expire, duplicate events and unlink/relink. Inspect the resulting CP source
receipt and allowance, independent manual quota, and existing-server access.
Local tests use mocked Patreon and embedded PostgreSQL; they do not establish
live billing behavior, concurrent PostgreSQL locks, or production activation.

For rollback, remove only `HOSTING_MEMBERSHIP_WEBHOOK_POLICY_JSON` and redeploy the
worker to stop allocation refresh while preserving website roles. Retain the
migration, account links, outbox and receipts. Existing finite evidence expires;
independent administrative grants and server data survive. Reverting CP to the
legacy policy changes eligibility and requires an explicit operational decision.
