/**
 * Editorial map of published commands whose output prints ids that other
 * commands accept, keyed to the argument names those ids satisfy. Verified
 * against the mod source at the catalog pin; the catalog itself has no
 * output metadata. Town and village lists print component ids (`town_comp_*`),
 * which satisfy townId/villageId but not settlement arguments.
 */
export const idLookupOutputs: Readonly<Record<string, readonly string[]>> = {
    "coop.debug.players.list": ["controller_id", "hero_id", "party_id", "clan_id"],
    "coop.debug.hero.list": ["hero_id"],
    "coop.debug.hero.id": ["hero_id"],
    "coop.debug.alley.my_hero_id": ["hero_id"],
    "coop.debug.companions.list_wanderers": ["hero_id"],
    "coop.debug.town.list_towns": ["townId"],
    "coop.debug.village.list": ["villageId"],
    "coop.debug.kingdom.list": ["kingdom_id"],
    "coop.debug.clan.list": ["clan_id"],
    "coop.debug.mobileparty.list": ["party_id"],
    "coop.debug.army.list": ["army_id"],
    "coop.debug.army.mobile_party_list": ["party_id"],
    "coop.debug.location.list": ["locationId"],
    "coop.debug.character_objects.list": ["character_id"],
    "coop.debug.mobile_party.character_ids": ["character_id"],
    "coop.debug.inventory.item_ids": ["item_id"],
};
