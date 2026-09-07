export const FEATURED_TAB = "featured";

export const featuredCommandNames: readonly string[] = [
    "coop.debug.players.list",
    "coop.debug.mobile_party.who_am_i",
    "coop.debug.hero.list",
    "coop.debug.town.list_towns",
    "coop.debug.village.list",
    "coop.debug.kingdom.list",
    "coop.debug.clan.list",
    "coop.debug.companions.list_wanderers",
    "coop.unstuck",
    "coop.debug.map_event.leave_settlement",
    "coop.delete_player",
    "coop.debug.mobile_party.siege_buff",
    "coop.debug.clan.add_renown",
    "coop.debug.clan.add_influence",
    "coop.debug.hero.set_gold",
    "coop.debug.hero.set_relation",
    "coop.debug.hero_developer.add_skill_xp",
    "coop.debug.hero_developer.add_attribute_points",
    "coop.debug.hero_developer.add_focus_points",
    "coop.debug.hero_developer.reset_skills",
    "coop.debug.crafting.give_supplies",
    "coop.debug.crafting.unlock_all_crafting_pieces",
    "coop.debug.kingdom.create",
    "coop.debug.kingdom.declare_war",
    "coop.debug.kingdom.make_peace",
    "coop.debug.settlements.set_owner_clan",
    "coop.debug.clan.remove_companion",
    "coop.debug.romance.start",
    "coop.debug.romance.compatible",
    "coop.debug.romance.agree",
    "coop.debug.romance.marry",
];

export function isFeaturedCommand(command: string) {
    return featuredCommandNames.includes(command);
}
