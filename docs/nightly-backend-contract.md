# Nightly backend: Supabase migration contract

Status: draft, 2026-11-15. This is the contract the three implementation tracks build against: the Edge Function, the website pages, and the Worker plus installers.

## Why

- **The outage.** The Cloudflare Worker gateway (`nightly-gateway/`) checks Discord roles with a bot that is no longer in the Bannerlord Coop server (app `1537575576745803799`). Every install therefore fails at token issue with `502 discord_membership_required`.
- **The decision.** Move the backend logic that needs Discord into Supabase, using the project's own Discord application ("Joke's AI Assistant"). Keep downloads on R2.

## Ownership

| Component | Owns | Host |
|---|---|---|
| **Edge Function `nightly-gateway`** | Device sessions, Discord OAuth (start and complete), the live Discord member check, sponsor seats (claim, portal, code, remove), issuing download tokens | `https://wfvqnijwuyqjibhlcrhz.supabase.co/functions/v1/nightly-gateway/*` (`verify_jwt = false`) |
| **Worker `bannerlordcoop-nightly-gateway`** | Everything that touches R2: `/v1/manifests/*`, `/v1/artifacts/*`, create-build pins (`/v1/pins*`, `/install?pin=`, `/v1/pins/install.cmd`), installer scripts and `7zr.exe`; it also forwards the device API to the Edge Function | `nightly.bannerlordcoop.com` (new canonical host) and `bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev` (legacy; serves identically until it is retired) |
| **Website (Next.js)** | Browser pages: activate, Discord callback, sponsor claim, sponsor portal | `https://bannerlordcoop.com/nightly/*` |
| **Postgres `nightly_gateway` schema** | Unchanged tables. The Worker reads `download_sessions` and `pin_download_sessions` to authorize downloads, as it does today. | Supabase |

Rule of thumb: **only the Edge Function calls Discord, and only the Worker reads or writes R2.**

## 1. Installer-facing API (Worker host, unchanged wire format)

Installers keep calling the gateway host. The Worker forwards these two routes to the Edge Function, passing the method and body through. The Edge Function never sees or validates the installer's host.

| Route | Request | Success | Errors (unchanged codes) |
|---|---|---|---|
| `POST /v1/device/sessions` | form `client=installer` | `201 {device_code, user_code, verification_uri, expires_in: 600, interval: 3}` (the Edge Function returns everything except `verification_uri`, which the Worker adds) | `5xx` |
| `POST /v1/device/token` | form `device_code=<43 chars>` | `200 {access_token: <43 chars>, token_type: "Bearer", expires_in: 3600}` | `400 invalid_request`/`expired_token`, `428 authorization_pending`, `403 access_denied`/`supporter_role_required`, `409 already_used`, `502 discord_*` (+`upstream_status`, `upstream_code`) |

- **`verification_uri`** is added by the Worker from the host the installer used, as `<origin>/activate?code=XXXX-XXXX`. Old installers (workers.dev) and new installers (`nightly.bannerlordcoop.com`) both receive a URI on their own host, so the existing installer host check keeps passing.
- **`GET /activate?code=` on the Worker** answers `302` to `https://bannerlordcoop.com/nightly/activate?code=…`.
- **Forwarding failures:** the Worker answers `502 function_unreachable` when the Edge Function can't be reached and `502 function_response_invalid` when its reply is unusable. Both are logged, and the installer treats both as transient while polling.
- **Token formats:** all tokens and codes keep their current formats. Secrets are 32 random bytes, base64url-encoded (43 chars). The user code is `XXXX-XXXX` from `A-Z2-9`. Storage is SHA-256 hashes only.

## 2. Website ↔ Edge Function API

These calls run server-side, from Next.js route handlers and server actions on `bannerlordcoop.com`. Every request carries `x-nightly-website-key: <NIGHTLY_WEBSITE_KEY>`. That is a new shared secret, set in both Supabase and the website runtime and compared in constant time. Bodies are JSON, and errors are `{error: <code>, upstream_status?, upstream_code?}`.

| Edge Function route | Body | Response |
|---|---|---|
| `POST /oauth/start` | `{purpose: "device", user_code}` or `{purpose: "sponsor-portal"}` | `200 {authorize_url}`. It stores the state hash: `device_sessions.oauth_state_hash` for `device`, `oauth_states` for `sponsor-portal`. Errors: `400 invalid_code`, `400 expired` |
| `POST /oauth/complete` | `{code, state}` | `200` with one of the outcomes listed below this table. Errors: `400 invalid_request`/`expired`, `502 discord_*` |
| `POST /sponsorship/claim` | `{device_id, sponsor_code}` | `200 {outcome: "sponsored-approved"}`. Errors: `400 expired`, `403 invalid_sponsor_code`, `403 supporter_role_required`, `409 already_sponsored`, `409 seats_full` |
| `POST /sponsor/portal` | `{session}` | `200 {seats: [{discord_user_id, created_at}], limit: 10}`. Errors: `401 authorization_expired`, `403 supporter_role_required` (the website should send the user to log in again) |
| `POST /sponsor/code` | `{session}` | `200 {code: "XXXX-XXXX-XXXX"}` (it is displayed once). Error: `401` |
| `POST /sponsor/remove` | `{session, discord_user_id}` | `204`. Errors: `401`, `400` |

Outcomes returned by `/oauth/complete`:
- `{outcome: "approved"}`: a direct member; the device is approved.
- `{outcome: "sponsored-approved"}`: an existing seat whose sponsor is still eligible.
- `{outcome: "needs-sponsor", device_id, username, previous_sponsor_revoked: bool}`
- `{outcome: "portal", session, expires_in: 86400}`: sponsor-portal login.

- **OAuth.** The redirect URI is exactly `https://bannerlordcoop.com/nightly/callback`, already registered on the app. Scopes are unchanged: `identify guilds.members.read`.
- **Sponsor session.** The website keeps the session token in cookie `nightly_sponsor`: `Path=/nightly; HttpOnly; Secure; SameSite=Lax; Max-Age` taken from the portal outcome's `expires_in`.
- **CSRF.** The website protects its own forms with Next.js server actions plus a same-origin check. The Edge Function trusts the website key plus the session, and no longer issues HMAC form tokens.
- **Messages.** The website maps error codes to user-facing text. The current `gatewayErrorMessage` and help strings in `nightly-gateway/src/index.ts` are the copy source.

## 3. Website pages

| Page | Behaviour |
|---|---|
| `GET /nightly/activate?code=` | `/oauth/start {device}`, then `302 authorize_url`. Shows an error page for a bad or expired code. |
| `GET /nightly/callback?code&state` | `/oauth/complete`. Renders success ("Return to the installer window…"), the sponsor-code claim form for `needs-sponsor`, or sets the cookie and redirects to `/nightly/sponsor` for `portal` |
| `POST /nightly/claim` | Server action calling `/sponsorship/claim`; renders success or error |
| `GET /nightly/sponsor` | No cookie: landing page plus "Continue with Discord", which goes to `/nightly/sponsor/login`. Otherwise `/sponsor/portal`, rendering the seat list (create a code, remove a seat) |
| `GET /nightly/sponsor/login` | `/oauth/start {sponsor-portal}`, then `302` |
| `POST /nightly/sponsor/code`, `/nightly/sponsor/remove` | Server actions |

The Worker's legacy `/sponsor*` and `/oauth/callback` paths answer `301` to the matching `bannerlordcoop.com/nightly/*` pages.

## 4. Edge Function internals

- **Database access.** It connects with `npm:pg` to `SUPABASE_DB_URL` (provided automatically) through a small `query`/`transaction` helper. Queries are native Postgres with schema-qualified `nightly_gateway.*` names; multi-statement changes run in transactions.
- **Discord.**
  - Bot lookup: `GET /guilds/709516043332354119/members/{id}` with `Bot DISCORD_BOT_TOKEN` and `User-Agent: DiscordBot (https://bannerlordcoop.com, 1)`.
  - Errors carry `upstream_status` and `upstream_code`.
  - The role lists and access rules live only in `supabase/functions/_shared/nightly/policy.ts`, with unchanged values.
- **Secrets.**
  - Already set: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.
  - New: `NIGHTLY_WEBSITE_KEY`.
  - Nothing else.
- **Refresh tokens.** The gateway stores encrypted Discord refresh tokens it never reads. The Edge Function stops storing them. A migration makes `supporter_grants.encrypted_refresh_token` and `token_nonce` nullable, and clears the existing values. `TOKEN_ENCRYPTION_KEY` is retired.
- **No shared code with the Worker.** The Edge Function owns the access policy; the Worker owns R2 and holds no Discord or role logic.

## 5. Worker changes

- **Removed:** the device-session, OAuth, sponsorship and portal handlers, plus the `DISCORD_*` and `TOKEN_ENCRYPTION_KEY` bindings.
- **Kept:** manifests, artifacts, pins, assets and `/health`. `/` redirects to `https://bannerlordcoop.com/nightly`.
- **Origin handling:** `PUBLIC_ORIGIN` becomes the request origin, checked against the two allowed hosts. Manifest URL rewriting, pin URLs and `verification_uri` therefore match the host the installer used. The single-origin `assertConfiguration` check is replaced by that allowlist.
- **New var:** `NIGHTLY_FUNCTION_URL` (in `wrangler.jsonc`) for forwarding.

## 6. Installer and pipeline changes

- **`installer/install.ps1`, `installer/install-linux.sh`:** the gateway host becomes `nightly.bannerlordcoop.com`. Host, path and verification-URI checks follow it.
- **Launchers:** `install.cmd`, `install.sh` and the pin launcher get the new primary host. The GitHub raw fallback is unchanged.
- **Website links:** `DownloadModal.tsx` and the `next.config.ts` redirects use the new host.
- **Other repos:**
  - Coop `.github/workflows/nightly-release.yml`: `NIGHTLY_GATEWAY_ORIGIN` becomes `https://nightly.bannerlordcoop.com`.
  - Control Plane: `src/adapters/nightly-gateway-pin.ts` and `src/domain/nightly-delivery.ts` use the new origin.

## 7. Rollout (each step after explicit approval)

1. **Database:** migration for the nullable refresh token. Additive and safe for the running Worker.
2. **Edge Function:** deploy, plus the `NIGHTLY_WEBSITE_KEY` secret.
3. **Website:** deploy the `/nightly/*` pages, plus `NIGHTLY_WEBSITE_KEY`.
4. **Worker:** deploy the slimmed version, plus `NIGHTLY_FUNCTION_URL`. Installs start working from this point.
5. **Installers:** move them to `nightly.bannerlordcoop.com`. The launcher fetches the latest script, so this rolls out immediately.
6. **Other repos:** Coop CI and Control Plane origin PRs.
7. **Later:** retire the `workers.dev` host and the old Discord app.

## Implementation notes (resolved during the build)

- **Edge Function routing.** It accepts both `/nightly-gateway/<route>` and `/functions/v1/nightly-gateway/<route>`. Unknown routes and wrong methods return `404 not_found`.
- **Website-key failures.** A missing or wrong `x-nightly-website-key` returns `401 unauthorized`.
- **Sponsor sessions.** A missing or malformed session returns `401 authorization_required`, an expired one `401 authorization_expired`. The website treats any 401 as "sign in again".
- **Portal login without a qualifying role** returns `403 supporter_role_required`. The website shows the gateway's role-required copy.
- **`/oauth/complete` validates state first.** An unknown, expired or replayed state returns `400 expired` without calling Discord.
- **Concurrent token polls.** A duplicate token issue from simultaneous polls maps to `409 already_used`.
- **Refresh tokens.** Migration `20261115090000_nightly_gateway_retire_refresh_tokens.sql` makes the refresh-token columns nullable, adds a both-or-neither check, and clears the existing values. New grants store NULL. The current Worker's upsert still succeeds against the migrated schema; this is tested.
- **Callback.** `/nightly/callback` is a route handler. It calls `/oauth/complete` exactly once and then redirects:
  - `approved` → `/nightly/approved`
  - `needs-sponsor` → `/nightly/claim`
  - `portal` → sets the cookie, then `/nightly/sponsor`
  - errors → `/nightly/error`
- **Claim state.** The device id, username and revoked flag live in the `nightly_claim` cookie (`Path=/nightly`, 10 minutes), never in the HTML.
- **Sponsor-portal actions.** Create-code and remove-seat are server actions posted to `/nightly/sponsor`, guarded by Next's origin check plus an explicit same-origin check. `/nightly/sponsor/logout` clears an expired session.
- **Worker forwarding.**
  - For a successful session it adds `verification_uri` on the allowlisted request host, or the canonical host for anything else.
  - An unreachable function returns `502 function_unreachable`; a non-JSON, empty, oversized (>16 KiB) or redirecting upstream reply returns `502 function_response_invalid`. Both are logged.
  - A request body over 4 KiB returns `413 request_too_large` and is not forwarded; a failing request stream is a `500`, not a 413.
  - The upstream timeout is 10 s.
- **Worker redirects.** `/` and `/activate` redirect only for GET/HEAD. The other legacy paths answer `301` for any method. Only `/activate` and `/oauth/callback` keep their query strings.
- **Legacy (v1) manifests.** Their checks accept either gateway host, and URLs are rewritten to the host the installer used.
- **Code sharing.** None: the Worker's Discord policy was removed, so `_shared/nightly/policy.ts` is the only access policy.
- **Custom domain.** `nightly.bannerlordcoop.com` is attached to the Worker as a custom domain and declared in `nightly-gateway/wrangler.jsonc` `routes`.
