# Boosty membership adapter

The website links a website account to a Boosty subscriber and decides Boosty membership
evidence for the control plane's version 2 snapshot (`provider: "boosty"`). Boosty has no
official API: the adapter uses the internal web API called by the unofficial clients
`beekamai/boosty-api` and `ath31st/boosty_api_rs`. A read-only capture on 2026-11-10 confirmed
the shapes it reads; see [API assumptions](#api-assumptions) and [Commissioning](#commissioning).

## Linking by email

Each complete subscriber poll links subscribers to website accounts by email: Boosty's
`email` and the account's Supabase Auth email, both trimmed and lower-cased. Neither email is
verified, by design: whoever subscribes on Boosty with an account's email funds that account.
Supporters must subscribe with the same email they use on the website. The worker hashes
Boosty's emails on receipt and sends only SHA-256 digests to the database; no email is stored.

- A subscriber links only when its email is unique among subscribers and exactly one account
  has it, and neither side is already linked. Ambiguous emails are skipped silently.
- The head becomes `linked` with a new generation and a Boosty hint, and the same poll decides
  its evidence.
- A link is released when its subscriber is listed with an email that is no longer the
  account's (either side changed it): the binding is dropped and the head fences to
  `unlinked` with a new generation, so the control plane sees an identity change. That same
  poll may then link the subscriber to the account that now has the email.
- A second account taking a linked email does not move the link: the email is then ambiguous
  and the existing link stays. A subscriber missing from the list keeps its link; absence is
  decided as evidence below.
- Auth deletion tombstones the head and frees the Boosty user.

With `BOOSTY_STATUS_ENABLED=true` on the website server, `/account` shows a read-only Boosty
status (linked through your email, or subscribe on Boosty with this email) once
`website-account` has the Boosty policy. There is no unlink: the next poll would link the
account again.

## Evidence

The worker polls `GET /v1/blog/{blog}/subscribers` every 30 minutes (100 per page, at most 50
pages). A list is complete only when it reaches its stated `total` with no duplicates and no
change of `total`. Evidence uses `programId` = blog, `memberId: null` and
`policyVersion: "boosty-paid-v1"`; `nextPayTime` is never read. Former subscribers stay
listed, so `status` and `offTime` decide loss. After a complete poll:

| Observation | Evidence |
| --- | --- |
| `subscribed`, `status: "active"`, not blacklisted, qualifying level, price ≥ `minimumPrice` | `qualifying`; `paidThroughAt` = `offTime` when it is in the future (cancelled, still paid) |
| same, with another level (a free follower), a lower price or blacklisted | `nonqualifying`, not loss |
| `subscribed: false`, `status: "inactive"`, `offTime` at or before the poll | `nonqualifying` with `paidAccessEndedAt` = `offTime` (loss) |
| `status: "paused"` | `nonqualifying`, not loss |
| any other combination, or a missing or malformed field | `unknown` |
| absent from the first complete poll | `nonqualifying`, not loss; absence recorded |
| still absent in a complete poll at least an hour later | `nonqualifying` with `paidAccessEndedAt` (loss) |

Safeguards: nothing else writes loss. A failed page, incomplete list, budget overrun,
credential failure or circuit-breaker trip (a complete list more than `maximumDropFraction`
shorter than the last one) writes no evidence and changes no link; only evidence older than 24 hours becomes
`unknown`. A trip holds the baseline and alerts operators at most every 6 hours.

## Configuration

- `BOOSTY_MEMBERSHIP_POLICY_JSON` (Edge, read by `website-account` and `boosty-membership`):
  `{"blog","qualifyingLevelIds","minimumPrice","priceField":"price"|"RUB"|"USD"|"EUR","maximumDropFraction","policyVersion":"boosty-paid-v1"}`.
  The blog and level ids must match the control plane's Boosty policy entry.
- Website server: `BOOSTY_STATUS_ENABLED=true` shows the read-only Boosty status on `/account`;
  it gates only that display, never linking.
- `boosty-membership` only: `BOOSTY_SYNC_SECRET` (header `x-boosty-sync-key`),
  `BOOSTY_DEVICE_ID` and `BOOSTY_REFRESH_TOKEN` (seed the credential store once), `SMTP_PASS`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

Without the policy and both seeds the adapter answers `503 not_configured`.

**Creator credential.** Boosty rotates the refresh token on every refresh, so use a dedicated
device id. The tokens live in Vault behind the service-role-only `boosty_creator_credential`
RPC, fenced by a generation. Refresh (`POST https://api.boosty.to/oauth/token/`) runs only
under the worker lease, and the rotated pair is stored before the new access token is used.
A failed refresh stops the run, freezes evidence and alerts. To replace the credential, update
the two secrets, then:

```sql
begin;
delete from vault.secrets where id in (select unnest(array[device_secret_id, refresh_secret_id, access_secret_id]) from boosty_membership.creator_credential);
delete from boosty_membership.creator_credential;
commit;
```

To clear a breaker trip after checking the subscriber count in Boosty:

```sql
update boosty_membership.sync_state set last_complete_count = null, next_poll_at = '-infinity' where singleton;
```

**Scheduling.** A pg_cron job calls a private dispatcher that posts one wakeup through pg_net
only when dispatch is enabled and no run holds the lease. Store
`https://<project-ref>.supabase.co/functions/v1/boosty-membership` as Vault secret
`boosty_membership_function_url` and `BOOSTY_SYNC_SECRET` as `boosty_membership_sync_secret`, then:

```sql
begin;
select cron.schedule('boosty-membership', '*/5 * * * *', 'select boosty_membership.dispatch();');
update boosty_membership.sync_state set dispatch_enabled = true where singleton;
commit;
```

## API assumptions

Confirmed by the 2026-11-10 capture ([fixtures](../tests/fixtures/boosty/README.md)):

- Host `https://api.boosty.to`, Bearer auth, the token endpoint's form fields
  (`device_id`, `device_os=web`, `grant_type=refresh_token`, `refresh_token`) and its
  `{access_token, refresh_token, expires_in}` reply; `expires_in` is seconds and the refresh
  token rotates.
- Subscriber fields `id`, `email`, `subscribed`, `status`, `offTime` (Unix seconds),
  `isBlackListed`, `level.{id, price, currencyPrices}` (`price` in the blog currency, USD),
  the `{data, total, offset, limit}` envelope, and that the request `offset` counts rows.

Still unconfirmed: the `levelId` fallback (absent from the capture).

## Commissioning

This is the last rollout step in [membership onboarding](membership-onboarding.md#funding-providers-snapshot-v2-claim-v3).
The control plane's policy must already list Boosty: a Boosty hint it cannot handle is never
acknowledged, and the account's pending Boosty hints soon hit their bound.

1. Done 2026-11-10: a read-only capture of each route is checked into `tests/fixtures/boosty`.
2. Confirm the control plane lists Boosty, then set `BOOSTY_MEMBERSHIP_POLICY_JSON`, seed the
   credential and enable dispatch.
3. Subscribe a test account's email on Boosty, wait for a poll and confirm the control plane's
   Boosty snapshot and the acknowledgement of its hint, then set `BOOSTY_STATUS_ENABLED`.

To withdraw Boosty, unset `BOOSTY_STATUS_ENABLED` and disable dispatch first; the control plane
removes its Boosty entry only after no Boosty head or unacknowledged hint remains.
