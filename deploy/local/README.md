# Local website container

This is a development image for the coordinated ControlPlane Compose environment, not a production deployment image. Build from the website repository root:

```sh
docker build -f deploy/local/Dockerfile -t bannerlord-website-local:dev .
```

The image runs Next.js development mode on container port 3000 as the non-root `node` user. Linux dependencies are installed with `npm ci`; host dependencies, build output, Git history, and environment files are excluded from the build context by `Dockerfile.dockerignore`. No production secrets are required or copied. Rebuild after source changes; dependencies remain cached when the lockfile is unchanged.

## Central Compose contract

The ControlPlane repository owns the complete Compose stack and database reset/seed order. Its website service builds this Dockerfile with the website checkout as context, joins the normal Compose network, and serves behind the local TLS frontend on `https://supabase-tls.localhost:3443`.

Supply these environment variables at container startup:

| Variable | Local value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://supabase-tls.localhost:8443` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Disposable local Supabase anon JWT; despite the variable name, an anon JWT is supported |
| `SUPABASE_SECRET_KEY` | Disposable local Supabase service-role JWT, server-only |

Do not use `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the website does not read that name. Do not load the developer's existing `.env.local` into the container. The central stack must provide local values explicitly. Do not configure production Discord OAuth, Patreon, IONOS or the live console gateway for the local fixture.

The TLS frontend has Compose network alias `supabase-tls.localhost`; host listeners bind only to loopback. Both browser and website server requests use the HTTPS Supabase URL on port 8443. The browser test resolves this hostname to loopback; configure local resolution and trust the disposable CA when testing manually.

Backend services share the gateway's network namespace with distinct ports, preserving ControlPlane's loopback-only local guards. CP HTTP on port 8787 is private; Edge uses the internal-only TLS frontend on port 9443. The website does not call CP directly or need a Docker socket.

## Shared data ownership

One disposable local Postgres database named `controlplane` contains Supabase `auth`, website `public`, and private CP `control_plane` schemas. CP uses restricted runtime credentials, not the website service role.

- Website owns the authoritative public-schema bootstrap and local auth/membership seed.
- CP owns private-schema migrations and typed application setup for servers.
- Shared test account: `33333333-3333-4333-8333-333333333333`.
- The acceptance account has no Discord identity. Do not fabricate OAuth identities or contact Discord.
- Server IDs must come from CP setup's local manifest, not handcrafted database rows.

Some repository migration files are applied-history markers rather than schema definitions. They are not sufficient to recreate the entire public schema. `public-bootstrap.json` identifies a narrower, source-defined account/server baseline using the membership migration order already exercised by `tests/membership-postgres.test.ts`, plus server settings. It deliberately omits unrelated historical features and does not claim full-site schema parity. Apply its files once, in order, on a fresh local database after GoTrue initializes Auth and before account seeding. Some files own their transaction boundaries; do not wrap the entire sequence in a transaction and assume atomicity. If initial bootstrap fails, stop and preserve its logs and database state for diagnosis. Do not automatically reset or continue from partial state. Any later reset must explicitly target the named disposable local database/volume after approval; never reset shared state.

After real Auth tables, the public baseline and the prerequisite CP schema exist, the central stack applies `202609280001` (retirement), then `202609280002` (CP accounts), then `202609280003` (account-owned membership). The manifest lists these separately as `coordinatedAccountMigrations`; do not replay website mirrors if the CP runner already applied them. After schema setup, seed the confirmed email/password account through GoTrue without a Discord identity. Resolve its UUID principal and grant the local entitlement/create its server through typed CP APIs, not raw CP table inserts. Browser sign-in and command submission from this Discord-free account are required acceptance cases. The baseline manifest alone does not grant hosting access. Full-site parity still requires missing authoritative schema from approved **development schema metadata only**; never copy account data or silently substitute production.

## Local sign-in and auth seed

The Supabase gateway uses HTTPS with a disposable local CA; production HTTPS guards remain unchanged. Mount that CA read-only and set `NODE_EXTRA_CA_CERTS` on the website and auth-seed process, plus `DENO_CERT` on Edge. The central stack owns certificates and their mount paths. Auth's external URL and Edge's Supabase URL must also use the HTTPS gateway.

The browser test requires `tlsSpki` (the gateway leaf certificate's SHA-256 SPKI hash, base64) in its manifest. Chromium's certificate exception is scoped to that key; do not disable TLS validation globally. When changing the public Supabase URL or CA environment, restart the website. Existing development images also need the updated local-login route copied or mounted at `/app/src/app/dev-login`.

Open `https://supabase-tls.localhost:3443/dev-login` and use the prefilled disposable credentials:

- Email: `developer@example.test`
- Password: `local-bannerlord-only`

These are intentionally public local credentials, not secrets. `deploy/local/dev-login/fixture.json` is the shared source for the login form and auth seed. The Dockerfile copies this route into the local image only; it is not present in production `src/app` routes. The route also requires development mode and the exact local Supabase URL. It authenticates through normal Supabase password login and creates a real session—no authentication bypass or simulated success.

After GoTrue initializes its schema, the central stack's seed process runs `node deploy/local/seed-auth.mjs` in the gateway network namespace with the disposable `SUPABASE_SERVICE_ROLE_KEY`. The script creates or resets the fixed confirmed account through the GoTrue admin API. It does not write auth tables directly, supply fake Discord OAuth identities, or seed public membership rows; public membership and hosting setup follow the source-defined baseline and coordinated account-ownership migrations.

SMTP and Mailpit are not included. Production magic-link and OAuth login remain unchanged and are outside local password-login test coverage.

## Acceptance boundary

An image build alone is not an integration pass. The console test obtains a genuine local GoTrue password session and installs normal `@supabase/ssr`-encoded cookies in browser memory, then opens the exact seeded server directly. It submits a command through actual Next.js server actions and Edge, verifies its exact arrival at the synthetic controller through CP/agent transport, returns its output to the browser, and acknowledges the result. Website/server authorization still validates the genuine session; this is not an authentication bypass. The login UI is tested separately.

Managed command coverage requires website account/console PRs #183 and #185 and ControlPlane account/console PRs #207 and #209 in the checked-out sources. This container setup does not replace those changes or mock their application handlers. Actual Bannerlord behavior is outside the synthetic controller test.

## Running the browser check

The coordinated ControlPlane entrypoint owns stack startup, disposable TLS, schema/bootstrap, typed server seeding, and runner/database correlation:

```sh
# From the matching ControlPlane checkout (requires its local E2E suite changes):
npm run test:e2e:console -- --website /path/to/website-checkout
```

To check an already prepared local stack without starting or rebuilding services:

```sh
node deploy/local/test-console-browser.mjs /path/to/fixture.json /path/to/evidence-directory
```

The fixture supplies `serverId`, `command`, `expectedOutput`, and `tlsSpki`. The browser process also requires `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the disposable anon JWT) and `NODE_EXTRA_CA_CERTS` (the local CA file) in its environment, never session tokens on the command line. The Auth transport pins IPv4 loopback while retaining the canonical TLS server name and normal CA verification, so it does not depend on host DNS resolving the local alias. Use a new evidence directory for each attempt. The script asserts the genuine password Auth response has the fixed account ID and no Discord identity, uses the Supabase SSR library to encode/chunk cookies, submits once, compares plain-text output exactly, and acknowledges it. Cookies and session tokens remain in memory only; evidence contains screenshots and sanitized status, not tokens. If failure happens after Send, correlate the durable request with CP before attempting another command. Browser evidence alone must be paired with the runner receipt and durable job/ack state.

Run the separate login-page smoke against an already prepared stack:

```sh
node deploy/local/test-login-browser.mjs /path/to/fixture.json /path/to/login-evidence-directory
```

The matching CP wrapper exposes this separately as `npm run test:e2e:login -- --website /path/to/website-checkout`; it is not part of the default console test.

That smoke waits for the local form's React submit handler, signs in through the UI, verifies the returned Discord-free account, and checks navigation to `/servers`. It never submits a console command. Production login code is unchanged.

Before separating session setup from login UI, a manually coordinated local run passed this complete synthetic path with `coop.debug.players.list`, output `[synthetic-controller] no game process`, one runner delivery, and a succeeded UUID-owned durable job with acknowledged completion. The coordinated one-command orchestrator also passed a fresh local run after browser navigation was changed to wait for commit plus UI readiness rather than completion of streamed page resources. An earlier pre-Send cold-load failure was preserved, and the successful run stopped its services while retaining evidence. Neither historical pass exercises real Bannerlord STDIN or establishes exhaustive reliability. The session-seeded console variant requires its own fresh coordinated validation.
