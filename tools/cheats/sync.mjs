import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const categoryGroups = {
    coop: "Player", battle: "Battles", alley: "Alleys", arenas: "Arenas", army: "Armies", besiegercamp: "Sieges",
    campaign_options: "Campaign options", mod_config: "Mod options", caravans: "Caravans",
    hero_developer: "Hero development", character_objects: "Characters", clan: "Clans", companions: "Companions",
    debug: "General", map_camera: "Map camera", game_thread: "Game thread", metrics: "Metrics", ui: "UI",
    hero: "Heroes", romance: "Romance", inventory: "Inventory", issues: "Issues", item_object: "Items",
    item_rosters: "Item rosters", kingdom: "Kingdoms", location: "Locations", map_event: "Map events",
    mapevent: "Map events", mobileparty: "Mobile parties", mobile_party: "Mobile parties", town: "Towns",
    party_visuals: "Party visuals", player_captivity: "Captivity", players: "Players", save: "Saves",
    settlements: "Settlements", settlement_component: "Settlements", siege: "Sieges", crafting: "Smithing",
    tournaments: "Tournaments", steam: "Steam", village: "Villages", villagers: "Villager parties", workshop: "Workshops",
};

export function buildCatalog(raw) {
    const commands = raw.commands.filter(c => !c.command.includes("fixture")).map(c => {
        const category = categoryGroups[c.group.split(".").at(-1)];
        if (!category) throw new Error(`Unknown category: ${c.group}`);
        if (!["server", "client", "either"].includes(c.side)) throw new Error(`Unknown side: ${c.command}`);
        const kind = /^(Lists|Reports|Dumps|Describes|Finds)\b/.test(c.summary) ? "inspect" : /^Audits\b/.test(c.summary) ? "audit" : "action";
        const usage = c.command + c.arguments.map(a => a.required ? ` <${a.name}>` : ` [<${a.name}>]`).join("");
        return { ...c, category, kind, usage, aliases: [] };
    }).sort((a, b) => a.category.localeCompare(b.category, "en") || a.command.localeCompare(b.command, "en"));
    const categories = [...new Set(commands.map(c => c.category))].map(name => ({ name, count: commands.filter(c => c.category === name).length }));
    return {
        source: { repository: "https://github.com/Bannerlord-Coop-Team/BannerlordCoop", commit: raw.commit,
            assemblies: ["GameInterface", "Missions"], configuration: "Release", registeredCount: raw.commands.length,
            excludedFixtureCount: raw.commands.length - commands.length,
            debugOnlyCommands: [...raw.debugOnly].sort() },
        count: commands.length, categories, commands,
    };
}

export function buildTranslations(catalog, translations) {
    const translate = text => {
        const value = translations[text];
        if (!value?.trim()) throw new Error(`Missing zh-CN translation: ${text}`);
        return value;
    };
    return Object.fromEntries(catalog.commands.map(c => [c.command, {
        name: translate(c.summary), summary: translate(c.summary),
        arguments: Object.fromEntries(c.arguments.map(a => [a.name, translate(a.description)])),
    }]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [repo, commit, mode] = process.argv.slice(2);
    if (!repo || !/^[a-f0-9]{40}$/.test(commit ?? "") || (mode && mode !== "--check"))
        throw new Error("Usage: node tools/cheats/sync.mjs <mod-repo> <40-character-commit> [--check]");
    const raw = JSON.parse(execFileSync("dotnet", ["run", "--project", "tools/cheats", "--", repo, commit], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }));
    const catalog = buildCatalog(raw);
    const translations = JSON.parse(readFileSync("tools/cheats/zh-CN.json", "utf8"));
    const outputs = {
        "src/app/cheats/commands.json": catalog,
        "src/app/cheats/locales/zh-CN.commands.json": buildTranslations(catalog, translations),
    };
    for (const [path, data] of Object.entries(outputs)) {
        const content = JSON.stringify(data, null, 2) + "\n";
        if (mode === "--check") {
            if (readFileSync(path, "utf8").replace(/\r\n/g, "\n") !== content) throw new Error(`Outdated catalog: ${path}`);
        } else writeFileSync(path, content);
    }
    console.log(`${catalog.count} published commands, ${raw.commands.length} release registrations, ${raw.debugOnly.length} DEBUG-only commands.`);
}
