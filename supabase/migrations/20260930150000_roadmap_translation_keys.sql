-- Add explicit semantic translation identities without rewriting source prose or row state.
alter table public.roadmap_milestones add column title_translation_key text;
alter table public.roadmap_items add column title_translation_key text;
alter table public.roadmap_items add column description_translation_key text;

-- Match only known checked-in seed prose. Edited/new content stays visible in its source language.

update public.roadmap_milestones set title_translation_key = 'roadmap.milestone.v0-1.title'
where title = 'v0.1' and title_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.player-movement.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Player Movement' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.map-encounters.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Map Encounters' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.trading.title', description_translation_key = 'roadmap.item.trading.description'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Trading' and description = '(Disabled for player to player)'
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.caravans.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Caravans' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.villager-parties.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Villager Parties' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.ai-movement.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'AI Movement' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.party-management.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Party Management' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.player-captivity.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Player Captivity' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.simulated-coop-battles.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Simulated Coop Battles' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.steam-integration.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Steam Integration' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.troop-recruitment.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Troop Recruitment' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.ai-battles.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'AI Battles' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.settlement-management.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Settlement Management' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.field-battles.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Field Battles' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.dedicated-server.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Dedicated Server' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.player-gold.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Player gold' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.smithy.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Smithy' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.players-visible-in-locations.title', description_translation_key = 'roadmap.item.players-visible-in-locations.description'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Players visible in locations' and description = '(taverns/town hall/etc...)'
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.kingdom-management.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Kingdom Management' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.pvp.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'PVP' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.ai-party-creation.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'AI Party Creation' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.character-management.title', description_translation_key = 'roadmap.item.character-management.description'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Character Management' and description = '(Skills/etc...)'
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.clan-management.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v0.1')
  and title = 'Clan Management' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_milestones set title_translation_key = 'roadmap.milestone.v1-0.title'
where title = 'v1.0' and title_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.arena.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'Arena' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.linux-support.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'Linux Support' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.player-trading.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'Player trading' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.marriage-death.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'Marriage & Death' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.tournaments.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'Tournaments' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.alleys.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'Alleys' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.gamepass-support.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'GamePass Support' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.sieges.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'Sieges' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.village-raids.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'Village Raids' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.hideout.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'Hideout' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.sallyout.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'SallyOut' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.armies.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v1.0')
  and title = 'Armies' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_milestones set title_translation_key = 'roadmap.milestone.v2-0.title'
where title = 'v2.0' and title_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.warsails-dlc.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v2.0')
  and title = 'Warsails DLC' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.quests.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v2.0')
  and title = 'Quests' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_milestones set title_translation_key = 'roadmap.milestone.v3-0.title'
where title = 'v3.0' and title_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.mod-support.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v3.0')
  and title = 'Mod Support' and description = ''
  and title_translation_key is null and description_translation_key is null;

update public.roadmap_items set title_translation_key = 'roadmap.item.localization.title'
where milestone_id in (select id from public.roadmap_milestones where title = 'v3.0')
  and title = 'Localization' and description = ''
  and title_translation_key is null and description_translation_key is null;
