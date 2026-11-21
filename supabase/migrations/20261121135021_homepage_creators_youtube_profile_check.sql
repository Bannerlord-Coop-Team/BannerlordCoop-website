-- Tightens the YouTube row check from the table's first migration, which is already applied.
-- A NULL channel_id made the old check evaluate to NULL, which Postgres accepts, and YouTube rows
-- could store name/avatar/description values the site never reads (the YouTube API supplies them).
alter table public.homepage_creators
    drop constraint homepage_creators_youtube_channel,
    add constraint homepage_creators_youtube_channel check (
        source <> 'youtube' or (
            channel_id is not null
            and channel_id ~ '^UC[A-Za-z0-9_-]{22}$'
            and href is null
            and name is null
            and avatar is null
            and description = ''
        )
    );
