# Patreon account linking

This links Patreon to an existing Supabase account, with explicit authenticated
confirmation and ephemeral `identity identity.memberships` verification. Tokens
are never retained. See [membership onboarding](membership-onboarding.md) for the
current policy, transactional recovery, private synchronization contract, settings,
additive migration order and enablement blockers. This is not unattended polling
or proof of settled funds. The original identity-only SQL migration remains immutable.

The independent [website role worker](patreon-website-roles.md) uses a distinct creator token and policy to manage Standard Server roles; those roles never authorize control-plane membership grants.

## Production setup

1. Follow the coordinated additive migration order in the membership document.
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
UUID, expected generation and safe return path are server-held. Callback GET
creates normalized completion authority only. The website requires explicit POST
confirmation; one transaction consumes authority, links, stores normalized evidence,
records an immutable replayable receipt and emits an outbox event. Lost responses
retain the same completion cookie when available; a bounded account/provider recovery
slot survives cookie expiry and resolves the exact operation via authenticated status.
Neither this non-authorizing UUID nor current Auth linkage replaces live completion
authority. Explicit cancellation serializes with commit; uncertain attempts cannot be
silently replaced. A committed receipt can be recovered after expiry without relinking.
Current status is authenticated,
never established by query parameters. Unlink/deletion preserve revocation evidence.

All sensitive storage has RLS and no anon/authenticated grants. No provider tokens,
raw bodies or emails are persisted as evidence. Avoid logging callback query strings
in external request-log systems: they contain short-lived OAuth codes or tickets.

## Validation

```sh
npx tsx --test supabase/functions/_shared/patreon.test.ts
npx vitest run src/app/account/page.component.test.tsx
npx next typegen && npx tsc --noEmit
```

After deploying, test a successful authorization, Patreon cancellation, callback
refresh/replay, and linking an already-used Patreon identity from a second site
account. Verify the row using the Supabase dashboard; it should not be readable
using a user's bearer token. Provider/API tests are synthetic. The new SQL migration has isolated PostgreSQL
coverage; live Patreon/Auth/browser round trips still require authorized deployment verification.
