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
    }

    for (const command of featuredCommandNames) {
        assert.ok(zh.featured[command], command);
        const source = commands.find((item) => item.command === command);
        assert.ok(source, command);
        assert.equal(localizedCommandSummary(source, zh, true), zh.featured[command]);
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
