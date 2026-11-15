# Nightly backend contract

This is the contract between the three components that serve nightly installs: the Supabase Edge Function, the Cloudflare Worker, and the website pages. It describes the code as built.

## Why

- **The outage.** The Cloudflare Worker gateway (`nightly-gateway/`) checked Discord roles with a bot that was no longer in the Bannerlord Coop server (app `1537575576745803799`). Every install failed at token issue with `502 discord_membership_required`.
- **The decision.** Move the backend logic that needs Discord into Supabase, using the project's own Discord application. Keep downloads on R2.

## Ownership

| Component | Owns | Host |
|---|---|---|
| **Edge Function `nightly-gateway`** | Device sessions, Discord OAuth (start and complete), the live Discord member check, sponsor seats (claim, portal, code, remove), issuing download tokens | `https://wfvqnijwuyqjibhlcrhz.supabase.co/functions/v1/nightly-gateway/*` (`verify_jwt = false`) |
| **Worker `bannerlordcoop-nightly-gateway`** | Everything that touches R2: `/v1/manifests/*`, `/v1/artifacts/*`, create-build pins (`/v1/pins*`, `/install?pin=`, `/v1/pins/install.cmd`), installer scripts and `7zr.exe`. It also forwards the device API to the Edge Function. | `nightly.bannerlordcoop.com` (canonical, a Worker custom domain declared in `wrangler.jsonc`) and `bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev` (legacy; serves identically until it is retired) |
| **Website (Next.js)** | Browser pages: landing, activate, Discord callback, sponsor claim, sponsor portal | `https://bannerlordcoop.com/nightly/*` |
| **Postgres `nightly_gateway` schema** | All gateway state. The Worker reads `download_sessions` (`token_hash`, `expires_at`), `installer_pins` and `pin_download_sessions`; everything else belongs to the Edge Function. | Supabase |

Rule of thumb: **only the Edge Function calls Discord, and only the Worker reads or writes R2.** The two deployables share no code. Website ↔ Edge wire formats live in `supabase/functions/_shared/nightly/formats.ts`, and the access policy (roles, seat limit, lifetimes) lives in `supabase/functions/_shared/nightly/policy.ts`. The website imports both.

## 1. Installer-facing API (Worker host)

Installers call the gateway host. The Worker forwards these two routes to the Edge Function, passing the method, content type and body through. The Edge Function never sees or validates the installer's host.

| Route | Request | Success | Errors |
|---|---|---|---|
| `POST /v1/device/sessions` | form `client=installer` | `201 {device_code, user_code, verification_uri, expires_in: 600, interval: 3}`. The Edge Function returns everything except `verification_uri`, which the Worker adds. | `5xx` |
| `POST /v1/device/token` | form `device_code=<43 chars>` | `200 {access_token: <43 chars>, token_type: "Bearer", expires_in: 3600}` | `400 invalid_request`/`expired_token`, `428 authorization_pending`, `403 access_denied`/`supporter_role_required`, `409 already_used`, `502 discord_*` (with `upstream_status`, `upstream_code`), `500 internal_error` |

- **`verification_uri`** is `<origin>/activate?code=XXXX-XXXX` on the allowlisted host the installer used, or the canonical host for anything else. Old and new installers both receive a URI on their own host, so the installer host check keeps passing.
- **`GET /activate?code=`** on the Worker answers `302` to `https://bannerlordcoop.com/nightly/activate?code=…`.
- **Forwarding limits.** A request body over 4 KiB returns `413 request_too_large` and is not forwarded; a failing request stream is a `500`. The upstream timeout is 10 s.
- **Forwarding failures.** An unreachable function returns `502 function_unreachable`. A redirecting (3xx) or misrouted (404) reply, or a non-JSON, empty or oversized (>16 KiB) body, returns `502 function_response_invalid`. Both are logged with the cause class and, for unusable replies, the upstream HTTP status. The Windows installer treats both as transient while polling; the Linux installer stops with a retry message.
- **Token formats.** Secrets are 32 random bytes, base64url-encoded (43 chars). The user code is `XXXX-XXXX` from `A-Z2-9`, normalized by trimming and upper-casing. Only SHA-256 hex digests are stored.
- **Legacy (v1) manifests** accept either gateway host, and their URLs are rewritten to the host the installer used.

## 2. Website ↔ Edge Function API

These calls run server-side, from Next.js route handlers and server actions. Every request carries `x-nightly-website-key: <NIGHTLY_WEBSITE_KEY>`, a shared secret set in both Supabase and the website runtime and compared in constant time; a missing or wrong key returns `401 unauthorized`. Bodies are JSON, and errors are `{error: <code>, upstream_status?, upstream_code?}`. The function accepts both `/nightly-gateway/<route>` and `/functions/v1/nightly-gateway/<route>`; unknown routes and wrong methods return `404 not_found`.

| Edge Function route | Body | Response |
|---|---|---|
| `POST /oauth/start` | `{purpose: "device", user_code}` or `{purpose: "sponsor-portal"}` | `200 {authorize_url}`. It stores the state hash (`device_sessions.oauth_state_hash` for `device`, `oauth_states` for `sponsor-portal`). Errors: `400 invalid_request` (unknown purpose or malformed body), `400 invalid_code`, `400 expired` |
| `POST /oauth/complete` | `{code, state}` | `200` with one of the outcomes below. The state is checked before any Discord call, so an unknown, expired or replayed state returns `400 expired`. Other errors: `400 invalid_request`, `403 supporter_role_required` (portal login without a qualifying role), `403 discord_membership_required` (portal login by an account outside the guild), `502 discord_*`, `500 internal_error` |
| `POST /sponsorship/claim` | `{device_id, sponsor_code}` | `200 {outcome: "sponsored-approved"}`. Errors: `400 invalid_request`, `400 expired`, `403 invalid_sponsor_code`, `403 supporter_role_required`, `409 already_sponsored`, `409 seats_full`, `502 discord_*`, `500 internal_error` |
| `POST /sponsor/portal` | `{session}` | `200 {seats: [{discord_user_id, created_at}]}`. The 10-seat limit is the shared `SPONSORED_ACCOUNT_LIMIT`, not part of the response. Errors: `401 authorization_required`/`authorization_expired`, `403 supporter_role_required`, `502 discord_*`, `500 internal_error` |
| `POST /sponsor/code` | `{session}` | `200 {code: "XXXX-XXXX-XXXX"}`, displayed once. Error: `401` |
| `POST /sponsor/remove` | `{session, discord_user_id}` | `204`. Errors: `401`, `400 invalid_request` |

Outcomes returned by `/oauth/complete`:
- `{outcome: "approved"}`: a direct member; the device is approved.
- `{outcome: "sponsored-approved"}`: an existing seat whose sponsor is still eligible.
- `{outcome: "needs-sponsor", device_id, username, previous_sponsor_revoked}`
- `{outcome: "portal", session, expires_in}`: sponsor-portal login.

- **OAuth.** Scopes are `identify guilds.members.read`. The redirect URI defaults to `https://bannerlordcoop.com/nightly/callback`, which is registered on the Discord app; the optional `DISCORD_REDIRECT_URI` Edge setting overrides it for local or preview stacks (https, or loopback http).
- **Website logging.** The website client logs, once per call and never with bodies or secrets: unreachable calls, invalid responses, 5xx, 404 and 3xx replies (a misrouted `NIGHTLY_FUNCTION_URL`), and a rejected website key. A missing or invalid website setting is logged by name only.

## 3. Website pages

| Page | Behaviour |
|---|---|
| `GET /nightly` | Landing page with installer links and the sponsor-portal entry |
| `GET /nightly/activate?code=` | `/oauth/start {device}`, then `302 authorize_url`. A bad or expired code goes to `/nightly/error`. |
| `GET /nightly/callback?code&state` | Route handler. Calls `/oauth/complete` exactly once, then redirects: `approved` → `/nightly/approved`; `sponsored-approved` → `/nightly/approved?via=sponsor`; `needs-sponsor` → `/nightly/claim` with the `nightly_claim` cookie; `portal` → `/nightly/sponsor` with the `nightly_sponsor` cookie; errors → `/nightly/error` |
| `GET /nightly/claim` | The sponsor-code form. Its server action calls `/sponsorship/claim`, clears `nightly_claim` on success and redirects to the approved page. |
| `GET /nightly/sponsor` | No session: login prompt ("Continue with Discord" → `/nightly/sponsor/login`). With a session: `/sponsor/portal`, rendering the seats with create-code and remove-seat server actions, both posted to `/nightly/sponsor`. An expired session renders the login prompt with an expired notice. |
| `GET /nightly/sponsor/login` | `/oauth/start {sponsor-portal}`, then `302` |
| `GET /nightly/approved`, `GET /nightly/error` | Static results; the error page picks fixed copy from the context and code in its query. |

- **Cookies.** Both cookies are `Path=/nightly; HttpOnly; Secure; SameSite=Lax`. `nightly_sponsor` lives as long as the portal outcome's `expires_in`. `nightly_claim` holds the device id, username and revoked flag (never rendered into HTML) and lives as long as a device session.
- **Expired sessions.** A sponsor server action that receives a 401 clears `nightly_sponsor` and redirects to `/nightly/sponsor?session=expired`, which shows the expired notice.
- **CSRF.** Server actions rely on Next's origin check plus the shared strict same-origin rule in `src/app/lib/auth/same-origin.ts`.
- **Copy.** User-facing text lives in `src/app/lib/nightly/messages.ts`, carried over from the former Worker pages.
- **Legacy paths.** The Worker's `/sponsor*`, `/oauth/callback`, `/v1/sponsorship/claim` and `/v1/sponsor/*` answer `301` to the matching `bannerlordcoop.com/nightly/*` page; `/` and `/activate` redirect only for GET/HEAD, and only `/activate` and `/oauth/callback` keep their query strings.

## 4. Edge Function internals

- **Database.** `npm:pg` against `SUPABASE_DB_URL` (provided automatically). Queries are native Postgres with schema-qualified `nightly_gateway.*` names. Connections are held per statement or per transaction, never across a Discord call; multi-step changes (token issue, sponsor claim, portal login, direct approval) run in one transaction, with Discord checks done first. Each table is owned by one module: `device.ts`, `grants.ts`, `sponsor.ts`, `downloads.ts`, `oauth.ts`.
- **Discord.** The bot lookup is `GET /guilds/709516043332354119/members/{id}` with `Bot DISCORD_BOT_TOKEN` and a `DiscordBot` User-Agent. Every Discord call has an 8 s timeout. Discord-caused errors use `discord_*` codes (including `502 discord_response_too_large` for an oversized reply) and carry `upstream_status` and `upstream_code`; network failures and timeouts become a logged `500 internal_error`, which the installer retries.
- **Logging.** Unexpected failures are logged by class, safe snake_case code, errno-style driver code and SQLSTATE only, never message text or secrets.
- **Secrets.** `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `NIGHTLY_WEBSITE_KEY` (at least 32 characters); optional `DISCORD_REDIRECT_URI`. The function refuses to start with a missing or implausible secret.
- **Refresh tokens.** Migration `20261115090000_nightly_gateway_retire_refresh_tokens.sql` makes `supporter_grants.encrypted_refresh_token` and `token_nonce` nullable (both or neither) and clears existing values. New grants store NULL, and the old Worker's upsert still succeeds against the migrated schema. `TOKEN_ENCRYPTION_KEY` is retired.

## 5. Worker

- **Removed:** the device-session, OAuth, sponsorship and portal handlers; the `DISCORD_*` and `TOKEN_ENCRYPTION_KEY` dependencies; the D1 fallback. Gateway state is Postgres-only, so rolling back means redeploying the previous Worker and Edge Function versions together.
- **Kept:** manifests, artifacts, pins, assets and `/health`. `/` redirects to `https://bannerlordcoop.com/nightly`.
- **Origins.** Every generated URL follows the request origin, checked against the two allowed hosts.
- **Config.** `NIGHTLY_FUNCTION_URL` (a `wrangler.jsonc` var) is the forwarding target; a bad value fails only device requests, which log `gateway_function_url_invalid`.
- **Logging.** The logger is injected; failures log the stable code plus the cause class, a safe snake_case message and, for forwarding, the upstream status.

## 6. Installers and pipelines

- **`installer/install.ps1`, `installer/install-linux.sh`:** the gateway host is `nightly.bannerlordcoop.com`, set once and used by every host, path and verification-URI check.
- **Launchers:** `install.cmd`, `install.sh` and the pin launcher use the new primary host; the GitHub raw fallback is unchanged. Launchers always fetch the latest script, so installer changes reach everyone at once.
- **Website links:** the download modal points at `/nightly`, and `next.config.ts` redirects use the shared host constant.
- **Other repos (follow-ups):** Coop `.github/workflows/nightly-release.yml` `NIGHTLY_GATEWAY_ORIGIN`, and the Control Plane's `src/adapters/nightly-gateway-pin.ts` and `src/domain/nightly-delivery.ts`, move to `https://nightly.bannerlordcoop.com`. Both hosts keep working, so these don't block rollout.

## 7. Rollout (each step after explicit approval)

1. **Database:** apply the refresh-token migration and `20261116000000_nightly_gateway_fix_pin_server_file_check.sql`. Both are safe for the running Worker. The second fixes a pre-existing bug: the original `installer_pins` server-file check required a literal backslash, so production has never been able to store a create-build pin.
2. **Edge Function:** set `NIGHTLY_WEBSITE_KEY` (the Discord secrets are already set), then deploy `nightly-gateway`.
3. **Website:** set the same `NIGHTLY_WEBSITE_KEY` on the website Worker, then deploy the `/nightly/*` pages.
4. **Worker:** deploy the slimmed gateway. Device login runs on Supabase from this point.
5. **Smoke test:** a real install end to end, plus the sponsor portal.
6. **Clean up:** delete the Worker's retired secrets (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `DATABASE_BACKEND`) and, once nothing needs it, the old D1 database.
   Once the pre-split Worker can no longer be rolled back to, add a migration that drops `supporter_grants.encrypted_refresh_token` and `token_nonce` with their three checks, and reduce `storeSupporterGrant` (`grants.ts`) to an upsert of `updated_at`.
7. **Later:** retire the `workers.dev` host, and switch the Discord bot and app back to the project's long-term application.
