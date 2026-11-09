# Daily subscription funding report

`patreon-lapse-alert` is the existing daily, scheduler-secret-authenticated operator
report. It retains the active USD20 Patreon criterion and site SMTP settings.
It never changes a grant, grace, server, job or deletion decision.
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

Messages use server/account prefixes as labels and full UUIDs only in admin links.
They omit owner emails, server names and Patreon IDs. Grant-note addresses, UUIDs, Discord IDs, control characters
and URLs are redacted before formatting. Grant reasons remain operator notes;
never copy unsanitized notes into public evidence. Read/parse failures send no
partial report and log no provider response or owner data.

## Direct administrator links

The report is classified and rendered by Website's
`supabase/functions/_shared/patreon-lapse-alert.ts`, then sent by the existing
`patreon-lapse-alert/index.ts` SMTP path. It now has a UTF-8 HTML part and a
plain-text alternative containing the same absolute URLs. Other site mail keeps
its existing text-only encoding unless it supplies an HTML part.

The committed origin is `https://bannerlordcoop.com`. Validated full UUIDs choose
only these existing Website routes:

- Server: `/admin/control-plane?view=server&serverId=<server UUID>` (server detail).
- Account: `/admin?q=<account UUID>` (the existing member administration search
  includes `member.id`; there is no separate user detail route).

The URL never contains an email, name, provider identity, grant note or an
inventory-supplied origin. UUIDs must match their displayed 8-character prefixes.
Every dynamic HTML value and link attribute is escaped. A missing account shows
`account none` without a link. Deleted/tombstoned server detail is unavailable;
its server prefix stays unlinked, while its account link remains available.
The v2 RPC returns a null `server_id` for an `operation_state = 'deleted'`
tombstone, including one without a deletion timestamp; null is never a URL.
Following a link still requires the Website's existing administrator sign-in.

The new, additive `202611090002_patreon_lapse_report_links.sql` migration exposes
`patreon_lapse_report_inventory_v2()`, with validated UUID identities added to the
same inventory facts. It preserves the existing v1 RPC, classifications, grant
redaction, candidate bounds and service-role-only access. Invalid UUID data fails
the report; it cannot choose a URL. The live loader requires v2; frozen v1 offline
fixtures retain their original prefix-only rendering.

ControlPlane supplies the existing private tables, but builds no part of the
email. Its repository mirrors historical `patreon_lapse_server_owners()` SQL and
the scheduler migration. That legacy RPC has contact/name columns and omits
deleted rows, so the new links do not use it. The paired ControlPlane PR mirrors
the new SQL and pins its digest in `ALREADY_APPLIED_EXTERNAL_MIGRATIONS` for the
shared Supabase ledger; it adds no runtime schema marker or permission to apply it.

## Rollout

This restores the deployed report's source, which was absent from website main.
The additive service-role-only `patreon_lapse_report_inventory()` RPC reads existing
private CP state. The preceding function can keep using the untouched
`patreon_lapse_server_owners()` RPC. There is no change to CP HTTP/IPC, membership
producer payloads or grant/grace writers; the report RPC and Edge consumer are both
Website-owned.

Apply `202611080001_patreon_lapse_report_inventory.sql` through the separately
authorized migration path before deploying the reviewed `patreon-lapse-alert`.
A private execute-denied helper reads primary audit history on the current
production schema, and uses the canonical retained read view once CP's archive
migration is separately commissioned. Moving an audit to retained facts then
preserves its report context. This does not require installing that CP migration
as part of the report rollout. Both read paths are fixed SQL; owner data never
chooses a query or relation.
Grant history is read once for the report and reused across owners; a report with
no independent quota skips that batch. Membership-only owners do not each scan
their entire audit history.

Before deployment, provision `PATREON_LAPSE_REPORT_RECIPIENTS` with the existing
report's exact operator addresses as a private comma-separated value (1–20 valid
addresses). The deployed report has two recipients; the website's current shared
region-alert list has one, so this report deliberately does not inherit it. Copy
the existing set through the approved private configuration path; do not paste it
into source, logs or PRs. Missing/invalid recipients refuse boot instead of
silently dropping an operator. No recipient configuration was changed in this PR.

Preserve the scheduler secret, creator credential, mail password, campaign and
daily cron. These source changes do not invoke, schedule, deploy or send the live report.
Alert functions and migrations remain outside automated hosting API deployment.

For the link rollout, ORCH must coordinate the paired CP catalog change and the
separately authorized migration outside a protected window. The CP catalog treats
this external key as required already-applied history and refuses to apply it;
do not activate that catalog before the external migration is recorded. Install
the new signature before deploying the Edge caller. The old signature remains
available throughout. Merging Website also deploys the site and affected hosting
functions; wait for ORCH's `MERGE SLOT GRANTED`. The hosting workflow does **not**
deploy `patreon-lapse-alert` (its allowlist is `my-servers`, `control-plane-admin`
and `public-servers`), so the report itself needs a separately coordinated Edge
deployment after its migration. Preserve the private recipient set and all secrets.

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
npm run render:patreon-lapse
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

The IDs-only [HTML sample](evidence/patreon-lapse-links.html) and
[plain-text sample](evidence/patreon-lapse-links.txt) are rendered from
`tests/fixtures/patreon-lapse-links-v2.json`: five realistic funding states with
synthetic full UUIDs, two review rows and three context rows. Regenerate them
with the command above. The sample uses the production link targets but none of
its UUIDs identify real accounts or servers. Rendering makes no network calls.

Acceptance: an administrator opens the daily funding email and clicks a live
server prefix or account prefix. The browser opens that exact server detail or
the member list filtered by the exact account UUID, after normal admin sign-in.
Text-only readers receive the same complete URLs. Deleted server rows retain
their account link without advertising an unavailable server detail page.
