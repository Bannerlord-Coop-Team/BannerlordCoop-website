# Daily subscription funding report

`patreon-lapse-alert` is the existing daily, scheduler-secret-authenticated operator
report. It retains the active USD20 Patreon criterion and shared operator mail
settings. It never changes a grant, grace, server, job or deletion decision.
Grant notes such as “Trial 1 day” and “3 mo” remain notes without an inferred expiry.

Manual-review rows appear first, followed by context:

| Class | Meaning |
| --- | --- |
| `untracked/grandfathered` | No current-owner funding record and independent quota does not cover usage. Review the exact identity before any separate backfill decision. |
| `review_required` | A tracked allocation has no active grace or covering grant. Review membership evidence; this label supplies no removal authority. |
| `in grace` | Shows the existing deletion due time. Future deadlines are context; a passed deadline needs worker-evidence review without assuming deletion is safe. |
| `grant-backed` | Independent base/bonus covers live usage plus active restoration reservations. Shows the last grant/quota audit reason and date, with explicit historical fallbacks when not retained. |
| `deleted` | Deletions recorded within the past 24 hours appear as resolved context; older deleted rows leave the daily report. |

Deleted state takes precedence, then covering quota, then active grace. Funding
left by a prior owner never follows a transfer. Named exceptions show their real
existing grace until an administrator makes a separate, audited exception decision.

Messages use server/account prefixes and omit owner emails, server names, full
IDs and Patreon IDs. Grant-note addresses, UUIDs, Discord IDs, control characters
and URLs are redacted before formatting. Grant reasons remain operator notes;
never copy unsanitized notes into public evidence. Read/parse failures send no
partial report and log no provider response or owner data.

## Rollout

This restores the deployed report's source, which was absent from website main.
The additive service-role-only `patreon_lapse_report_inventory()` RPC reads existing
private CP state. The preceding function can keep using the untouched
`patreon_lapse_server_owners()` RPC. There is no change to CP HTTP/IPC, membership
producer payloads or grant/grace writers; the report RPC and Edge consumer are both
Website-owned.

Apply `202611080001_patreon_lapse_report_inventory.sql` through the separately
authorized migration path before deploying the reviewed `patreon-lapse-alert`.
Preserve its scheduler secret, creator credential, mail password, campaign and
daily cron. This PR does not invoke, schedule, deploy or send the live report.
Alert functions and migrations remain outside automated hosting API deployment.

The RPC bounds the result to 1000 rows and marks overflow explicitly; the consumer
refuses truncation and ambiguous prefixes. It does not read `auth.users`, account
emails or credentials. Usage follows CP's live allocation plus active restoration
reservation calculation, pinned in the SQL tests to
`33a693c01471b3ebd10b8e8afc945b0292f089e2`.

## Verification and offline dry run

```sh
npm run test:patreon-lapse
npm run dry-run:patreon-lapse -- --input tests/fixtures/patreon-lapse-report-v1.json
npm run replay:patreon-lapse
npm run test:supabase:deployment
```

The versioned fixture preserves the November 8 report's 16 candidate prefixes and
later read-only audit state. Provenance pins the snapshot and both baseline heads.
Provider IDs are synthetic and personal grant-note content is redacted. The result
is seven grants, six graces, one membership review, one untracked allocation and
one already-deleted row. Two rows need immediate manual review; all 16 remain visible.
The deletion occurred after the original daily report.

`replay:patreon-lapse` compares the actual captured deployed version 6 classifier
with the new report using those same 16 candidates, prints both with prefixes
only, and asserts that no candidate disappears. CI retains that before/after
transcript. The original classifier fragment is a historical test fixture, not a
runtime fallback.

The dry run reads only the explicitly supplied bounded local JSON and prints the
same classifier/formatter used by the handler. It does not load live credentials,
contact Patreon/Supabase or send mail. PostgreSQL tests execute the real new RPC
in PGlite, including a read-only transaction, service-role permissions, migration
replay, empty/overflow results, ownership changes and reservation counting, and
assert unchanged durable rows. A loopback HTTP replay exercises the actual RPC
JSON through the real inventory loader for nonempty and empty responses.
These are offline checks, not deployed RPC,
live-provider or SMTP evidence.
