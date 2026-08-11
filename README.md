# Bannerlord Coop Website

The official website for [Bannerlord Coop](https://github.com/Bannerlord-Coop-Team/BannerlordCoop), a module that brings cooperative multiplayer to the Mount & Blade II: Bannerlord campaign.

## Tech Stack

- [Next.js 16](https://nextjs.org/) with the App Router
- [React 19](https://react.dev/)
- [Tailwind CSS 4](https://tailwindcss.com/)
- [Motion](https://motion.dev/) for scroll reveals
- [Lucide](https://lucide.dev/) for icons
- YouTube Data API v3 for video and creator metadata

## Requirements

- Node.js 20 or newer
- npm
- A YouTube Data API v3 key for the media section

## Local Development

Install dependencies:

```bash
npm install
```

Create a local environment file named `.env.local`:

```env
YOUTUBE_API_KEY=your_api_key
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

## Environment Variables

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