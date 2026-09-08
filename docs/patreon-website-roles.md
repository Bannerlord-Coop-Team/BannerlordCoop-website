# Patreon Standard Server membership benefit

Link a Patreon account from the website's Account page. A current, paid
membership in the configured **Mega Supporter** tier grants the existing
**Standard Server** role to that linked Supabase user. Tier `28995946` was
confirmed in the Patreon tier editor as $20/month on September 7, 2026; verify
its campaign with the creator API before activation. IDs are deployment
configuration, not hardcoded authorization.

This builds on [Patreon account linking](patreon-account-linking.md). The role
worker uses `public.patreon_accounts.patreon_user_id`; emails can differ and
email matches, display names and editable user metadata cannot establish a
link. Each Patreon identity can belong to only one website account. Existing
OAuth client credentials and the identity-only linking flow are reused. The
worker reads campaign memberships with a creator token; individual users'
OAuth tokens are still discarded.

## Membership and manual roles

- A currently entitled configured tier and a successful charge qualify. Gifted
  memberships qualify; free trials do not. Declined, refunded, fraudulent and
  deleted charges do not qualify. Missing or unknown billing information is
  retried without changing a role.
- Cancelling while the paid period remains entitled keeps the role. Losing the
  tier revokes only this integration's grant. Signing out of the site does not
  unlink an account or revoke membership.
- Only an unset role or `User` is promoted. Admin, Premium Server, Server Manager,
  Developer, Helper, manually granted Standard Server and unknown roles remain
  unchanged. Deleted, unconfirmed or currently banned website accounts do not
  receive a grant.
- Each grant has a marker in protected Auth `app_metadata`. Saving a role in the
  administrator UI clears that marker, including when saving Standard Server
  again. A later cancellation preserves that manual grant. Manually setting
  `User` while membership is eligible is not a permanent exclusion: the next
  successful refresh can grant Standard Server again.
- Console owner/operator edits use `set_live_console_assignment`, a separate
  service-role-only RPC that locks the Auth row and changes only the requested
  server assignment in current metadata. These edits never send a cached role
  or grant marker back to Auth, so a console save cannot restore a revoked
  Patreon grant or erase a newer grant. Deploy these writers before enabling sync.
- Changing/deleting an OAuth link immediately withdraws the old integration
  grant in the same database transaction. New links schedule verification;
  cached membership records do not transfer a grant to another account.
- This changes website roles only. It does not allocate or delete servers,
  change control-plane quotas, send Patreon messages, or export saves. Existing
  server ownership and lifecycle rules continue to apply after role revocation.

## Worker and persistence

`patreon-roles` is one Supabase Edge Function with two authenticated modes:

1. Patreon POSTs a V2 member webhook. The handler checks the HMAC-MD5 signature
   against the exact raw body and checks the configured campaign. It durably
   queues a member ID and returns 202; webhook payloads never set roles directly.
2. Linking an account queues its known memberships at higher priority. If the
   identity has not been discovered, linking starts a fresh, fenced scan.
3. Database triggers call the private `patreon_roles.dispatch()` function after
   queue changes. It enqueues an authenticated `pg_net` HTTP request in the same
   transaction. HTTP delivery starts **after commit**, so the worker sees the
   committed link and queue. There is no wait for a cron tick on the normal path.
4. The worker acquires one durable two-minute lease and reads at most 20 due
   memberships from the fixed Patreon V2 API origin. Account-link work comes
   first, followed by webhook events and periodic recovery. Role projection
   rechecks the current link and locks the Auth row. Lease tokens and member
   generations fence stale results. Releasing the lease wakes any remaining work.

A two-minute dispatch lease coalesces duplicate events and expires if an HTTP
request is lost. At most three worker batches may start in a rolling minute,
each limited to 20 member reads and one discovery request. Events received while
a worker runs remain queued; release dispatches
another batch. Work deferred by the request budget remains durable.

The recovery cron runs a **local database check every five minutes**, calling
`patreon_roles.dispatch()`. It sends **no HTTP request when nothing is due**. It
recovers lost wakeups, expired worker leases and failed jobs without restoring
1,440 unconditional Edge Function calls per day. Failed work becomes eligible
for retry after five minutes; recovery cadence, backlog and upstream outages can
add delay. Linking normally starts verification within seconds, but it is not a
synchronous guarantee that the role exists before the account-page redirect.

Only linked identities receive a periodic membership recheck, every six hours,
to recover from missed Patreon events. Successfully checked unlinked members
have `due_at = infinity`; they wake again when linked or when a webhook arrives.
Discovery runs initially and every six hours. It reads identity mappings in pages
of 100, fetching individual membership/billing records only for linked identities
or explicitly queued events. With 299 known, unlinked members and no events, a
quiet day needs roughly 12 worker invocations for four three-page discovery scans,
rather than 1,440 timer invocations and repeated individual membership reads.
During upgrade, all existing deadlines remain intact, including periodic refreshes,
queued events and unfinished claims. Each member adopts the new schedule only
after its next successful reconciliation, so legacy work may add initial calls.

Discovery persists the V2 `meta.pagination.cursors.next` cursor. Legacy next links
must match the fixed campaign URL and agree with metadata. Scans are capped at
1,000 pages and 100,000 memberships. Unknown-account linking restarts the cursor
with a new generation, preventing an in-flight page from losing that request.
A partial scan never revokes an unseen membership.

HTTP errors, invalid responses, token expiry and timeouts preserve prior grants
and record a retry. This means access can outlast membership during an upstream
outage; alert on overdue verification rather than treating missing evidence as
cancellation. A persistent 404 needs investigation. The worker stops upstream
requests on the first membership failure to avoid amplifying throttling.

The private `patreon_roles` schema has RLS and no browser access. Its sole public
RPC is executable only by `service_role`. Durable intent, membership snapshots,
role projection and audit updates are transactional. A trigger on the existing
account-link table serializes link changes with worker commits. No control-plane
schema, provider, runner or object-storage access is involved.

## Activation

Source changes do not deploy, set secrets, register a webhook or activate event dispatch.
The existing `PATREON_CLIENT_ID`, `PATREON_CLIENT_SECRET`, `PATREON_REDIRECT_URI`
and `PATREON_SITE_URL` configure identity linking. They are not campaign API
access tokens and are not sufficient for unattended membership refresh.

1. Reuse the existing Patreon **V2** client for the owning campaign. Obtain a
   creator access token with `campaigns` and `campaigns.members` access from the
   campaign owner. Member email/address scopes are unnecessary. Use
   `w:campaigns.webhook` only if registering webhooks through the API. Do not
   register a duplicate client or change ordinary users' identity-only scope.
   Confirm the campaign/tier IDs and real paid, cancelled-but-entitled, expired,
   gifted and trial response shapes in staging.
2. Review and apply `20260907220000_patreon_website_roles.sql` **after** the existing
   `20260907212654_create_patreon_links.sql`. The new migration adds private
   state, the RPC and the link-change trigger; it leaves existing links and
   manual roles intact and makes no grants at installation. Review shared
   Supabase migration history and the CLI dry run before applying migrations;
   do not bulk-push unrelated repository history. Then apply
   `20260907230000_atomic_live_console_assignments.sql` before deploying the
   website; it adds the service-only console assignment RPC without changing
   existing account metadata. Console writes fail closed if this RPC is missing.
   Then apply `20260908030000_patreon_event_reconciliation.sql`. It leaves dispatch
   disabled until explicitly activated and preserves all legacy deadlines, queued
   work and role ownership. The next successful reconciliation adopts the new
   schedule. No applied migration is rewritten.
   Old workers can still submit the previous discovery format during rollout.
3. Set these additional Edge Function secrets using the Dashboard or an
   owner-only environment file, never command arguments or frontend variables:

   ```text
   PATREON_CAMPAIGN_ID=<verified campaign ID>
   PATREON_STANDARD_TIER_ID=28995946
   PATREON_CREATOR_ACCESS_TOKEN=<creator token>
   PATREON_WEBHOOK_SECRET=<secret of the exact webhook registration>
   PATREON_SYNC_SECRET=<independent random scheduler secret>
   ```

   Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. All values
   must be present before the function starts. The first authenticated RPC pins
   campaign and tier durably; changing them requires an explicit migration.
4. Deploy the website administrator change (which clears grant ownership on a
   manual edit) and the atomic console assignment writers before enabling role
   sync. Deploy `patreon-roles` using its
   `verify_jwt = false` configuration; its signature/scheduler authentication
   replaces gateway JWT checks. Register `members:create`, `members:update`,
   `members:delete`, `members:pledge:create`, `members:pledge:update` and
   `members:pledge:delete` on the existing client, targeting
   `https://<project-ref>.supabase.co/functions/v1/patreon-roles`. Reuse the exact
   webhook registration on subsequent deployments.
5. Enable `pg_cron`, `pg_net` and Supabase Vault as needed. Store the canonical
   `https://<20-letter-project-ref>.supabase.co/functions/v1/patreon-roles` URL as
   `patreon_roles_function_url` and the same independent `PATREON_SYNC_SECRET`
   value as `patreon_roles_sync_secret`. Custom domains, query strings and other
   destinations are rejected. The private dispatcher and its activation flag are
   operator-only; browser roles and `service_role` cannot invoke/configure it
   directly. Database triggers execute with their protected owner privileges.

   After deploying and validating the worker, replace the existing named cron
   job's unconditional HTTP command with the conditional dispatcher, and enable
   dispatch in the **same transaction**. Do not create a second scheduler. For a
   new installation, first make one authenticated worker call to pin the verified
   campaign and tier, then run this as the database operator:

   ```sql
   begin;
   select cron.schedule('patreon-website-roles', '*/5 * * * *',
     'select patreon_roles.dispatch();');
   update patreon_roles.sync_state set dispatch_enabled = true where singleton;
   select patreon_roles.dispatch();
   commit;
   ```

   Keep the named job active. Validate the returned `dispatch_request_id` against
   `net._http_response`, trigger a controlled link and signed real-member event,
   then prove that an idle dispatcher call returns null without an HTTP enqueue.
   A failed dispatch records only `dispatch_unavailable`; it never rolls back a
   successful OAuth link or logs Vault values. Correct configuration, then call
   the same dispatcher to retry.

6. With an authorized staging member, verify link → paid role grant → paid-through
   cancellation → expiry revocation, duplicate webhooks, relinking and a manual
   override. Confirm Supabase `auth.getUser()` and the rendered website role
   after session refresh; existing JWT claims last until refresh/expiry.

## Operations and rollback

Monitor scheduler failures, `dispatch_error`, expired `dispatch_until` without
worker progress, overdue finite `due_at`, linked-member `observed_at`,
`last_error` counts, discovery progress and lease expiry. Ignore `due_at = infinity`
for unlinked identities and distinguish `account_unmatched` from upstream failures.
Check aggregates without printing
membership rows, Auth metadata, tokens or Vault values. Inspect audit events to
separate integration grants/revocations from manual overrides.

The creator token is provisioned as a function secret. This version does not
persist a creator refresh token or implement token rotation. Rotate an expired
or revoked access token through secret management and verify refresh resumes.
Never reinterpret authentication errors as membership cancellation.

To disable sync, first set `dispatch_enabled = false` as the database operator,
then pause the one recovery scheduler and dedicated webhook/function entrypoint.
Disabling only cron no longer stops event-driven dispatch. Allow an existing
worker/HTTP request to finish before declaring it stopped. Leave
private tables, the link-change trigger and audit trail intact: relinking must
still withdraw a former integration grant. Existing membership grants otherwise
remain unchanged. Do not drop the schema or bulk-reset user roles as rollback;
removing outstanding grants requires checking each current ownership marker.

## Validation

`npm test` includes handler tests and PGlite integration tests applying the actual
account-linking migration before the new migrations. Coverage includes signature
verification, entitlement decisions, private-state permissions, upgrades with
existing links, manual grants, console edits after revocation and before/after
new grants, console RPC permissions and rollback, duplicate delivery, lease
recovery, pagination, relinking and stale-response rejection. Event tests include
link-to-grant without a cron tick, signed event wakeups, transactional rollback,
coalescing, priority, rolling request limits, continuation after an in-flight event,
unknown-link discovery, idle recovery, and private dispatcher permissions. PGlite
upgrade cases preserve deadlines for aged observations with queued linked/unlinked
events, active/abandoned worker claims and newly linked identities, then verify
the new schedule and role projection after successful reconciliation. PGlite
uses a transactional `pg_net` stub; it cannot prove the live extension's delivery
or concurrent PostgreSQL scheduling. Mocked upstream responses and PGlite do
not prove real Patreon billing behavior, PostgreSQL lock scheduling or production
deployment. Complete the staging checks above before activation.

References: [Patreon V2 API](https://docs.patreon.com/),
[Patreon cancellation](https://support.patreon.com/hc/en-us/articles/4407273239693-What-happens-when-I-cancel),
[Supabase function schedules](https://supabase.com/docs/guides/functions/schedule-functions),
[Supabase pg_net transaction semantics](https://supabase.com/docs/guides/database/extensions/pg_net).
