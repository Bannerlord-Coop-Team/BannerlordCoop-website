create table public.homepage_creators (
    id uuid primary key default gen_random_uuid(),
    source text not null check (source in ('youtube', 'custom')),
    channel_id text unique,
    sort_order integer not null default 0,
    published boolean not null default true,
    name text,
    description text not null default '',
    avatar text,
    href text unique,
    created_at timestamptz not null default now(),
    constraint homepage_creators_youtube_channel check (
        source <> 'youtube' or (channel_id ~ '^UC[A-Za-z0-9_-]{22}$' and href is null)
    ),
    constraint homepage_creators_custom_profile check (
        source <> 'custom' or (
            channel_id is null
            and name is not null and length(trim(name)) > 0
            and href is not null and href ~ '^https://'
            and (avatar is null or avatar ~ '^https://')
        )
    )
);

comment on table public.homepage_creators is
    'Homepage featured creators in ascending sort_order. Public reads of published rows; privileged writes via MCP or the dashboard. YouTube profiles are fetched automatically from channel_id.';

alter table public.homepage_creators enable row level security;
revoke all on public.homepage_creators from anon, authenticated;
grant select on public.homepage_creators to anon, authenticated;
grant all on public.homepage_creators to service_role;
create policy "Published homepage creators are public"
    on public.homepage_creators for select to anon, authenticated
    using (published = true);

-- Seeds the creators previously hard-coded in CommunityMedia.tsx plus @Bokoen1, in display order.
-- The custom CaptainFRACAS row at sort_order 30 is inserted separately below.
insert into public.homepage_creators (source, channel_id, sort_order) values
    ('youtube', 'UCNjxbL33FhDGeIOp3vd3ndg', 10), -- @JackieFishHD
    ('youtube', 'UCi3M2mzQBc9sjfl1TzWCWgQ', 20), -- @ResonantRTS
    ('youtube', 'UC5gsrZTtWG_AqDFmuq81Q-w', 40), -- @RimmyDownunder
    ('youtube', 'UC45a_j76kNDwJvbc2ufOkJg', 50), -- @PixelatedApollo
    ('youtube', 'UCnQC_XGCCI__qrxwgZS27-A', 60), -- @Bokoen1
    ('youtube', 'UC9sy-WPppdluS2q3crOaFpA', 70); -- Bannerlord Co-op

insert into public.homepage_creators (source, sort_order, name, avatar, href) values (
    'custom',
    30,
    'CaptainFRACAS',
    'https://static-cdn.jtvnw.net/jtv_user_pictures/7fb66af7-a0be-437b-9cb0-6332fa5b9a92-profile_image-300x300.png',
    'https://www.twitch.tv/captainfracas'
);
