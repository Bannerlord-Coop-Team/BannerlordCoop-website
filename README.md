# Bannerlord Coop Website

> Nightly builds are restricted to Testers and current Patreon, Boosty, and
> Afdian supporters, plus up to ten sponsored Discord accounts per eligible
> member. The installer is served by the private download gateway and verifies
> that entitlement on every run. See [nightly-gateway/README.md](nightly-gateway/README.md)
> for the security boundary and rollout order.

The official website for [Bannerlord Coop](https://github.com/Bannerlord-Coop-Team/BannerlordCoop), a module that brings cooperative multiplayer to the Mount & Blade II: Bannerlord campaign.

## Contributing

By submitting a contribution to BannerlordCoop, you agree that your contribution
may be used, modified, distributed, sublicensed, and relicensed by the
BannerlordCoop project maintainers as part of the BannerlordCoop project.

You also confirm that you have the right to submit the contribution and that it
does not knowingly include code copied from another project without permission.

## Tech Stack

- [Next.js 16](https://nextjs.org/) with the App Router
- [React 19](https://react.dev/)
- [Tailwind CSS 4](https://tailwindcss.com/)
- [Motion](https://motion.dev/) for scroll reveals
- [Lucide](https://lucide.dev/) for icons
- YouTube Data API v3 for video and creator metadata

## Requirements

- Node.js 22 or newer
- npm
- A YouTube Data API v3 key for the media section

## Local Development

Install dependencies:

```bash
npm install
```

Copy the example environment file and add your project values:

```bash
cp .env.example .env.local
```

```env
YOUTUBE_API_KEY=your_api_key
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
SUPABASE_SECRET_KEY=your_secret_key
SUPABASE_ADMIN_EMAILS=owner@example.com
```

Environment files are ignored by Git. Do not commit API keys or other secrets.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available Scripts

```bash
npm run dev    # Start the development server
npm run lint   # Run ESLint
npm run build  # Create a production build
npm run start  # Start the production server
```

Before pushing changes, run:

```bash
npm run lint
npm run build
```

## Authentication

The `/login` page uses [Supabase Auth](https://supabase.com/docs/guides/auth) for Google, Discord, and passwordless email sign-in.

1. Create a Supabase project and copy its project URL and publishable key into `.env.local`.
2. Enable Google and Discord under **Authentication → Providers** and add the OAuth credentials from each provider.
3. Add `http://localhost:3000/auth/callback` and your production `/auth/callback` URL to the Supabase redirect allow list under **Authentication → URL Configuration**.
4. Configure the site URL in Supabase for the environment you are running.

The OAuth providers also require their Supabase callback URL (shown in the provider settings) to be allow-listed in the Google/Discord developer console.

### Supabase database migrations

Apply the SQL files in `supabase/migrations/` to the Supabase project in filename order. For a new project, open **SQL Editor** in the Supabase dashboard and run `202608240001_create_server_settings.sql`. This creates the RLS-protected global display-name overrides used by live server management. Browser roles receive no direct table privileges; the website accesses it only with `SUPABASE_SECRET_KEY` after reauthenticating and authorizing each rename.

### Member administration

The protected `/admin` page lists Supabase Auth users, searches by member information, and stores one of `Admin`, `Server Manager`, `Standard Server`, `Premium Server`, `Developer`, `Helper`, or `User` in each user's protected `app_metadata.role`.

To enable it:

1. Copy the server-only Supabase secret key from **Project Settings → API Keys** into `SUPABASE_SECRET_KEY`. Never use this value in a `NEXT_PUBLIC_` variable or browser component.
2. Set `SUPABASE_ADMIN_EMAILS` to the email address of the first administrator. Multiple bootstrap administrators may be comma-separated.
3. Restart the development server, sign in using that email, and open `/admin`.

Bootstrap administrators always retain admin access, preventing an accidental total lockout. Assigned roles take effect after the user's Auth session refreshes or they sign in again.

### Server hosting preview

The public `/servers` page provides the server directory, while server management remains role-protected:

- Everyone can browse, search, filter, and join servers without signing in.
- Signed-in `Admin` and `Server Manager` members can manage every placeholder hosted server and view its assigned account.
- Signed-in `Standard Server` and `Premium Server` members see the placeholder management experience for their plan.
- Start, stop, restart, runtime status, and log streaming are simulated in the browser and reset on refresh.
- The cron-restart toggle reveals an editable five-field UTC expression while enabled, initially `0 4 * * *`.

The public directory and placeholder assigned-server records do not have a production control plane yet. Typed placeholder records—including fictitious account assignments—live in `src/app/lib/hosting/servers.ts` so those routes can be developed without implying production connectivity. Replace that repository and the local simulation when the infrastructure contract is ready.

A dormant IONOS adapter is retained, but its inventory panel and API calls are disabled while alternative hosting options are evaluated. The create-server Server Action rejects requests before contacting IONOS. `IONOS_MANAGEMENT_ENABLED=true` restores inventory management; billable creation additionally requires `IONOS_SERVER_CREATION_ENABLED=true`.

The placeholder design is documented in `docs/server-hosting-design.md`.

### Live server console

Configured live Bannerlord containers hosted at `15.204.120.17` appear under **My Servers** on `/servers`. Administrators see every configured server and can assign each one owner account. Owners can add and remove operator accounts; owners and operators receive the same protected Start, Stop, Restart, Update, log-stream, and stdin controls for their assigned server. Administrators and owners can also edit a server's globally persisted display name from its manage page after the `server_settings` migration is applied. These servers are not IONOS resources.

Update pulls the configured image, treats an unchanged digest as a no-op, and otherwise recreates only the allowlisted game container after validating its deployment specification. The old container is retained until the replacement passes the configured readiness marker; failed readiness triggers verified automatic rollback.

The browser authenticates over WSS to `services/console-gateway`, which validates the current Supabase administrator role or server-specific owner/operator assignment and bridges to one persistent outbound WSS connection from `services/bannerlord-node-agent` on the VPS. Assignments are protected Supabase Auth `app_metadata` maintained only through server actions using `SUPABASE_SECRET_KEY`. One agent can manage multiple server-specific container, volume, and UDP-port allowlists. Node credentials remain server-only. Deployment and security boundaries are documented in `docs/live-server-console-design.md`.

## Environment Variables

### `NEXT_PUBLIC_SUPABASE_URL`

Public URL for the Supabase project used by the browser and server auth clients.

### `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Supabase publishable key. Despite being browser-visible, row-level security and Auth policies must still protect project data. Never substitute the service-role key.

### `SUPABASE_SECRET_KEY`

Server-only Supabase secret key used by protected member-role and live-server assignment actions to list users and update `app_metadata`. Never expose or commit it.

### `SUPABASE_ADMIN_EMAILS`

Comma-separated bootstrap administrator emails. These users always have admin access and cannot be demoted through the member administration page.

### IONOS management

`IONOS_MANAGEMENT_ENABLED` controls whether the dormant IONOS inventory is loaded and displayed. `IONOS_SERVER_CREATION_ENABLED` separately enables billable creation and has no effect unless management is enabled. Both default to disabled.

`IONOS_TOKEN_ID` and `IONOS_CLOUD_API_TOKEN` are server-only provider credentials. `IONOS_LOCATION` and `IONOS_IMAGE_ALIAS` configure provisioning defaults when management and creation are explicitly enabled.

### `CONSOLE_GATEWAY_URL`

Server-only WSS browser endpoint for the external live console, including `/v1/browser`. Production values must use `wss://`; only localhost development may use `ws://`. `CONSOLE_SERVER_CATALOG` optionally supplies the live multi-server catalog. Administrators see the complete catalog; owners and operators see only assigned entries. Node-agent credentials and per-server Docker resource allowlists are configured separately under `services/` and must never use a `NEXT_PUBLIC_` variable.

### `YOUTUBE_API_KEY`

Server-only YouTube Data API v3 key used to retrieve:

- Video titles, descriptions, thumbnails, channels, and durations
- Creator names, descriptions, profile pictures, and channel links

The key is read only in `src/app/lib/youtube.ts`. Do not prefix it with `NEXT_PUBLIC_`, because that would expose it to browser code.

YouTube responses are cached for 24 hours.

## Community Data

The community statistic cards and server browser currently show an unavailable state. Their components and types are kept in place for the future game integration:

```text
src/app/components/home/community/
src/app/components/utils/types/server.types.ts
```

The planned data flow is:

```text
Bannerlord dedicated servers
        → central HTTPS registry API
        → Next.js website
```

Do not replace the unavailable state with mock production values. Live values should be introduced when the registry API contract and hosting are ready.

## Media Configuration

Official YouTube links and approved creator channel IDs are configured in:

```text
src/app/components/home/media/CommunityMedia.tsx
```

Videos require only a YouTube URL:

```ts
{ href: "https://www.youtube.com/watch?v=VIDEO_ID" }
```

Creators require only a channel ID:

```ts
{ channelId: "UC_CHANNEL_ID" }
```

The server-side YouTube utility retrieves the remaining metadata.

## Project Structure

```text
src/app/
├── components/
│   ├── home/       Homepage sections and interactive media
│   ├── layout/     Navbar and footer
│   ├── motion/     Shared animation components
│   └── utils/      Shared TypeScript types
├── lib/            Server-only integrations
├── globals.css     Tailwind theme and global styles
├── layout.tsx      Fonts and site metadata
└── page.tsx        Homepage composition
```

## Related Links

- [Bannerlord Coop repository](https://github.com/Bannerlord-Coop-Team/BannerlordCoop)
- [Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3770450698)
- [Discord](https://discord.gg/bannerlordcoop)
- [ModDB](https://www.moddb.com/mods/bannerlord-coop)

## Disclaimer

Bannerlord Coop is an independent community project and is not affiliated with or endorsed by TaleWorlds Entertainment.
