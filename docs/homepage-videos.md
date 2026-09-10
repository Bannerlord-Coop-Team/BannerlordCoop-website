# Homepage featured videos

The homepage carousel reads `public.homepage_videos` in Supabase. Manage rows through Supabase MCP (`execute_sql`) or the dashboard; no website deployment is needed for subsequent list edits. The initial frontend change still needs deployment.

- `source`: `youtube` (automatic YouTube metadata) or `custom` (manual metadata).
- `href`: HTTPS video link. YouTube links use `https://www.youtube.com/watch?v=VIDEO_ID`, optionally followed by `&t=1615s`. Tracking parameters are not stored. Start times are preserved when opening the video.
- `sort_order`: ascending display order; use gaps such as 10, 20, 30. Ties are ordered by row UUID.
- `published`: false hides the entry, including from anonymous API reads.
- Custom videos require `title`, `thumbnail`, and `thumbnail_alt`. Optional fields: `description`, `category`, `duration`.
- Custom thumbnail hosts must also be allowed by `next.config.ts` for Next Image.

Example privileged MCP SQL:

```sql
insert into public.homepage_videos (source, href, sort_order)
values ('youtube', 'https://www.youtube.com/watch?v=VIDEO_ID_11', 90);

update public.homepage_videos
set published = false
where href = 'https://www.youtube.com/watch?v=VIDEO_ID_11';
```

Anonymous and signed-in website users have SELECT access only, restricted by RLS to published rows. Privileged MCP/database administrators and the service role can edit. The website uses the publishable key, not a secret key.

The list revalidates on requests after 60 seconds (Next.js may serve a stale response while refreshing); YouTube metadata retains its existing 24-hour cache. If the list is unavailable or empty, the carousel is omitted. The hero trailer and creator list are unchanged.

Validation: `npx tsx --test src/app/lib/homepage-videos.test.mjs` (Node 22.15+ or 24, for module hooks).
