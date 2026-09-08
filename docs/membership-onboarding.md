# Source-owned account and membership onboarding (not enabled or deployed)

This composes reviewed website histories `93ab60b` (owner onboarding) and
`e8a6648ca64b8ae0e8cbd43d31620eec720b131f` (Patreon identity linking), without the
separate regional administrator PR95. Backend contract: local `4160f7b` and
`docs/managed-hosting/membership-onboarding.md` in the control-plane repository.

## Subscription-benefit policy, not payment settlement

The parent explicitly approved **Patreon-reported current entitlement**, not
proof that the most recent $20 charge settled. Policy v1 requires the exact
configured campaign and qualifying tier IDs, campaign currency USD, the tier's
reported amount at least 2000 cents, member currently-entitled amount at least
2000, `patron_status=active_patron`, `last_charge_status=Paid`, a nonfuture
last-charge timestamp, and explicitly false free-trial/gift flags. All identity,
member/user, member/campaign and entitled-tier/campaign relationships must be
complete and agree. Marketing names, lifetime contributions, email, and metadata
are never membership evidence.

**Intentional unpaid-upgrade case:** Patreon documents currently-entitled tiers
and amount as including a *current pledge OR a payment covering the current
period*. An upgraded tier already reported entitled while the member remains
active/Paid can qualify before an incremental charge. This is subscription-benefit
policy, **not evidence that $20 was captured**. Independent review must examine
this explicit adjustment to the earlier minimum design's settlement language.

Read-only primary source checked: <https://docs.patreon.com/>, APIv2 Identity,
Member attributes/relationships, Tier relationships, Campaign currency and the
v1→v2 migration guide. `last_charge_date` means last **attempted** charge, not a
paid-through deadline. No paid-through date is available in this adapter's
supported response: `paidThroughAt` is always null. We never request or infer
expiry from `next_charge_date`, pledge cadence, lifetime payment or last charge.
Former/cancelled patrons without independent paid-through evidence are
`review_required`; declined evidence is nonqualifying; missing/ambiguous fields,
pending/unknown charge status, free trials/gifts, duplicate resources and incomplete
pagination require review. Unexpected identity response is a failed authorization.
The adapter deliberately refuses incomplete pages rather than following arbitrary
provider-supplied URLs. This is safe denial, not a claim to support every account.

The fixed identity URL requests `identity identity.memberships`, includes
`memberships.campaign,memberships.currently_entitled_tiers.campaign,memberships.user`,
and explicitly requests the member status/charge/entitled amount/free-trial/gift,
campaign currency and tier amount fields. HTTPS destinations are fixed, redirects
refused, response bodies/counts and request deadlines bounded. Provider access and
refresh tokens exist only during callback processing; no tokens/raw bodies are
persisted or logged. Only normalized evidence and its SHA256 digest are retained.
A crash between code exchange and normalized persistence requires fresh OAuth.
There is **no unattended Patreon polling or token refresh**.

Positive evidence lasts at most 24 hours and funds only **new allocation**.
`max(administrativeBase, qualifyingPatreonOne) + administrativeBonus` is the backend
reducer; never add an extra membership slot to an existing administrative base.
Administrative suspension remains authoritative. Adequate independent grants bypass
membership outages/configuration. Expiry/unlink/unknown evidence never Stop, delete,
revoke administrative grants, transfer servers, or start a grace countdown. Existing
owner Start/Stop/saves remain accessible. Beginning a new Patreon check invalidates
old positive evidence immediately, including cancellation or provider outage.

## Same-account flow and recovery

1. Sign in or sign up normally, retaining the intended website account. `/servers`
   inspects current Auth provider identities **before requesting CP allocation**.
   Missing Discord offers **Confirm and connect Discord**; it uses Supabase
   `linkIdentity`, never `signInWithOAuth`, an email match or automatic account merge.
2. A server-held random-token request records initiating UUID, operation UUID, safe
   `/account` or `/servers` continuation and a ten-minute expiry. Its reference is
   in a Secure, HttpOnly, host-only cookie. Supabase owns its own OAuth state/PKCE;
   application code does not replace them. The callback checks the current UUID
   against the server request before exchanging the code and verifies the same UUID
   afterward. Explicit confirmation rechecks current authoritative Discord.
   Supabase may establish the identity during its own OAuth callback after the
   user's initial explicit approval; return confirmation never fabricates identity.
3. Disabled manual linking, cancellation, missing/expired cookie, conflicting
   provider identities, forwarded callback or account change fail into repair.
   Separate pre-existing accounts require support. Never solve them by switching
   to sign-in, guessing identity by email or transferring CP ownership.
4. Patreon launch/state are single-use, hashed and browser-cookie bound. Operation
   UUID, expected generation and server-held continuation travel through state.
   Provider callback GET creates only normalized completion authority; the website
   callback GET puts its token in an HttpOnly cookie and removes it from the URL.
   **Authenticated explicit POST confirmation** commits the link and evidence.
5. One SQL transaction validates initiating UUID, generation and expiry, consumes
   completion authority, updates the globally unique Patreon binding, increments
   revision, writes an immutable receipt and inserts an outbox hint. Lost responses
   retry the same token and recover the committed receipt, even after evidence
   expiry/unlink. Recovery reports the historical operation, not a current positive
   status, and never relinks. A different user cannot consume or recover it.
   Keep the pending completion cookie on uncertain responses. Cancel confirmation
   discards browser authority only; it does not reverse a previously committed link.
6. `/account` shows a server-authenticated current status, never success inferred
   from query parameters. **Refresh status** reads durable state/sync; **Check again**
   initiates new OAuth. `/servers` retains exact-UUID sessionStorage mutation recovery
   ahead of membership prompts, preserves current-session completion fences, and
   separates **owned** cards from **associated** manager/support/admin cards.

Full regions remain selectable for persistent Request, without reservation or ETA.
Create remains stopped; first Start uses the bundled default save. Password controls
remain the documented Discord owner path, not a new web password endpoint.

```mermaid
sequenceDiagram
  actor User
  participant Web as Website server actions / Auth
  participant OAuth as Patreon fixed OAuth v2
  participant SQL as Website private RLS heads/receipts/outbox
  participant Edge as Private membership Edge
  participant CP as CP synchronizer / allocation
  User->>Web: Same-account linkIdentity + explicit confirmation
  Web->>SQL: Initiating UUID / operation / expiry / safe continuation
  User->>OAuth: Explicit identity + identity.memberships authorization
  OAuth->>Web: Ephemeral callback verification
  Web->>SQL: Normalized completion authority (not a link)
  User->>Web: Confirm Patreon completion (POST)
  Web->>SQL: Atomic generation CAS, receipt, evidence, outbox
  CP->>Edge: Dedicated token: changes / snapshot / ack
  Edge->>Web: Exact UUID current Auth admin lookup
  Edge->>SQL: Transactional current-binding fence or tombstone
  Edge-->>CP: Closed normalized snapshot, no tokens
  CP->>CP: Source-isolated allowance, admission CAS, 24h limit
```

## Exact closed contracts and storage ownership

Private endpoint (no browser/CORS authority):
`POST https://wfvqnijwuyqjibhlcrhz.supabase.co/functions/v1/control-plane-membership-v1`.
`Authorization: Bearer <64 lowercase hex>` is a **dedicated** synchronization
credential, not a service-role key. The verifier uses a full fixed-length digest
comparison. Only strict v1 `snapshot({accountId})`, `changes({cursor,limit<=50})`,
and `ack({eventId,receiptId})` envelopes exist. Unknown fields/operations fail.
Every snapshot authoritatively looks up the exact account via Auth admin API;
404 becomes a tombstone, outage fails closed, identities never fall back to metadata.
Patreon is a website-owned binding, not a Supabase provider identity.

`membership.ts` contains the exact private snapshot contract (all keys required,
nullable semantics, decimal strings, provider ID bounds, UTC millisecond times).
It matches CP `membership-contract.ts`. `server-onboarding-contract.ts` parses CP
allocation **version 2**, including source breakdown and freshness, retaining all
six ordered regions. No private provider IDs enter the public account status or
website summary. `membership-onboarding.ts` owns strict authenticated status parsing
and public summary v2 status/next-action composition.

Website migration: `202609080002_membership_onboarding.sql`, **after** backend
`202609080001_control_plane_membership_sources.sql`. No applied migration is edited;
`20260907212654_create_patreon_links.sql` remains byte-identical to merged PR103.
Four new public-schema tables are RLS enabled and client grants denied:
`membership_heads`, `membership_outbox`, `membership_completion_receipts`,
`discord_link_requests`. Heads, receipts and outbox have no cascading Auth FK.
An Auth BEFORE DELETE trigger records a preserved tombstone before legacy OAuth/link
rows cascade. Existing identity-only links migrate as unverified, never paid evidence.
New server RPCs use fixed empty search paths, service-role-only EXECUTE and no
browser grants. Service role has no direct new-table privileges; narrow functions
own writes. Existing private OAuth states gain operation/generation/return/evidence
columns. Do not use legacy handlers with new membership enablement.

Each new explicit verification also advances generation, preventing an older OAuth
completion from overwriting a newer check. Verification-pending state is distinct
from outbox synchronization-pending state. Binding fences hold short SQL locks and invalidate evidence on observed Discord or
Patreon changes. Explicit unlink fences even an in-flight initially-unlinked flow.
A global membership-outbox advisory lock serializes writer commit order so a cursor
cannot skip a lower uncommitted sequence. Pages are bounded ascending hints, not
stale grant payloads. Ack binds the first receipt forever; exact replay succeeds,
changed receipt conflicts. Restart from a null cursor returns remaining pending
hints. Known binding reconciliation is an Auth check, not a Patreon refresh.
No retention/cleanup policy for durable receipts/tombstones is introduced.

## Configuration and rollout blockers

Nothing here provisions credentials, applies SQL, changes Auth/Patreon settings,
deploys Edge/Cloudflare/CP, pushes or merges GitHub. Membership remains disabled
without reviewed configuration. No actual campaign or tier ID was invented.

Required reviewed runtime configuration:

- Existing Edge Patreon client ID/secret, exact HTTPS callback URI and canonical
  `PATREON_SITE_URL`. These remain Edge-only; never put them in Cloudflare/browser.
- Edge `HOSTING_MEMBERSHIP_POLICY_JSON`: strict `campaignId`, unique 1–50
  `qualifyingTierIds`, `currency:"USD"`, `minimumCents:2000`,
  `policyVersion:"patreon-paid-usd20-v1"`. Absent => no membership verification.
- Edge dedicated `HOSTING_MEMBERSHIP_SYNC_TOKEN`; CP receives the same scoped value
  through its separate owner-only encrypted systemd credential, **not** Supabase
  service-role authority. CP also requires its default-off membership enable flag,
  pinned origin and identical policy mapping.
- Website server-only `ACCOUNT_LINK_SITE_URL` = canonical HTTPS origin. No caller
  headers determine the Discord callback destination. Existing public Supabase
  URL/publishable key must be correct at runtime and for browser bundles.
- Supabase manual identity linking enabled, Discord provider enabled, exact
  `/account/discord/callback` allowlisted, registered Discord→Supabase callback
  correct, Patreon scopes and exact callback registered. No live setting changed.

Deployment gates: parent/reviewer approves policy and exact bytes; coordinates the
**complete chronological shared migration union and byte pins in both repositories**;
additive backend migration then application with feature disabled; website migration;
deploy updated Patreon/my-servers/website-account/private Edge functions; provision
scoped credentials and reviewed settings; deploy website; prove real HTTPS
browser→Auth→Edge→CP with controlled accounts, identity switches, outages and replay;
only then explicitly enable membership policy. The dedicated private function alone
uses custom token verification; existing browser JWT functions still validate Auth.
Applications never apply migrations automatically. The historical mirror alone is
not evidence of deployed migration history. No unknown-file/include-all bypass.

## Local evidence versus production proof

Automated provider/API fixtures are synthetic; React/route tests mock Auth and Edge.
Real isolated PostgreSQL tests apply the unchanged populated Patreon baseline and
new migration, exercise RLS, injected rollback, competing completions, expiry,
identity changes, uniqueness, unlink/replay, outbox ack/restart and deletion tombstones.
No test supplies real OAuth membership, a production account, credentials, gameplay,
container commissioning or UDP reachability. Real browser HTTPS integration remains
blocked by reviewed runtime policy, credentials, callback/manual-link settings and
separate deployment authorization. Never disable TLS verification to claim it.

Reproduce: `npm test`, `npm run test:membership:postgres` with only an owned isolated
loopback fixture URL, `npx next typegen && npx tsc --noEmit`, focused changed-file ESLint,
credential-free Next and `WORKERS_CI=1` OpenNext builds. The PostgreSQL suite refuses
non-loopback or non-fixture database names and otherwise explicitly skips without
its fixture URL. Tests do not relax legacy UUID/session recovery or full-region UI.
