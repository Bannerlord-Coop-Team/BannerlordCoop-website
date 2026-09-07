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
2. A scheduler POSTs with `X-Patreon-Sync-Key`. The worker acquires one durable
   two-minute lease and reads at most 20 due memberships from the fixed Patreon
   V2 API origin. Role projection rechecks the current account link and locks
   the Auth user row. Lease tokens and member generations fence stale results.

Known members refresh every 15 minutes; unfinished/failed work retries after
five minutes. Discovery runs initially and every six hours, and a new link
requests a scan. It processes one page per invocation and persists the V2
`meta.pagination.cursors.next` cursor. Legacy next links are validated against
the fixed campaign URL and must agree if both cursor forms are provided.
Scans are capped at 1,000 pages and 100,000 membership records. Target intervals
may increase with queue size or API outages. Missing a member in a partial scan
never revokes its role.

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

This PR does not deploy, set secrets, register a webhook or schedule the worker.
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
   do not bulk-push unrelated repository history.
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
   manual edit) before enabling role sync. Deploy `patreon-roles` using its
   `verify_jwt = false` configuration; its signature/scheduler authentication
   replaces gateway JWT checks. Register `members:create`, `members:update`,
   `members:delete`, `members:pledge:create`, `members:pledge:update` and
   `members:pledge:delete` on the existing client, targeting
   `https://<project-ref>.supabase.co/functions/v1/patreon-roles`. Reuse the exact
   webhook registration on subsequent deployments.
5. Enable `pg_cron` and `pg_net` as needed. Store the function URL in Supabase
   Vault as `patreon_roles_function_url` and the same scheduler secret as
   `patreon_roles_sync_secret`. Create/update the single named job:

   ```sql
   select cron.schedule('patreon-website-roles', '* * * * *', $job$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets
               where name = 'patreon_roles_function_url'),
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Patreon-Sync-Key', (select decrypted_secret from vault.decrypted_secrets
                               where name = 'patreon_roles_sync_secret')
       ),
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     );
   $job$);
   ```

6. With an authorized staging member, verify link → paid role grant → paid-through
   cancellation → expiry revocation, duplicate webhooks, relinking and a manual
   override. Confirm Supabase `auth.getUser()` and the rendered website role
   after session refresh; existing JWT claims last until refresh/expiry.

## Operations and rollback

Monitor scheduler failures, overdue `due_at`, old `observed_at`, `last_error`
counts, discovery progress and lease expiry. Check aggregates without printing
membership rows, Auth metadata, tokens or Vault values. Inspect audit events to
separate integration grants/revocations from manual overrides.

The creator token is provisioned as a function secret. This version does not
persist a creator refresh token or implement token rotation. Rotate an expired
or revoked access token through secret management and verify refresh resumes.
Never reinterpret authentication errors as membership cancellation.

To disable sync, stop the one scheduler and webhook/function entrypoint. Leave
private tables, the link-change trigger and audit trail intact: relinking must
still withdraw a former integration grant. Existing membership grants otherwise
remain unchanged. Do not drop the schema or bulk-reset user roles as rollback;
removing outstanding grants requires checking each current ownership marker.

## Validation

`npm test` includes handler tests and PGlite integration tests applying the actual
account-linking migration before the new migration. Coverage includes signature
verification, entitlement decisions, private-state permissions, upgrades with
existing links, manual grants, duplicate delivery, lease recovery, pagination,
relinking and stale-response rejection. Mocked upstream responses and PGlite do
not prove real Patreon billing behavior, PostgreSQL lock scheduling or production
deployment. Complete the staging checks above before activation.

References: [Patreon V2 API](https://docs.patreon.com/),
[Patreon cancellation](https://support.patreon.com/hc/en-us/articles/4407273239693-What-happens-when-I-cancel),
[Supabase function schedules](https://supabase.com/docs/guides/functions/schedule-functions).
