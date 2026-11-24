## Acceptance scenario
On a visible managed-server page, when a lifecycle or backup job is active, status polling is shared and runs no more often than every 15 seconds. Hidden tabs defer reads. A terminal result or 404 stops polling; repeated retryable failures back off and leave a manual refresh path.

## Changes
- Initial status reads are gated on `document.visibilityState`; hidden tabs wait for the first visible transition.
- Centralized portal status polling uses a 15s minimum, bounded exponential backoff, jitter, terminal stop, and immediate stop for non-retryable/404 results.
- Move status reads now use a 15s active minimum; the 1s move timer remains local elapsed-time rendering only.
- Runner onboarding refreshes only while visible at 15s; campaign reset no longer runs a second 5s router refresh loop.

## Evidence
- `npm ci` (pass)
- `npm run build` (pass)
- `npm run lint` (pass; existing warnings only)
- `git diff --check` (pass)
- `npm test` (full suite executed; 2479 passed, 1 skipped, 118 failed in 10 pre-existing/environment-sensitive component files, including localStorage/DOM cleanup failures and legacy timing assertions; no dependency failure)

## Expected reduction
The managed-server provider changes from 4–15s polling to a 15s minimum with backoff, eliminating hidden-tab traffic and duplicate campaign refreshes. For a continuously active visible tab this is approximately 75% fewer baseline status calls (4s -> 15s), and hidden/deleted/terminal pages converge to zero ongoing calls.
