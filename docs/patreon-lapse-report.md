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
The private operator email includes the account's email beside its account link,
or `(no email)` when it is unavailable. Both text and HTML include email addresses
in grant reasons. Server names and Patreon IDs stay out; grant-note UUIDs, Discord
IDs, control characters and URLs retain their sanitization. Grant reasons remain operator notes;
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
If the administrator is signed out, both admin pages encode their complete
relative path and query in the login `next` parameter. The sign-in callback
validates it again as a same-origin relative destination. Account `q` and server
`view`/`serverId` survive both a missing session and the CP page's expired-session
fallback; query values cannot select a different origin.

The additive `202611090002_patreon_lapse_report_links.sql` migration exposes
`patreon_lapse_report_inventory_v2()`, with validated UUID identities added to the
same inventory facts. It preserves the existing v1 RPC, classifications, grant
redaction, candidate bounds and service-role-only access. Invalid UUID data fails
the report; it cannot choose a URL. Frozen v1 offline fixtures retain prefix-only
identities, and v2 fixtures keep their contact redaction. Both show `(no email)`.

ControlPlane supplies the existing private tables, but builds no part of the
email. Its repository mirrors historical `patreon_lapse_server_owners()` SQL and
the scheduler migration. That legacy RPC has contact/name columns and omits
deleted rows, so the new links do not use it. The paired ControlPlane PR mirrors
the new SQL and pins its digest in `ALREADY_APPLIED_EXTERNAL_MIGRATIONS` for the
shared Supabase ledger; it adds no runtime schema marker or permission to apply it.

## Operator-only account email

`202611100001_patreon_lapse_report_emails.sql` adds the service-role-only
`patreon_lapse_report_inventory_v3()` RPC. It materializes the unchanged v2
inventory once, resolves its distinct account UUIDs against `auth.users` in one
batch, and returns one `account_email` field per row. The Edge loader awaits one
bounded RPC per report, with no per-line account requests. Existing 1000-row,
overflow, 2 MiB response and timeout limits remain. Empty/blank or missing Auth
emails become null; invalid or oversized addresses fail the report privately.
The lookup includes retained deleted Auth rows; a removed Auth row shows
`(no email)` while preserving any existing account link and deleted-server rules.
The older RPCs and all durable rows remain unchanged.

Only the operator mail body receives the typed email fields. The sender still
uses the explicitly configured private `PATREON_LAPSE_REPORT_RECIPIENTS`, never
an account email, and scheduler authentication still precedes every read. Email
addresses do not enter link URLs, subjects, scheduler responses, logs, audits or
journals. The offline dry-run CLI uses `lapseReportDiagnosticText`: it removes
account contacts and keeps grant-email redaction. Failure logs remain generic,
even if an underlying SMTP/DB error contains a private body. No shared/global
redaction module changes.

Current synthetic examples: [HTML](evidence/patreon-lapse-emails.html) and
[text](evidence/patreon-lapse-emails.txt), from
`tests/fixtures/patreon-lapse-emails-v3.json`. Every address uses `example.test`.

### Email rollout (ORCH owns the slot)

The paired ControlPlane PR mirrors the exact new SQL bytes (SHA-256
`63f84a58c857053baa5c072bae47c733bbc699ce9af2cad7e84ac194142e7b08`)
as required external history. Neither PR authorizes a live operation.
Follow the existing protected-release order below for this new key: merge the
CP catalog entry in ORCH's slot and retain ordinary Deploy's expected refusal;
separately apply only `202611100001_patreon_lapse_report_emails.sql` and record
its normal migration-history row atomically (version `202611100001`, name
`patreon_lapse_report_emails`); verify checksum, v3 definition/ACL and unchanged
v1/v2; commission the CP catalog through its protected release; then deploy only
`patreon-lapse-alert` from the exact reviewed Website merge with pinned CLI
2.120.0 and the existing private configuration. Read back source identity and
ACTIVE/JWT policy. No broad `db push`, old migration replay, recipient change,
manual scheduler invocation or test email is part of these PRs. The v2 Edge
version remains the compatible fallback until v3 deployment is verified.

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

### Ordered production rollout (ORCH owns the slot)

This is a deployment recipe, not authority to execute it. Wait for ORCH's
`MERGE SLOT GRANTED`, serialize the operations, and keep them outside any other
protected release window. The core order is **merge the CP entry, apply and record
the external migration, activate the CP catalog by protected release, then deploy
the report function**. Merge/deploy the Website sign-in fix before the new email
function can send its links.

1. Merge CP #1020 only in ORCH's slot. The push starts the ordinary `Deploy Oracle
   control plane` workflow; it does **not** automatically start a protected
   release or apply SQL. Because #1020 adds a mirrored file under
   `supabase/migrations`, `control-plane-auto-deploy.sh`'s
   `validate_protected_candidate_assets` comparison refuses it before stopping
   services or switching releases. Preserve that expected refusal and the running
   release. Do not bypass the guard. Package/stage the exact merged CP SHA using
   the separately dispatched `Package protected release` workflow and existing
   protected-release procedure; staging alone does not activate the catalog.
2. Merge Website #437 in the serialized slot and wait for its site/hosting
   deployments, so the sign-in fix is available. Confirm the reviewed/merge source
   identity and migration SHA-256
   `e86aa8680c5ba60554252c41061c6a2447cbb3380c3362ad49f6342db33fc633`.
   These workflows do not deploy the report function or apply its SQL.
3. Under separate production database authorization, apply only the reviewed
   `202611090002_patreon_lapse_report_links.sql` through the supported Supabase
   Management SQL endpoint for project `wfvqnijwuyqjibhlcrhz`, with its normal
   history entry in the **same transaction**. The new
   `supabase_migrations.schema_migrations` row must have version `202611090002`,
   name `patreon_lapse_report_links`, and the reviewed statements. Check absence
   first; on an uncertain result reconcile the row and function definitions
   before any retry. Never replay or rewrite an existing row, mint a different
   timestamp, or run a broad Website `db push` across unrelated pending CP SQL.
   Read back the exact v2 definition, STABLE/empty search path/service-role ACL,
   unchanged v1/helper permissions and the history entry before continuing.
   The CP release helper cannot apply this file: its external catalog deliberately
   requires it to be already recorded and excludes it from every apply plan.
4. Activate the exact merged CP source through the separately authorized
   protected release: validate its archive/source and compatible fallback,
   complete the standard writer fence, snapshot/restore proof, service switch,
   exact-SHA health checks and protected deployment receipt. From that source run
   `npm run hosting:control-plane:migrate-supabase-release` in CHECK mode; it must
   accept `202611090002` as external history and exclude it from the private
   pending suffix. This link change does not authorize applying any other private
   migration. Do not count the expected refused ordinary Deploy as activation.
5. From Website's exact reviewed merge, deploy **only** the report function with
   the prior rollout's pinned CLI/API route:

   ```sh
   npx --yes supabase@2.120.0 functions deploy patreon-lapse-alert --project-ref wfvqnijwuyqjibhlcrhz --use-api --no-verify-jwt
   ```

   Read back ACTIVE/version, `verify_jwt=false` and the downloaded transitive
   source graph against that merge before declaring delivery complete. Preserve
   the existing two private recipients, SMTP/creator/scheduler secrets, campaign
   and cron; no secret-setting command is needed for this change. The hosting
   deploy allowlist remains `my-servers`, `control-plane-admin`, `public-servers`.
   Do not manually invoke the report or send a real email without ORCH's separate
   approval. The v1 RPC and old function stay usable until this final switch.

Precedent: [Website #432's verified production receipt](https://github.com/Bannerlord-Coop-Team/BannerlordCoop-website/pull/432#issuecomment-6725009856)
records atomic Management SQL application/history for `202611080001`, followed by
CLI 2.120.0 `--use-api` deployment of only `patreon-lapse-alert`, with JWT policy,
downloaded source graph and private configuration read back. The
[paired CP #989 rollout](https://github.com/Bannerlord-Coop-Team/BannerlordCoop.ControlPlane/pull/989)
explicitly expected the mirrored migration to make ordinary Deploy refuse and
required protected installation of the SQL tree. Those are the same ownership
and deployment boundaries here; no old migration is reapplied.

The v1/v2 RPCs bound the result to 1000 rows and mark overflow explicitly; the consumer
refuses truncation and ambiguous prefixes. Only v3 adds the bounded `auth.users`
contact read described above; no credential columns are read. Usage follows CP's live allocation plus active restoration
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

The dry run reads only the explicitly supplied bounded local JSON and uses the
same classifier with the redacted diagnostic formatter. It does not load live credentials,
contact Patreon/Supabase or send mail. PostgreSQL tests execute the real new RPC
in PGlite, including a read-only transaction, service-role permissions, migration
replay, empty/overflow results, ownership changes and reservation counting, and
assert unchanged durable rows. A loopback HTTP replay exercises the actual RPC
JSON through the real inventory loader for nonempty and empty responses.
These are offline checks, not deployed RPC,
live-provider or SMTP evidence.

The legacy v2 [HTML sample](evidence/patreon-lapse-links.html) and
[plain-text sample](evidence/patreon-lapse-links.txt) are rendered from
`tests/fixtures/patreon-lapse-links-v2.json`: five realistic funding states with
synthetic full UUIDs, two review rows and three context rows. Regenerate them
with the render command above, alongside the current v3 email samples. The sample uses the production link targets but none of
its UUIDs identify real accounts or servers. Rendering makes no network calls.

Acceptance: an administrator opens the daily funding email and clicks a live
server prefix or account prefix. The browser opens that exact server detail or
the member list filtered by the exact account UUID, after normal admin sign-in.
Text-only readers receive the same complete URLs. Deleted server rows retain
their account link without advertising an unavailable server detail page.
Both alternatives show the account's resolved email or `(no email)` beside that
link, and grant reasons retain their email addresses only in this operator mail.
