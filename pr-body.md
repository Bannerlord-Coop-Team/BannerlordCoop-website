## Acceptance scenario
On a visible managed-server page, when a lifecycle or backup job is active, status polling is shared and runs no more often than every 15 seconds. Hidden tabs defer reads. A terminal result or repeated failed/404 read stops polling and leaves a manual refresh path.

## Changes
- Centralized portal status polling now uses a 15s minimum, bounded exponential backoff, and jitter; terminal fingerprints stop the session and repeated failures time out.
- Runner onboarding refreshes only while visible at 15s; campaign reset no longer runs a second 5s router refresh loop.
- Move status 1s timer is local elapsed-time rendering only; its network read is scheduled separately and is not a 1s network poll.

## Evidence
- `npm run lint` (pass; existing warnings only)
- `npm run build` (pass)
- `git diff --check` (pass)
- `npm test ...` could not run before dependency install; focused polling policy tests are included.

## Expected reduction
The managed-server provider changes from 4–15s polling to a 15s minimum with backoff, eliminating hidden-tab traffic and duplicate campaign refreshes. For a continuously active visible tab this is approximately 75% fewer baseline status calls (4s -> 15s), and hidden/deleted/terminal pages converge to zero ongoing calls.
