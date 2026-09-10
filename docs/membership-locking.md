# Website membership locking, delivery, and retry

## Current concurrency model

`20260910200000_membership_receipt_claims.sql` replaces the subsystem-wide
commit-order advisory lock with receipt-driven outbox delivery. The retained
`membership_lock()` function is an intentional no-op during rolling upgrade so
already-deployed functions remain callable; it must not be restored as a global
serialization point.

The narrower integrity fences remain:

- membership mutations take the account advisory transaction lock;
- Auth projection and deletion conflicts use bounded row locks;
- visible Patreon tuples and the role-worker singleton use `NOWAIT` where they
  can form a lock-order cycle;
- invisible unique/FK waits retain the function-local lock budget; and
- claim rows use `FOR UPDATE SKIP LOCKED`, so unrelated accounts and consumers
  can progress without a PostgreSQL error.

SQLSTATE `55P03` still means a participating mutation could not safely acquire a
required account, Auth, Patreon, or singleton fence. It rolls back that whole
statement. Removing the global lock does not permit skipping a projection,
weakening uniqueness, rewriting history, or treating a refused mutation as
success.

## Receipt/lease outbox delivery

Outbox `sequence` is a stable scheduling hint, not an exclusion cursor. The v2
private protocol is:

1. The Control Plane creates a random `claimId` and requests at most 50 events.
2. PostgreSQL leases currently unclaimed or expired, unacknowledged rows for 45
   seconds with `FOR UPDATE SKIP LOCKED`.
3. Replaying the same claim after response loss returns the same unacknowledged
   rows and original lease deadline.
4. The Control Plane applies each authoritative snapshot and commits its local
   immutable receipt before ACK.
5. ACK requires the matching live claim, binds the first remote receipt forever,
   releases the claim, and repairs the newest-head notification atomically.

A consumer crash therefore delays a claimed row only until lease expiry. A lower
sequence that commits after a higher sequence was claimed remains unacknowledged
and will be claimed later; no cursor can hide it. Active claims cannot be stolen
by the legacy v1 ACK. The v1 changes/ACK functions remain server-only rollback
compatibility and scan unacknowledged rows without cursor exclusion.

Claims are scheduling ownership only. They do not grant membership authority,
extend OAuth authority, or permit the Control Plane to trust event payloads. The
Control Plane still fetches the exact current Auth-bound snapshot and preserves
its own source CAS and immutable receipt.

## Browser status and duplicate requests

`membership_status` first compares the current Auth/Patreon identities with the
durable head. A matching account is a read-only fast path: it does not acquire an
account or global advisory lock and does not emit another hint. Only actual drift
enters `membership_fence` under the account lock.

The Account and Servers server routes share an identical in-flight
`website-account` status request within one server isolate. The key contains the
account ID and a SHA-256 digest of the access token; neither the token nor a
settled result is cached. Navigation links to these dynamic routes disable
prefetch so browser navigation does not manufacture duplicate status traffic.

## Closed backpressure

Normal try-lock refusal is returned inside the private SQL protocol as the exact
typed value `{ "version": 1|2, "retry": true }`. Edge code retries only this
typed response or exact PostgREST SQLSTATE `55P03`, with the same operation,
claim, event, and receipt IDs, a short jitter, three total attempts, and a fixed
overall deadline. Exhaustion becomes sanitized HTTP 503
`{ "error": "membership_retry" }`.

The Control Plane likewise retries only that exact HTTP contract. Other 4xx/5xx,
malformed/oversized bodies, identity mismatches, redirects, and configuration
errors fail closed without exposing database or provider details. There is no
`Retry-After`, stale-success response, new operation ID, or indefinite retry.

## Evidence and rollout boundary

The ordinary test suite covers Edge validation, stable retry identities, and
in-flight request coalescing. The owned loopback PostgreSQL suites additionally
cover late lower-sequence commits, exclusive/replayed/expired claims, status
fast-path behavior, account/Auth/Patreon/singleton contention, whole-statement
rollback, and explicit retry. The GoTrue fixture uses the account lock to verify
actual admin-deletion rollback; the removed global lock is not part of that
proof.

These source changes do not apply SQL, deploy Edge/Website/Control Plane code,
enable membership, change secrets, or prove production behavior. Rollout must
apply the append-only migration before switching the Control Plane consumer to
v2, while the legacy functions remain available for rollback.
