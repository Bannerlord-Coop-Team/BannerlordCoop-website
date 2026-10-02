import assert from "node:assert/strict";
import test from "node:test";
import commandsData from "./commands.json";
import { debugOnlyCommandNames, isPublishedCheat } from "./debugOnly";
import { featuredCommandNames } from "./featured";
import { parseCheatsLocale } from "./locale";
import en from "../lib/localization/dictionaries/en/cheats.json";
import zh from "./locales/zh-CN.json";
import chineseSource from "./locales/zh-CN.commands.json";
import { assertDictionaryParity } from "../lib/localization/integrity";
import { createTranslator } from "../lib/localization/translator";
import { buildCheatsPath, parseCheatsQuery } from "./query";

const commands = commandsData.commands;
const english = createTranslator("en", en);
const chinese = createTranslator("zh-CN", zh);

test("warns that vanilla campaign. cheats are disabled using a whole rich message", () => {
    assert.equal(english.t("ui.vanillaCampaignWarning", { prefix: "campaign." }), "Vanilla cheats prefixed campaign. are DISABLED and cannot be used.");
    assert.match(chinese.t("ui.vanillaCampaignWarning", { prefix: "campaign." }), /campaign\..*已禁用/);
});

test("parses all existing Chinese aliases and distinguishes absent overrides from English", () => {
    for (const value of ["zh", "zh-CN", "zh_hans", "zh-hans-cn", "cn", " ZH_CN "]) {
        assert.equal(parseCheatsLocale(value), "zh-CN");
    }
    assert.equal(parseCheatsLocale("en"), "en");
    assert.equal(parseCheatsLocale("pt-br"), "pt-BR");
    assert.equal(parseCheatsLocale("ru"), "ru");
    assert.equal(parseCheatsLocale(undefined), undefined);
    assert.equal(parseCheatsLocale("invalid"), undefined);
});

/** Distinguishes cookie-following navigation from explicit content-language links. */
test("keeps bare cheats navigation and retains every explicit share locale", () => {
    assert.equal(buildCheatsPath(parseCheatsQuery({})), "/cheats");
    assert.equal(buildCheatsPath(parseCheatsQuery({ lang: "en" })), "/cheats?lang=en");
    assert.equal(buildCheatsPath(parseCheatsQuery({ lang: "zh-CN" })), "/cheats?lang=zh-CN");
    assert.equal(buildCheatsPath(parseCheatsQuery({ lang: "pt-PT" })), "/cheats?lang=pt-PT");
});

test("extracts every published display name, summary, category, and argument explanation with Chinese parity", () => {
    assertDictionaryParity(en, zh, "legacy.zh-CN.cheats");
    for (const { name } of commandsData.categories) {
        const key = `category.${name.toLowerCase().replaceAll(" ", "_")}`;
        assert.equal(english.t(key), name);
        assert.ok(chinese.t(key).trim());
    }
    for (const command of commands) {
        const key = `command.${command.command}`;
        assert.equal(english.t(`${key}.name`), command.name);
        assert.equal(english.t(`${key}.summary`), command.summary);
        const original = chineseSource[command.command as keyof typeof chineseSource];
        assert.equal(chinese.t(`${key}.name`), original.name);
        assert.equal(chinese.t(`${key}.summary`), original.summary);
        for (const argument of command.arguments) {
            assert.equal(english.t(`${key}.argument.${argument.name}`), argument.description);
            assert.equal(chinese.t(`${key}.argument.${argument.name}`), (original.arguments as Record<string, string>)[argument.name]);
            assert.match(chinese.t(`${key}.argument.${argument.name}`), /[\u3400-\u9fff]|^(on|success|Pause|state|open)/);
        }
    }
    assert.equal(Object.keys(en).filter((key) => key.endsWith(".summary")).length, 400);
});

test("does not catalog debug-only commands", () => {
    for (const command of debugOnlyCommandNames) assert.equal(commands.some((item) => item.command === command), false, command);
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
    assert.equal(commandsData.count, commands.length);
    assert.equal(commandsData.count, 400);
    assert.equal(new Set(commands.map(c => c.command)).size, commandsData.count);
    assert.equal(commandsData.categories.reduce((sum, c) => sum + c.count, 0), commandsData.count);
    for (const command of commands) {
        assert.match(command.command, /^coop(?:\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*)+$/);
        assert.equal(command.command, `${command.group}.${command.name}`);
        assert.ok(isPublishedCheat(command), command.command);
        assert.deepEqual(command.aliases, [], command.command);
        assert.equal(command.usage, command.command + command.arguments.map(a => a.required ? ` <${a.name}>` : ` [<${a.name}>]`).join(""));
    }
    const heroId = commands.find(c => c.command === "coop.debug.hero.id")!;
    assert.equal(heroId.summary, "Finds registered ids for heroes with an exact display name.");
    assert.equal(heroId.side, "either");
    assert.equal(heroId.kind, "inspect");
    assert.equal(heroId.usage, "coop.debug.hero.id <heroName>");
    assert.equal(chinese.t(`command.${heroId.command}.argument.heroName`), "要查找的英雄的完整显示名称。包含多个词的值需加双引号。");
    const gold = commands.find(c => c.command === "coop.debug.hero.set_gold")!;
    assert.equal(gold.side, "server");
    assert.equal(gold.summary, "Sets gold for every hero with an exact display name on the server.");
    assert.equal(commands.find(c => c.command === "coop.debug.hero.list")!.side, "either");
    assert.equal(commands.find(c => c.command === "coop.delete_player")!.side, "client");
    assert.equal(english.t("ui.sideEither"), "Both");
});

/** Protects command identifiers, filters, and explicit locales through share URL round trips. */
test("featured links round-trip canonical snake-case commands and preserve every filter", () => {
    for (const lang of ["en", "zh-CN", "ru", "es", "pt-BR", "pt-PT", "ja", "ko"] as const) {
        for (const cheat of featuredCommandNames) {
            const path = buildCheatsPath(parseCheatsQuery({ cheat, lang, q: "gold", tab: "Heroes", type: "inspect", side: "either" }));
            const query = parseCheatsQuery(Object.fromEntries(new URL(path, "https://example.com").searchParams));
            assert.deepEqual(query, { cheat, lang, q: "gold", tab: "Heroes", type: "inspect", side: "either" });
        }
    }
});

test("repeated and invalid filter values retain the original first-value and default behavior", () => {
    assert.deepEqual(parseCheatsQuery({ q: [" gold ", "ignored"], lang: ["cn", "en"], type: "invalid", side: "invalid", cheat: [" coop.unstuck "] }), {
        q: "gold", tab: "featured", type: "all", side: "all", cheat: "coop.unstuck", lang: "zh-CN",
    });
});
