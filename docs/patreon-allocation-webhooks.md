# Patreon-funded server allocations

The $20+ benefit supplies one allocation allowance. Members claim an available
slot themselves through the existing Create flow. Webhooks do not purchase VPS
hosts, reserve capacity, create servers, or start containers.

The existing signed `patreon-roles` webhook queues a current Patreon V2 member
read. The worker evaluates a separate, versioned allocation policy, then updates
the linked account's normalized membership evidence and existing durable outbox
in the same transaction as role reconciliation. The control plane consumes that
outbox through its existing receipt/claim synchronizer (normally once per
minute). Website roles and manual allocation grants remain independent.

A qualifying member needs a reviewed campaign/tier mapping, a tier priced at least
2,000 USD cents, current entitlement of at least 2,000 cents, `active_patron`, a
`Paid` charge status, and complete valid billing evidence. Free trials and gifts
are excluded, matching the existing allocation policy. This is current benefit
eligibility, not proof that a specific payment settled. Downgrades, loss of
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

## Policy pairs

Two reviewed policy pairs exist and the worker, the database pin and the control
plane must all use the same one:

| policyVersion            | minimumCents | Commissioned tiers (campaign `16338430`)                          |
| ------------------------ | ------------ | ------------------------------------------------------------------ |
| `patreon-paid-usd20-v1`  | 2000         | Veteran `28995946`, Elite `28995952`, Noble `28995955` (current)   |
| `patreon-paid-usd50-v1`  | 5000         | Elite `28995952`, Noble `28995955` (used 2026-09-22 to 2026-10-02) |

The worker pins its first allocation policy in `patreon_roles.sync_state` and
refuses configuration drift. Changing the live pair needs a reviewed migration
that re-pins the singleton; `202610020001_membership_allocation_usd20.sql` is the
reviewed USD20 re-pin. It also marks every linked member due so the next worker
runs re-read them under the new policy; evidence recorded under the previous
policy version cannot fund an allocation until that re-read completes. Mismatched
amount/version pairs are refused by the worker, the RPC and the control plane.

## Coordinated rollout

Source validation does not activate this integration. Apply the append-only
`202609220001_patreon_allocation_webhooks.sql` migration through the coordinated
control-plane migration catalog; earlier applied migrations stay unchanged.
Deploy the CP reader accepting both policy versions and the website/Edge readers
before switching policy. Old role-only workers remain compatible with the
migration and do not extend allocation eligibility.

Verify the actual tier IDs and prices through the creator API or the campaign's
public tier listing before changing a mapping. Set the same reviewed policy in CP
`HOSTING_MEMBERSHIP_POLICY_JSON`, the website OAuth function's
`HOSTING_MEMBERSHIP_POLICY_JSON`, and the existing `patreon-roles` function's
`HOSTING_MEMBERSHIP_WEBHOOK_POLICY_JSON`:

```json
{"campaignId":"16338430","qualifyingTierIds":["28995946","28995952","28995955"],"currency":"USD","minimumCents":2000,"policyVersion":"patreon-paid-usd20-v1"}
```

Omitting the webhook setting retains role-only behavior. A later campaign/tier
policy change needs a separately reviewed migration. Reuse the existing webhook
registration, creator credential, conditional dispatch, and recovery cron. Never
put credentials in source or command arguments. Migration, Edge deployment and
live configuration changes require separate authorization.

Validate an authorized real member through grant, self-service claim, downgrade,
cancel/expire, duplicate events and unlink/relink. Inspect the resulting CP source
receipt and allowance, independent manual quota, and existing-server access.
Local tests use mocked Patreon and embedded PostgreSQL; they do not establish
live billing behavior, concurrent PostgreSQL locks, or production activation.

For rollback, remove only `HOSTING_MEMBERSHIP_WEBHOOK_POLICY_JSON` and redeploy the
worker to stop allocation refresh while preserving website roles. Retain the
migration, account links, outbox and receipts. Existing finite evidence expires;
independent administrative grants and server data survive. Reverting CP to the
USD50 policy changes eligibility and requires an explicit operational decision
plus another re-pin migration.
