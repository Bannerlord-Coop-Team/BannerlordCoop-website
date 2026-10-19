# Homepage featured videos

The homepage carousel reads `public.homepage_videos` in Supabase. Manage rows through Supabase MCP (`execute_sql`) or the dashboard; no website deployment is needed for subsequent list edits. The initial frontend change still needs deployment.

- `source`: `youtube` (automatic YouTube metadata) or `custom` (manual metadata).
- `href`: HTTPS video link. YouTube links use `https://www.youtube.com/watch?v=VIDEO_ID`, optionally followed by `&t=1615s`. Tracking parameters are not stored. Start times are preserved when opening the video.
- `published_at`: original publication timestamp with timezone. Videos sort newest first; unknown (`NULL`) dates sort last. This is separate from `created_at` (when the database row was added) and `published` (visibility).
- `sort_order`: ascending tie-breaker for equal or unknown publication dates; use gaps such as 10, 20, 30. Remaining ties are ordered by row UUID.
- `published`: false hides the entry, including from anonymous API reads.
- Custom videos require `title`, `thumbnail`, and `thumbnail_alt`. Optional fields: `description`, `category`, `duration`.
- Custom thumbnail hosts must also be allowed by `next.config.ts` for Next Image.

Example privileged MCP SQL:

```sql
insert into public.homepage_videos (source, href, sort_order, published_at)
values ('youtube', 'https://www.youtube.com/watch?v=VIDEO_ID_11', 90,
        '2026-09-10T12:00:00Z'); -- replace with the verified original post timestamp

update public.homepage_videos
set published = false
where href = 'https://www.youtube.com/watch?v=VIDEO_ID_11';
```

When adding a video, set `published_at` through MCP/the dashboard using its verified publication date: YouTube Data API `snippet.publishedAt` (requires an API key) or public watch-page `publishDate` metadata; Twitch page `og:video:release_date`. The eight existing videos were backfilled from public metadata. Future dates are not automatically written by the website; leave the field NULL if unknown rather than guessing or using the insertion date. Title/thumbnail fetching remains automatic for YouTube.

Anonymous and signed-in website users have SELECT access only, restricted by RLS to published rows. Privileged MCP/database administrators and the service role can edit. The website uses the publishable key, not a secret key.

The list revalidates on requests after 60 seconds (Next.js may serve a stale response while refreshing); YouTube metadata retains its existing 24-hour cache. If the list is unavailable or empty, the carousel is omitted. The hero trailer and creator list are unchanged.

Validation: `npx tsx --test src/app/lib/homepage-videos.test.mjs` (Node 22.15+ or 24, for module hooks).

Thumbnail `sizes` in `VideoCarousel.tsx` follows `.site-container` in `globals.css`: 2rem mobile gutters, 3rem from 640px, 6rem from 1024px, and the 3rem short-landscape override. At 1024px the cards form two columns with a 1rem gap; the container caps at 1280px. The hint also subtracts the card's two 1px borders (a capped image is 630px wide at the default font size). Update these together when changing the layout; both the one/two-video grid and scrolling carousel use the same image hint.

For sizing changes, run:

```sh
npm run test:components -- src/app/components/home/media/VideoCarousel.component.test.tsx src/app/components/home/home-localization.component.test.tsx
npm run test:e2e -- --project=desktop video-carousel.desktop.spec.ts
```

The browser regression uses actual component markup and compiled site CSS with known-size SVG candidates. It checks both sides of 640px/1024px, the container cap, and the short-landscape 700px height boundary for grid/carousel layouts at 1x/2x DPR, without requiring external media data. This is layout evidence, not an optimizer bandwidth test.

Separately compare `currentSrc`, rendered dimensions, decoded image dimensions and actual response bytes at 1024px/2560px and 1x/2x DPR with representative media. Candidate width is not a bandwidth measurement: source limits, optimizer format, cache state and browser selection all matter. Do not substitute the source file size for optimizer transfer bytes.
