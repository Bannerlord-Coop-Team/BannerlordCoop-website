# Patron nightly access gateway

The installer script is intentionally public. It carries no Discord, R2, or
shared download secret. Every install or update starts a new device session,
opens Discord OAuth in the user's browser, and receives a short-lived bearer
token only after the gateway verifies one of these conditions:

- the signed-in Discord member currently has the fixed Patreon, Afdian, or
  Boosty supporter role in the Bannerlord Coop guild; or
- the signed-in Discord account occupies one of a current supporter's ten
  sponsored-account seats.

Sponsored access is attached to the friend's Discord account, not to a machine
or a download count. The supporter's encrypted, revocable Discord refresh grant
is used to re-check the supporter's role before each installer session is
approved. Removing a sponsored account revokes its active gateway sessions.

This controls the official installer and download paths. A person who has
legitimately received the archive bytes can still copy those bytes; client-side
software cannot prevent that.

## Required production setup

1. Create the D1 database named `bannerlordcoop-nightly-access`, replace its
   placeholder ID and the Discord application ID in `wrangler.jsonc`, then run
   the migration.
2. Register exactly
   `https://nightly.bannerlordcoop.com/oauth/callback` as a Discord OAuth2
   redirect and enable the `identify guilds.members.read` scopes.
3. Set `DISCORD_CLIENT_SECRET` with `wrangler secret put`.
4. Generate 32 random bytes, encode them as unpadded base64url, and set them as
   `TOKEN_ENCRYPTION_KEY` with `wrangler secret put`.
5. Bind the existing `bannerlordcoop-nightly-releases` R2 bucket and route
   `nightly.bannerlordcoop.com` to this Worker.
6. Migrate Bot_UP/Managed Hosting to authenticated R2 reads before making the
   release bucket private.
7. Deploy the updated client, dedicated-server, and website publishers and
   verify a live direct-supporter install plus a sponsored install.
8. Disable the bucket's public `r2.dev` development URL. Leaving it enabled
   bypasses this gateway.

Never disable `r2.dev` early: Bot_UP and the managed Linux agent currently read
release objects from that origin.

## Verification

```sh
npm run gateway:types
npm run gateway:check
npm run gateway:dry-run
npm test
```

The dry run is intentionally non-deploying. Deployment also requires the real
D1 ID, Discord application ID, secrets, DNS route, and Cloudflare account that
owns the existing release bucket.
