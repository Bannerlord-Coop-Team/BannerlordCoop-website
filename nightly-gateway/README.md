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
   `https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/oauth/callback`
   as a Discord OAuth2
   redirect and enable the `identify guilds.members.read` scopes.
3. Set `DISCORD_CLIENT_SECRET` with `wrangler secret put`.
4. Generate 32 random bytes, encode them as unpadded base64url, and set them as
   `TOKEN_ENCRYPTION_KEY` with `wrangler secret put`.
5. Create and bind a private R2 bucket named
   `bannerlordcoop-patron-nightlies`. Do not enable its `r2.dev` URL or attach a
   public custom domain. The Worker is exposed through the existing
   `garrett-luskey.workers.dev` account subdomain, so Squarespace DNS is not
   involved.
6. Keep `/create-build` output in the separate public
   `bannerlordcoop-nightly-releases` bucket. Its copyable links remain valid
   until Bot_UP's existing 24-hour expiry cleanup; never disable public access
   on that bucket as part of the Patron-nightly rollout.
7. Migrate Bot_UP/Managed Hosting to scoped R2 S3 reads from the private Patron
   bucket. Machine-to-machine hosting downloads do not use Discord OAuth.
8. Deploy the updated client, dedicated-server, and website publishers and
   verify a live direct-supporter install plus a sponsored install.

## Verification

```sh
npm run gateway:types
npm run gateway:check
npm run gateway:dry-run
npm test
```

The dry run is intentionally non-deploying. Deployment also requires the real
D1 ID, Discord application ID, secrets, private Patron bucket, and the Garrett
Cloudflare account configured in `wrangler.jsonc`.
