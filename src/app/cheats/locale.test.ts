import assert from "node:assert/strict";
import test from "node:test";
import commandsData from "./commands.json";
import { debugOnlyCommandNames, isPublishedCheat } from "./debugOnly";
import { featuredCommandNames } from "./featured";
import { parseCheatsLocale } from "./locale";
import { getCheatsMessages, localizedCategory, localizedCommandSummary } from "./locales";
import { buildCheatsPath, parseCheatsQuery } from "./query";

const commands = commandsData.commands as Array<{
    command: string;
    name: string;
    category: string;
    summary: string;
}>;

test("warns that vanilla campaign. cheats are disabled", () => {
    const en = getCheatsMessages("en").ui.vanillaCampaignWarning;
    const zh = getCheatsMessages("zh-CN").ui.vanillaCampaignWarning;

    assert.deepEqual(en, [
        { text: "Vanilla cheats prefixed " },
        { code: "campaign." },
        { text: " are DISABLED and cannot be used." },
    ]);
    assert.ok(zh.some((part) => "code" in part && part.code === "campaign."));
    assert.ok(zh.some((part) => "text" in part && part.text.includes("已禁用")));
});

test("parses simplified chinese locale aliases", () => {
    assert.equal(parseCheatsLocale("zh"), "zh-CN");
    assert.equal(parseCheatsLocale("zh-CN"), "zh-CN");
    assert.equal(parseCheatsLocale("zh_hans"), "zh-CN");
    assert.equal(parseCheatsLocale("en"), "en");
    assert.equal(parseCheatsLocale(undefined), "en");
});

test("keeps english cheats links clean and adds lang for chinese", () => {
    assert.equal(buildCheatsPath(parseCheatsQuery({})), "/cheats");
    assert.equal(buildCheatsPath(parseCheatsQuery({ lang: "zh-CN" })), "/cheats?lang=zh-CN");
});

test("covers every command category and featured summary in simplified chinese", () => {
    const zh = getCheatsMessages("zh-CN");
    const categories = new Set(commands.map((command) => command.category));

    for (const category of categories) {
        assert.equal(typeof zh.categories[category], "string", category);
        assert.ok(zh.categories[category].trim(), category);
    }

    for (const command of commands) {
        const overlay = zh.commands[command.command];
        assert.ok(overlay, command.command);
        assert.ok(overlay.name.trim(), command.command);
        assert.ok(overlay.summary.trim(), command.command);
        assert.equal(localizedCategory(command.category, zh), zh.categories[command.category]);
    }

    for (const command of featuredCommandNames) {
        const source = commands.find((item) => item.command === command);
        assert.ok(source, command);
        assert.equal(localizedCommandSummary(source, zh), zh.commands[command].summary);
        assert.equal(localizedCommandSummary(source, getCheatsMessages("en")), source.summary);
    }
});

test("does not catalog debug-only commands", () => {
    for (const command of debugOnlyCommandNames) {
        assert.equal(
            commands.some((item) => item.command === command),
            false,
            command,
        );
    }
});

test("keeps featured commands publishable", () => {
    for (const command of featuredCommandNames) {
        const source = commands.find((item) => item.command === command);
        assert.ok(source, command);
        assert.equal(isPublishedCheat(source), true, command);
    }
});

test("catalog preserves PR3538 metadata, usage and localized argument coverage", () => {
    assert.equal(commandsData.source.commit, "4d030c26c49b271e77676179571e120698f42f52");
    assert.equal(commandsData.count, commandsData.commands.length);
    assert.equal(commandsData.count, 400);
    assert.equal(new Set(commandsData.commands.map(c => c.command)).size, commandsData.count);
    assert.equal(commandsData.categories.reduce((sum, c) => sum + c.count, 0), commandsData.count);
    const zh = getCheatsMessages("zh-CN");
    assert.deepEqual(Object.keys(zh.commands).sort(), commandsData.commands.map(c => c.command).sort());
    for (const command of commandsData.commands) {
        assert.match(command.command, /^coop(?:\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*)+$/);
        assert.equal(command.command, `${command.group}.${command.name}`);
        assert.ok(isPublishedCheat(command), command.command);
        assert.deepEqual(command.aliases, [], command.command);
        assert.equal(command.usage, command.command + command.arguments.map(a => a.required ? ` <${a.name}>` : ` [<${a.name}>]`).join(""));
        assert.deepEqual(Object.keys(zh.commands[command.command].arguments), command.arguments.map(a => a.name));
        for (const argument of command.arguments) {
            assert.match(zh.commands[command.command].arguments[argument.name], /[\u3400-\u9fff]|^(on|success|Pause|state|open)/);
        }
    }
    const heroId = commandsData.commands.find(c => c.command === "coop.debug.hero.id")!;
    assert.ok(heroId, "Includes IHeroIdCommand : ICoopCommand implementations");
    assert.equal(heroId.summary, "Finds registered ids for heroes with an exact display name.");
    assert.equal(heroId.side, "either");
    assert.equal(heroId.kind, "inspect");
    assert.equal(heroId.usage, "coop.debug.hero.id <heroName>");
    assert.equal(zh.commands[heroId.command].arguments.heroName, "要查找的英雄的完整显示名称。包含多个词的值需加双引号。");
    const gold = commandsData.commands.find(c => c.command === "coop.debug.hero.set_gold")!;
    assert.equal(gold.side, "server");
    assert.equal(gold.summary, "Sets gold for every hero with an exact display name on the server.");
    assert.equal(commandsData.commands.find(c => c.command === "coop.debug.hero.list")!.side, "either");
    assert.equal(commandsData.commands.find(c => c.command === "coop.delete_player")!.side, "client");
    assert.equal(getCheatsMessages("en").ui.sideEither, "Both");
});

test("featured share links round-trip canonical snake-case commands in both locales", () => {
    for (const lang of ["en", "zh-CN"] as const) {
        for (const cheat of featuredCommandNames) {
            const path = buildCheatsPath(parseCheatsQuery({ cheat, lang }));
            const query = parseCheatsQuery(Object.fromEntries(new URL(path, "https://example.com").searchParams));
            assert.equal(query.cheat, cheat);
            assert.equal(query.lang, lang);
        }
    }
});

test("documentation examples reference published commands", () => {
    for (const lang of ["en", "zh-CN"] as const) {
        for (const part of getCheatsMessages(lang).ui.findingIdsParagraphs.flat()) {
            if ("code" in part && part.code.startsWith("coop.")) {
                assert.ok(commands.some(c => c.command === part.code.split(" ")[0]), part.code);
            }
        }
    }
});
