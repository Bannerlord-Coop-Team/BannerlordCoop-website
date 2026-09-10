create table public.homepage_videos (
    id uuid primary key default gen_random_uuid(),
    source text not null check (source in ('youtube', 'custom')),
    href text not null unique check (href ~ '^https://'),
    sort_order integer not null default 0,
    published boolean not null default true,
    title text,
    description text not null default '',
    thumbnail text,
    thumbnail_alt text,
    category text not null default '',
    duration text,
    created_at timestamptz not null default now(),
    constraint homepage_videos_youtube_url check (
        source <> 'youtube' or href ~ '^https://(www\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}(&t=[0-9]+s?)?$'
    ),
    constraint homepage_videos_custom_metadata check (
        source <> 'custom' or (
            title is not null and length(trim(title)) > 0
            and thumbnail is not null and thumbnail ~ '^https://'
            and thumbnail_alt is not null and length(trim(thumbnail_alt)) > 0
        )
    )
);

comment on table public.homepage_videos is
    'Homepage featured videos. Public reads of published rows; privileged writes via MCP or the dashboard. YouTube metadata is fetched automatically.';

alter table public.homepage_videos enable row level security;
revoke all on public.homepage_videos from anon, authenticated;
grant select on public.homepage_videos to anon, authenticated;
grant all on public.homepage_videos to service_role;
create policy "Published homepage videos are public"
    on public.homepage_videos for select to anon, authenticated
    using (published = true);

insert into public.homepage_videos (source, href, sort_order) values
    ('youtube', 'https://www.youtube.com/watch?v=Au-oT5KKj0w&t=1615s', 10),
    ('youtube', 'https://www.youtube.com/watch?v=mJ7hZ0-BkZs', 20),
    ('youtube', 'https://www.youtube.com/watch?v=HNiozn0_FZs', 30),
    ('youtube', 'https://www.youtube.com/watch?v=PNBfJXMTHII', 40),
    ('youtube', 'https://www.youtube.com/watch?v=6Y9rNAQN8Jg', 50),
    ('youtube', 'https://www.youtube.com/watch?v=U0F0LIfOBYQ', 60),
    ('youtube', 'https://www.youtube.com/watch?v=96Wt58y8x8c&t=2s', 80);

insert into public.homepage_videos
    (source, href, sort_order, title, description, thumbnail, thumbnail_alt, category, duration)
values (
    'custom',
    'https://www.twitch.tv/videos/2827818732?t=04h20m50s',
    70,
    'Bannerlord Coop — L''empire contre-attaque!',
    'Watch CaptainFRACAS play Bannerlord Coop at maximum difficulty, starting at the highlighted moment.',
    'https://static-cdn.jtvnw.net/cf_vods/d3stzm2eumvgb4/95c2e4eed29530aa15e1_captainfracas_317326941667_1784898206//thumb/thumb0-640x360.jpg',
    'Bannerlord Coop Twitch VOD by CaptainFRACAS',
    'CaptainFRACAS on Twitch',
    '7:06:10'
);
