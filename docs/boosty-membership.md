# Boosty membership adapter

The website links a website account to a Boosty subscriber and decides Boosty membership
evidence for the control plane's version 2 snapshot (`provider: "boosty"`). Boosty has no
official API: the adapter uses the internal web API that the unofficial clients
`beekamai/boosty-api` and `ath31st/boosty_api_rs` call. Nothing here has been run against
Boosty. Commissioning must capture sanitized real responses before enabling it (see
[Commissioning](#commissioning)).

## Linking: a one-time code sent by private message

1. On `/account`, the owner presses **Get a Boosty link code**. The `website-account` Edge
   function (`boosty-start`) issues `BLC-XXXXX-XXXXX` (10 Crockford base32 symbols, 50
   random bits). The database stores only its SHA-256. The website keeps the code in the
   httpOnly `__Host-boosty-link-code` cookie for 30 minutes so the page can show it.
2. The owner sends the code as a Boosty private message to the creator account named by
   `creatorName`, from the Boosty account they subscribe with.
3. The `boosty-membership` worker reads the creator's dialogs, then the new messages of each
   dialog with a newer message than its stored cursor. A message links only if it contains
   exactly one code, that code is an account's **pending** code, and the message author is
   the dialog's counterparty (`chatmate`). The creator's own replies never link. The sender's
   numeric Boosty user id becomes the account's `provider_user_id`; the head becomes `linked`
   with a generation bump and a Boosty outbox hint, and evidence starts `unknown` until the
   next subscriber poll, which linking schedules immediately.

Bounds: one pending code per account (a new code replaces it), at most 5 codes per account
per hour (HTTP 429 after that), 30-minute lifetime. A message sent while the code was live is
still accepted up to an hour after expiry. The worker reads at most 5 dialog pages of 20 and
20 dialogs' newest 20 messages per run. A dialog whose newest message is over an hour old has
its cursor advanced without a read, because it cannot carry a live code.

**Conflict policy: refuse, never move.** If the sending Boosty user is already linked to
another website account, the code is marked `conflict` and nothing changes; the page tells
the owner to disconnect Boosty on the other account first. This matches Patreon, where a
Patreon identity bound to another account refuses completion. Moving the binding would let
whoever controls a Boosty account release another website account's funding identity without
that account's owner acting. A code whose account was linked or relinked since it was issued
is marked `superseded`.

Unlink (`boosty-unlink`) drops the binding and any code and bumps the generation to
`unlinked`. Auth deletion tombstones the head (`account_deleted`) and cascades the binding
away, freeing the Boosty user for another account.

## Evidence

Only linked heads get evidence, in the version 2 vocabulary: `programId` is the configured
blog slug, `memberId` is always `null`, `paidThroughAt` is always `null` (`nextPayTime` is the
next charge, not paid-through, and is never read), `policyVersion` is `boosty-paid-v1`, and
`evidenceSha256` is the SHA-256 of the canonical fixed-order observed facts.

The worker polls the subscriber list every 30 minutes (and right after a link):
`GET /v1/blog/{blog}/subscribers?limit=100&offset=N&sort_by=on_time&order=gt&with_follow=false`,
at most 50 pages. A list is **complete** only when it reaches its stated `total` with no
duplicate ids and no change of `total` between pages. After a complete poll:

| Observation | Evidence |
| --- | --- |
| listed, `subscribed: true`, not blacklisted, level in `qualifyingLevelIds`, level price ≥ `minimumPrice` | `qualifying`, `tierIds: [level]` |
| listed, `subscribed: false` | `nonqualifying`, no tiers, **no loss**: a cancelled subscription can keep paid access until its period ends and the list exposes no paid-through time |
| listed and subscribed, but blacklisted, another level or a lower price | `nonqualifying`, no loss |
| listed with `subscribed`, blacklist, level or price missing or malformed | `unknown` |
| absent, first complete poll | `nonqualifying`, no loss; absence recorded |
| absent in a later complete poll at least one hour after the first absence | `nonqualifying`, `paidAccessEndedAt = verifiedAt` |

Listing again clears a recorded absence. The control plane treats only `nonqualifying` with
a `paidAccessEndedAt` within 24 hours as confirmed loss, so these rows decide removals.

**Nothing else writes loss.** A failed page, an incomplete list, more than 5,000 linked
heads, a run-time budget overrun, any credential failure, or a **circuit-breaker trip** (a
complete list more than `maximumDropFraction` shorter than the last complete one) writes no
evidence from that poll. Linked heads whose evidence is older than 24 hours become `unknown`;
newer evidence is left as it is. A trip holds the breaker baseline and emails the operators
(at most every 6 hours) until it is cleared.

## Configuration

Edge function secrets (both `website-account` and `boosty-membership` read the policy):

- `BOOSTY_MEMBERSHIP_POLICY_JSON`: strict JSON
  `{"blog":"<slug>","qualifyingLevelIds":["<id>",…],"minimumPrice":<integer>,"priceField":"price"|"RUB"|"USD"|"EUR","creatorName":"<display name>","maximumDropFraction":<0..1>,"policyVersion":"boosty-paid-v1"}`.
  `priceField` names the level field compared with `minimumPrice`: `price` (the level's own
  price) or one of `currencyPrices`. The blog must match the control plane's Boosty
  `programId`, and the level ids its `qualifyingTierIds`.
- `boosty-membership` only: `BOOSTY_SYNC_SECRET` (scheduler header `x-boosty-sync-key`),
  `BOOSTY_DEVICE_ID` and `BOOSTY_REFRESH_TOKEN` (seed the credential store once), `SMTP_PASS`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Website server: `BOOSTY_LINKING_ENABLED=true` shows the Boosty section on `/account`.

The adapter is disabled (`503 not_configured`, and `{"version":1,"configured":false}` from
`boosty-status`) unless the policy and both credential seeds are set.

## Creator credential

Boosty rotates the refresh token on every refresh: the previous one stops working, and a
creator browser session that refreshes can also invalidate ours. Use a dedicated device id.
The device id, refresh token and access token live in Supabase Vault behind the
service-role-only `boosty_creator_credential` RPC, fenced by a generation. A refresh is
`POST https://api.boosty.to/oauth/token/` with form body
`device_id=…&device_os=web&grant_type=refresh_token&refresh_token=…`. It runs only under the
worker's two-minute lease (one worker at a time), when the access token is missing or within
12 hours of expiry, or once after a 401. The rotated pair is stored before the new access
token is used; a lost store reply is checked against the store.

A refused or failed refresh, a 401/403 that survives one replacement, or an unstorable
rotation stops the run, freezes evidence as above and emails the region alert recipients
(at most every 6 hours). To replace the credential, update `BOOSTY_DEVICE_ID` and
`BOOSTY_REFRESH_TOKEN`, then as the database operator:

```sql
begin;
delete from vault.secrets where id in (select unnest(array[device_secret_id, refresh_secret_id, access_secret_id]) from boosty_membership.creator_credential);
delete from boosty_membership.creator_credential;
commit;
```

The next run seeds the store from the new secrets.

To clear a circuit-breaker trip after confirming the subscriber count in Boosty:

```sql
update boosty_membership.sync_state set last_complete_count = null, next_poll_at = '-infinity' where singleton;
```

## Scheduling

Like `patreon-roles`, a pg_cron job calls a private dispatcher, which posts one wakeup through
pg_net only when dispatch is enabled and no run holds the lease. Store the canonical
`https://<20-letter-project-ref>.supabase.co/functions/v1/boosty-membership` URL as the Vault
secret `boosty_membership_function_url` and the `BOOSTY_SYNC_SECRET` value as
`boosty_membership_sync_secret`. After deploying and validating the worker, as the database
operator:

```sql
begin;
select cron.schedule('boosty-membership', '*/5 * * * *', 'select boosty_membership.dispatch();');
update boosty_membership.sync_state set dispatch_enabled = true where singleton;
commit;
```

Each run is bounded to 25 seconds of work.

## Unverified assumptions

These come from unofficial clients and must be confirmed during commissioning:

- The API host `https://api.boosty.to` (`BOOSTY_API_ORIGIN` in `_shared/boosty-api.ts`).
- The token endpoint and its form fields, and the `{access_token, refresh_token, expires_in}`
  reply.
- Subscriber fields `id`, `subscribed`, `isBlackListed`, `level.{id, price, currencyPrices}`,
  `levelId`, the page envelope `{data, total}`, and that `offset` counts rows.
- Dialog and message shapes, parsed only by `_shared/boosty-messages.ts`: dialog `id`,
  `chatmate.id`, `lastMessage.{id, createdAt}` (Unix seconds), `extra.offset`; message `id`,
  `authorId` or `author.id`, `createdAt`, `isDeleted`, and text blocks
  `data[].{type:"text", content}`. `content` may be plain or a Draft.js-encoded string; the
  code matcher works on either. Message ids must increase within a dialog.
- That the newest dialogs and messages come first. If they do not, the bounded scan may miss
  a code until the owner sends it again.

## Commissioning

Commissioning is the last step of the rollout sequence in
[membership onboarding](membership-onboarding.md) (Funding providers). Before any step here,
the control plane must be deployed with a provider-list `HOSTING_MEMBERSHIP_POLICY_JSON`
that already contains the Boosty entry (blog, qualifying level IDs, `boosty-paid-v1`). A
Boosty hint reaching a control plane without that entry is never acknowledged; the
account's pending Boosty hints fill the 8 + 1 per-provider bound and its link calls then fail
with `PT429`.

1. With the creator's credential on an isolated machine, capture and sanitize one response of
   each route (subscribers page, dialog list, message page, token refresh), check them against
   the parsers and add them as fixtures.
2. Confirm the control plane's policy lists Boosty, then set `BOOSTY_MEMBERSHIP_POLICY_JSON`,
   seed the creator credential and enable dispatch.
3. Set `BOOSTY_LINKING_ENABLED`, link a test account end to end and confirm the control plane's
   version 2 Boosty snapshot and the acknowledgement of its hint.

To withdraw Boosty, unset `BOOSTY_LINKING_ENABLED` and disable dispatch first; the control
plane removes its Boosty entry only after no Boosty head or unacknowledged hint remains.
