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

## Managed read-only console

Managed server owner/manager pages include an explicit Connect/Disconnect live-output panel. The browser connects only to the same-origin `/api/servers/[serverId]/console` route. That route revalidates the current Supabase user/session and forwards only the bearer token and validated server UUID to the fixed server-only `CONTROL_PLANE_CONSOLE_ORIGIN`; callers cannot select an upstream destination, actor, agent, process, or path.

The response is private, unbuffered SSE with a five-minute maximum session and no automatic reconnect or history. The UI retains at most 128 KiB and 2,000 lines. Production enablement still requires verified OpenNext/Cloudflare streaming and disconnect behavior plus the reviewed Oracle Caddy route; local mocks do not establish those deployment properties.

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

Apply reviewed SQL migrations in their coordinated rollout order. Applied migration history remains immutable, including historical external-console tables and RPCs. The website no longer reads or writes those legacy objects; this source removal does not drop production data or rewrite Auth metadata.

### Member administration

The protected `/admin` page lists Supabase Auth users, searches by member information, and stores one of `Admin`, `Server Manager`, `Standard Server`, `Premium Server`, `Developer`, `Helper`, or `User` in each user's protected `app_metadata.role`.

To enable it:

1. Copy the server-only Supabase secret key from **Project Settings → API Keys** into `SUPABASE_SECRET_KEY`. Never use this value in a `NEXT_PUBLIC_` variable or browser component.
2. Set `SUPABASE_ADMIN_EMAILS` to the email address of the first administrator. Multiple bootstrap administrators may be comma-separated.
3. Restart the development server, sign in using that email, and open `/admin`.

Bootstrap administrators always retain admin access, preventing an accidental total lockout. Assigned roles take effect after the user's Auth session refreshes or they sign in again.

### Control Plane administration

The protected `/admin/control-plane` page is the administrative surface for managed hosting. It reads fleet/server/job/release/audit state and submits the complete supported administrator operation set through the `control-plane-admin` Supabase Edge Function. The function reauthenticates the current Discord administrator and relays the typed request to the Oracle control-plane web adapter. The website does not query the private control-plane schema or talk directly to OVH, runners, containers, or object storage. See `docs/control-plane-admin.md` and the control-plane repository's `docs/managed-hosting/web-admin.md`.

### Legacy server hosting preview

The legacy placeholder implementation (not the current authenticated My Servers/onboarding flow below) provides these simulated behaviors:

- Everyone can browse, search, filter, and join servers without signing in.
- Signed-in `Admin` and `Server Manager` members can manage every placeholder hosted server and view its assigned account.
- Signed-in `Standard Server` and `Premium Server` members see the placeholder management experience for their plan.
- Start, stop, restart, runtime status, and log streaming are simulated in the browser and reset on refresh.
- The cron-restart toggle reveals an editable five-field UTC expression while enabled, initially `0 4 * * *`.

The public directory and legacy placeholder assigned-server records remain fixtures. Typed placeholder records—including fictitious account assignments—live in `src/app/lib/hosting/servers.ts`; they are not evidence of current account assignments or onboarding eligibility.

A dormant IONOS adapter is retained, but its inventory panel and API calls are disabled while alternative hosting options are evaluated. The create-server Server Action rejects requests before contacting IONOS. `IONOS_MANAGEMENT_ENABLED=true` restores inventory management; billable creation additionally requires `IONOS_SERVER_CREATION_ENABLED=true`.

The placeholder design is documented in `docs/server-hosting-design.md`.

### Managed-server onboarding

The current `/servers` page loads authenticated managed assignments from the control plane using registered server UUIDs. New setup uses **unused explicitly granted quota**, not membership or role claims. Available regions create an assigned stopped server; full regions accept private durable requests through the existing authenticated `my-servers` Edge Function. The public directory loads the anonymous `public-servers` endpoint independently of private inventory.

See [website server onboarding](docs/server-onboarding.md) for the strict contract, exact-request recovery, Discord password controls, mock-only screenshots/tests and required **schema → backend → my-servers Edge → UI** rollout order. Nothing in this implementation deploys those layers automatically.

### Managed server console

**My Servers** uses authenticated control-plane assignments only. Manage a server using its registered `/servers/<UUID>` route. Unknown and retired server IDs return signed-in visitors to `/servers`; no static alias, IP address or display name is used to associate a legacy server with a managed record.

Owners and managers use the existing read-only HTTP/SSE console plus managed lifecycle controls and log downloads. Support and administrator assignments remain read-only and do not connect to console streaming. Managed backup, save/configuration transfer, visibility and release settings retain their existing authorization boundaries. Server names are displayed from the control-plane record; renaming is not supported.

The legacy external WebSocket console, catalog, owner/operator assignment actions, rename actions, gateway, Docker node agent, deployment recipes and `/servers/live/<id>` redirect route have been removed. This source change does not stop an existing deployment, erase historical account metadata, or commission the managed SSE endpoint. Command submission is separate work (PR #185), not part of this removal.

Configure `CONTROL_PLANE_CONSOLE_ORIGIN` with the fixed HTTPS control-plane origin. Its `/v1/user/console-stream` adapter and production proxy route must be commissioned separately before streaming is available.

## Environment Variables

### `NEXT_PUBLIC_SUPABASE_URL`

Public URL for the Supabase project used by the browser and server auth clients.

### `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Supabase publishable key. Despite being browser-visible, row-level security and Auth policies must still protect project data. Never substitute the service-role key.

### `SUPABASE_SECRET_KEY`

Server-only Supabase secret key used by protected member-role administration to list users and update member roles. Never expose or commit it.

### `SUPABASE_ADMIN_EMAILS`

Comma-separated bootstrap administrator emails. These users always have admin access and cannot be demoted through the member administration page.

### IONOS management

`IONOS_MANAGEMENT_ENABLED` controls whether the dormant IONOS inventory is loaded and displayed. `IONOS_SERVER_CREATION_ENABLED` separately enables billable creation and has no effect unless management is enabled. Both default to disabled.

`IONOS_TOKEN_ID` and `IONOS_CLOUD_API_TOKEN` are server-only provider credentials. `IONOS_LOCATION` and `IONOS_IMAGE_ALIAS` configure provisioning defaults when management and creation are explicitly enabled.

### `CONTROL_PLANE_CONSOLE_ORIGIN`

Server-only bare HTTPS origin for the managed read-only console proxy, for example `https://control-plane.example.com`. The website reauthenticates the user/session and forwards only the requested registered server ID to `/v1/user/console-stream`. The retired `CONSOLE_GATEWAY_URL` and `CONSOLE_SERVER_CATALOG` variables are no longer read and can be removed from deployment settings separately.

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

- [Patreon account linking](docs/patreon-account-linking.md)
- [Patreon Standard Server role sync and activation](docs/patreon-website-roles.md)

- [Bannerlord Coop repository](https://github.com/Bannerlord-Coop-Team/BannerlordCoop)
- [Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3770450698)
- [Discord](https://discord.gg/bannerlordcoop)
- [ModDB](https://www.moddb.com/mods/bannerlord-coop)

## Disclaimer

Bannerlord Coop is an independent community project and is not affiliated with or endorsed by TaleWorlds Entertainment.
