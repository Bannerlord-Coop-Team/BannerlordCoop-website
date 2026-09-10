alter table public.homepage_videos
    add column published_at timestamptz;

comment on column public.homepage_videos.published_at is
    'Original video publication timestamp, not the time this row was added. Newest first; unknown dates sort last.';

-- Publication timestamps verified from YouTube watch-page publishDate metadata
-- and Twitch og:video:release_date on 2026-09-10. Match video IDs rather than
-- generated row UUIDs, and ignore optional YouTube start-time parameters.
update public.homepage_videos as video
set published_at = dates.published_at
from (values
    ('Au-oT5KKj0w', timestamptz '2026-08-29T10:39:37-07:00'),
    ('mJ7hZ0-BkZs', timestamptz '2026-07-31T14:14:34-07:00'),
    ('HNiozn0_FZs', timestamptz '2026-07-31T08:44:48-07:00'),
    ('PNBfJXMTHII', timestamptz '2026-07-31T07:00:28-07:00'),
    ('6Y9rNAQN8Jg', timestamptz '2026-07-30T07:00:37-07:00'),
    ('U0F0LIfOBYQ', timestamptz '2026-07-29T07:00:33-07:00'),
    ('96Wt58y8x8c', timestamptz '2026-08-31T12:00:23-07:00')
) as dates(video_id, published_at)
where video.source = 'youtube'
    and split_part(split_part(video.href, '?v=', 2), '&', 1) = dates.video_id;

update public.homepage_videos
set published_at = timestamptz '2026-07-24T13:03:32Z'
where source = 'custom'
    and split_part(href, '?', 1) = 'https://www.twitch.tv/videos/2827818732';
