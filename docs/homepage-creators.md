# Homepage featured creators

The homepage "Content creators" list reads `public.homepage_creators` in Supabase. Manage rows through Supabase MCP (`execute_sql`) or the dashboard; no website deployment is needed for list edits. Access matches [homepage videos](homepage-videos.md): anonymous and signed-in users can only SELECT published rows, and privileged MCP/database administrators and the service role can edit.

- `source`: `youtube` (name, avatar and description fetched from the YouTube Data API, 24-hour cache) or `custom` (manual profile, e.g. Twitch).
- `channel_id`: required for YouTube rows. Use the `UC…` channel ID (from the channel page source or a video's watch-page `channelId`), not the `@handle`. YouTube rows must leave `name`, `avatar`, `href` and `description` empty, because the API supplies them.
- `name`, `href` (HTTPS): required for custom rows. Optional: `description`, `avatar` (HTTPS on a host listed in `src/app/lib/remote-image-hosts.ts`, which feeds `next.config.ts`; a new host needs a deployment). An avatar on any other host is dropped with a server warning and the creator's initial is shown instead.
- `sort_order`: ascending display order; use gaps such as 10, 20, 30. Ties are ordered by row UUID.
- `published`: false hides the creator, including from anonymous API reads.

Example privileged MCP SQL:

```sql
insert into public.homepage_creators (source, channel_id, sort_order)
values ('youtube', 'UCxxxxxxxxxxxxxxxxxxxxxx', 65);

insert into public.homepage_creators (source, name, href, avatar, sort_order)
values ('custom', 'Streamer', 'https://www.twitch.tv/streamer', null, 75);
```

The list revalidates on requests after 60 seconds (Next.js may serve a stale response while refreshing). The table's CHECK constraints reject malformed rows when they are written, so an invalid edit fails in MCP or the dashboard rather than disappearing from the homepage. YouTube channels the API does not return are skipped. If the list is unavailable or empty, the section is omitted.

Validation: `npx tsx --test src/app/lib/homepage-creators.test.mjs src/app/lib/homepage-creator-migration.test.ts src/app/lib/featured-creators.test.ts src/app/lib/remote-image-hosts.test.ts src/app/lib/supabase/public-rows.test.mjs` (Node 22.15+ or 24, for module hooks).
