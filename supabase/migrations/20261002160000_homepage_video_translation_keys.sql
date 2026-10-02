-- Apply before deploying the media loader; keys translate presentation, never stored source values.
alter table public.homepage_videos add column description_translation_key text;
alter table public.homepage_videos add column thumbnail_alt_translation_key text;
alter table public.homepage_videos add column category_translation_key text;

-- Bind only unchanged editorial fields on the known Twitch seed, independent of row ID/order/access.
-- Later editorial changes require dictionary updates or clearing the affected key to show source prose.
update public.homepage_videos set description_translation_key = 'media.captainfracas-twitch.description'
where source = 'custom'
  and href = 'https://www.twitch.tv/videos/2827818732?t=04h20m50s'
  and description = 'Watch CaptainFRACAS play Bannerlord Coop at maximum difficulty, starting at the highlighted moment.'
  and description_translation_key is null;

update public.homepage_videos set thumbnail_alt_translation_key = 'media.captainfracas-twitch.thumbnailAlt'
where source = 'custom'
  and href = 'https://www.twitch.tv/videos/2827818732?t=04h20m50s'
  and thumbnail_alt = 'Bannerlord Coop Twitch VOD by CaptainFRACAS'
  and thumbnail_alt_translation_key is null;

update public.homepage_videos set category_translation_key = 'media.captainfracas-twitch.category'
where source = 'custom'
  and href = 'https://www.twitch.tv/videos/2827818732?t=04h20m50s'
  and category = 'CaptainFRACAS on Twitch'
  and category_translation_key is null;
