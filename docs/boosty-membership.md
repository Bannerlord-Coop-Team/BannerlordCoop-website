# Boosty membership adapter

The website links a website account to a Boosty subscriber and decides Boosty membership
evidence for the control plane's version 2 snapshot (`provider: "boosty"`). Boosty has no
official API: the adapter uses the internal web API called by the unofficial clients
`beekamai/boosty-api` and `ath31st/boosty_api_rs`. Nothing here has run against Boosty yet;
see [Unverified assumptions](#unverified-assumptions) and [Commissioning](#commissioning).

## Linking by DM code

1. On `/account` the owner presses **Get a Boosty link code**. `website-account`
   (`boosty-start`) issues `BLC-XXXXX-XXXXX` (50 random bits); the database stores only its
   SHA-256, and the page keeps the code in an httpOnly cookie for 30 minutes.
2. The owner sends the code by Boosty private message to the creator (`creatorName`).
3. The `boosty-membership` worker reads new messages in the creator's dialogs. A message links
   only if it holds exactly one code, that code is pending for an account, and the author is the
   dialog's counterparty, so the creator's own replies never link. The head becomes `linked`
   with a new generation and a Boosty hint; evidence is `unknown` until the next poll, which
   linking schedules immediately.

One pending code per account, at most 5 per hour (then HTTP 429), 30-minute lifetime (a message
sent while live is accepted up to an hour later). A Boosty user already linked to another
account is refused (`conflict`), never moved, as with Patreon. Unlink drops the binding and
bumps the generation; Auth deletion tombstones the head and frees the Boosty user.

## Evidence

The worker polls `GET /v1/blog/{blog}/subscribers` every 30 minutes (100 per page, at most 50
pages). A list is complete only when it reaches its stated `total` with no duplicates and no
change of `total`. Evidence uses `programId` = blog, `memberId: null`, `paidThroughAt: null`
(`nextPayTime` is ignored) and `policyVersion: "boosty-paid-v1"`. After a complete poll:

| Observation | Evidence |
| --- | --- |
| subscribed, not blacklisted, qualifying level, price ≥ `minimumPrice` | `qualifying` |
| listed but `subscribed: false` | `nonqualifying`, **not loss** (the paid period may continue) |
| listed with another level, a lower price or blacklisted | `nonqualifying`, not loss |
| listed with a missing or malformed field | `unknown` |
| absent from the first complete poll | `nonqualifying`, not loss; absence recorded |
| still absent in a complete poll at least an hour later | `nonqualifying` with `paidAccessEndedAt` (loss) |

Safeguards: nothing else writes loss. A failed page, incomplete list, budget overrun,
credential failure or circuit-breaker trip (a complete list more than `maximumDropFraction`
shorter than the last one) writes no evidence; only evidence older than 24 hours becomes
`unknown`. A trip holds the baseline and alerts operators at most every 6 hours.

## Configuration

- `BOOSTY_MEMBERSHIP_POLICY_JSON` (Edge, read by `website-account` and `boosty-membership`):
  `{"blog","qualifyingLevelIds","minimumPrice","priceField":"price"|"RUB"|"USD"|"EUR","creatorName","maximumDropFraction","policyVersion":"boosty-paid-v1"}`.
  The blog and level ids must match the control plane's Boosty policy entry.
- `boosty-membership` only: `BOOSTY_SYNC_SECRET` (header `x-boosty-sync-key`),
  `BOOSTY_DEVICE_ID` and `BOOSTY_REFRESH_TOKEN` (seed the credential store once), `SMTP_PASS`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Website server: `BOOSTY_LINKING_ENABLED=true` shows the Boosty section on `/account`.

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

## Unverified assumptions

From the unofficial clients; confirm during commissioning:

- API host `https://api.boosty.to`, the token endpoint's form fields
  (`device_id`, `device_os=web`, `grant_type=refresh_token`, `refresh_token`) and its
  `{access_token, refresh_token, expires_in}` reply.
- Subscriber fields `id`, `subscribed`, `isBlackListed`, `level.{id, price, currencyPrices}`,
  `levelId`, the `{data, total}` envelope, and that `offset` counts rows.
- Dialog (`id`, `chatmate.id`, `lastMessage.{id, createdAt}`, `extra.offset`) and message
  (`id`, `authorId`/`author.id`, `createdAt`, `isDeleted`, text blocks `data[].content`, plain
  or Draft.js-encoded) shapes, increasing message ids, and newest-first ordering.

## Commissioning

This is the last rollout step in [membership onboarding](membership-onboarding.md#funding-providers-snapshot-v2-claim-v3).
The control plane's policy must already list Boosty: a Boosty hint it cannot handle is never
acknowledged, and the account's link calls soon fail with `PT429`.

1. On an isolated machine with the creator's credential, capture and sanitize one response of
   each route (subscribers, dialogs, messages, token refresh) and check them against the parsers.
2. Confirm the control plane lists Boosty, then set `BOOSTY_MEMBERSHIP_POLICY_JSON`, seed the
   credential and enable dispatch.
3. Set `BOOSTY_LINKING_ENABLED`, link a test account and confirm the control plane's Boosty
   snapshot and the acknowledgement of its hint.

To withdraw Boosty, unset `BOOSTY_LINKING_ENABLED` and disable dispatch first; the control plane
removes its Boosty entry only after no Boosty head or unacknowledged hint remains.
