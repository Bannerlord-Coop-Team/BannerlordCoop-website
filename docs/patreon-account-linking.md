# Patreon account linking

This links a Patreon **identity** to an existing Supabase user. It does not sign
users in through Patreon, check paid memberships, or grant supporter roles.
OAuth access/refresh tokens are deliberately not persisted. The separate
[membership worker](patreon-website-roles.md) uses a creator access token to
verify the linked identity's paid tier and manage Standard Server grants.
It requires its own deployment and configuration; linking alone does not grant a role.

## Production setup

1. Apply `supabase/migrations/20260907212654_create_patreon_links.sql` to the intended
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
4. Deploy all three functions to the same project:

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

- The account button runs a Next.js Server Action, verifies the site user, and
  calls `patreon-start` with that user's Supabase bearer token.
- Start creates a random, ten-minute, single-use launch ticket. A top-level
  navigation to the callback consumes it and creates an independent OAuth state.
  This navigation sets a Secure, HttpOnly, SameSite=Lax, host-only cookie on the
  Supabase domain without relying on third-party cookies or cross-origin fetches.
- Patreon returns an authorization code. The callback checks the cookie/state,
  atomically consumes the state, exchanges the code server-side, and fetches
  `/api/oauth2/v2/identity` with the `identity` scope.
- The callback creates a short-lived completion token and redirects to the site's
  callback route. The site verifies its current session; `patreon-complete` verifies
  the bearer token again and consumes the completion token only for the initiating
  user. This prevents a forwarded launch URL from linking a victim's Patreon to a
  different person's site account. Switching accounts mid-flow fails safely.
- Only completion writes `public.patreon_accounts`. One site user has at most one
  Patreon identity, and one Patreon identity cannot be shared across site users.
  Linking again replaces the same user's previous identity.
- Both tables have RLS enabled with no client policies and no anon/authenticated
  grants. Only the service role can access them. OAuth tokens are discarded;
  launch/state/completion tokens are stored as SHA-256 hashes. Expired temporary
  rows are cleaned up on subsequent authenticated starts.
- Redirect destinations are configured server-side, not supplied by callers.
  OAuth responses are non-cacheable and use `Referrer-Policy: no-referrer`.
  Avoid logging callback query strings in external request-log systems, as they
  contain short-lived OAuth codes or tickets.

If the session expires, cookies are blocked, or another user already owns the
Patreon identity, linking fails without changing an existing link. Sign in again
and restart from Account. Status query parameters are presentation only and must
never be treated as authorization or entitlement evidence.

## Validation

```sh
npx tsx --test supabase/functions/_shared/patreon.test.ts
npx vitest run src/app/account/page.component.test.tsx
npx next typegen && npx tsc --noEmit
```

After deploying, test a successful authorization, Patreon cancellation, callback
refresh/replay, and linking an already-used Patreon identity from a second site
account. Verify the row using the Supabase dashboard; it should not be readable
using a user's bearer token. Unit tests mock the provider and database; a live
Patreon round trip and the SQL migration still require deployment verification.
