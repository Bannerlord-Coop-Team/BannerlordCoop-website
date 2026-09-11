# Patreon account linking

This links Patreon to an existing Supabase account, with authenticated
completion after Patreon consent and ephemeral `identity identity.memberships` verification. Tokens
are never retained. See [membership onboarding](membership-onboarding.md) for the
current policy, atomic completion, private synchronization contract, settings,
migration/cutover order and enablement blockers. This is not unattended polling
or proof of settled funds. The original identity-only SQL migration remains immutable.

The independent [website role worker](patreon-website-roles.md) uses a distinct creator token and policy to manage Standard Server roles; those roles never authorize control-plane membership grants.

## Production setup

1. Follow the coordinated migration/cutover order in the membership document.
   The original `supabase/migrations/20260907212654_create_patreon_links.sql` belongs to the intended
   Supabase project. If using the CLI, verify the linked project and review
   `supabase db push --dry-run` before `supabase db push` (which applies all pending
   migrations, not just this one).
2. In **Supabase Dashboard → Edge Functions → Secrets**, set:

   ```env
   PATREON_CLIENT_ID=<Patreon app client ID>
   PATREON_CLIENT_SECRET=<Patreon app client secret>
   PATREON_REDIRECT_URI=https://<project-ref>.supabase.co/functions/v1/patreon-callback
   PATREON_SITE_URL=https://<your-production-website-domain>
   ```

   `PATREON_SITE_URL` is the canonical website origin, without a path. Both URLs
   must use HTTPS. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided
   automatically by hosted Supabase Edge Functions. Never expose the service role
   key or Patreon secret in frontend environment variables.
3. Register the exact `PATREON_REDIRECT_URI` in your Patreon app's redirect URLs.
4. Deploy updated Patreon functions plus `website-account`, `my-servers` and the
   dedicated private `control-plane-membership-v1` function per the membership
   rollout gates. The original Patreon functions are:

   ```sh
   supabase functions deploy patreon-start --project-ref <project-ref>
   supabase functions deploy patreon-callback --project-ref <project-ref>
   supabase functions deploy patreon-complete --project-ref <project-ref>
   ```

   `supabase/config.toml` sets `verify_jwt = false` for these functions. Start and
   complete independently validate bearer tokens using Supabase Auth; the callback
   validates single-use state and a browser cookie. If deploying through another
   method, use the same gateway JWT settings.
5. Deploy the website changes. Cloudflare needs **no Patreon client secret**.
   The existing `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must point at this same project.
   The site needs its existing Next.js server runtime: Server Actions and the
   `/account/patreon/callback` route are not supported by a static-only Pages export.

Use separate Supabase/Patreon applications and an HTTPS website for staging.
Don't point production `PATREON_SITE_URL` at arbitrary preview domains.

## Website build versus runtime configuration

`/account` is request-rendered, so production builds do not need
`NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to prerender
it. Both values are still required by the deployed server for authentication;
missing runtime configuration fails closed. Configure the real public values at
build time as well for browser authentication, since Next.js inlines
`NEXT_PUBLIC_*` values into client bundles. A successful build without these
values is not proof that deployed sign-in works. Never use placeholder keys to
make CI pass.

## Flow and security

The current complete flow is documented in [membership onboarding](membership-onboarding.md).
Launch/state remain one-use and browser-cookie bound; operation UUID, initiating
UUID, expected generation and safe return path are server-held. The anonymous
provider callback creates normalized completion authority only. It never commits a
forwarded initiation ticket. The website callback checks current authenticated
`getUser`/`getSession` agreement, then immediately invokes `patreon-complete` with
that session's bearer token. Edge validates it through Auth; SQL requires that the
completion authority belongs to that exact account and its generation is current.
No client hydration, completion cookie, manual confirmation, Recover or Resolve is
required. The deployed JSON:API response handling and bounded safe diagnostics remain.

The Edge completion's `membership_complete` RPC is the atomic website DB commit:
authority consumption, globally unique Patreon link, evidence, receipt and outbox
commit together or roll back together. External OAuth and Auth are not part of this
SQL transaction. Exact token retries return the immutable historical receipt without
reapplying an unlinked/superseded binding; the landing page always reads current
status rather than displaying receipt/query flags as current connection status.
If an outcome is lost, check current status and explicitly authorize again if needed.
New authorization fences older generations; no unacknowledged reference blocks it.
Expired/failed attempts require fresh OAuth, not resolution. Technical mutation and
outbox capacity limits still apply. Website Edge invocations have a ten-second timeout;
a timeout does not imply rollback and does not trigger automatic authorization loops.

`202609110001_edge_owned_link_commit.sql` is forward-only and drops the recovery
RPC/table/issuance trigger. Read the cutover and rollback section before deployment;
this task does not deploy it or drop any production table.

All sensitive storage has RLS and no anon/authenticated grants. No provider tokens,
raw bodies or emails are persisted as evidence. Avoid logging callback query strings
in external request-log systems: they contain short-lived OAuth codes or tickets.

## Validation

```sh
npx tsx --test supabase/functions/_shared/patreon.test.ts tests/membership-edge-commit.test.ts
npx vitest run src/app/account
npx next typegen && npx tsc --noEmit
```

After deploying, test a successful authorization, Patreon cancellation, callback
refresh/replay, and linking an already-used Patreon identity from a second site
account. Verify the row using the Supabase dashboard; it should not be readable
using a user's bearer token. Provider/API tests are synthetic. The new SQL migration has isolated PostgreSQL
coverage; live Patreon/Auth/browser round trips still require authorized deployment verification.
