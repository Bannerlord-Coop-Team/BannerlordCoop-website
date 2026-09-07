import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CheatsDirectory, type CheatCommand } from "./CheatsDirectory";
import data from "./commands.json";
import { getCheatsMessages } from "./locales";
import { parseCheatsQuery } from "./query";

function render(q: string, lang = "en", side = "all") {
    const query = parseCheatsQuery({ q, lang, side, tab: "all" });
    return renderToStaticMarkup(<CheatsDirectory commands={data.commands as CheatCommand[]} initialQuery={query} locale={query.lang} messages={getCheatsMessages(query.lang)} />);
}

test("CheatsDirectory renders source descriptions and required/optional argument help", () => {
    const gold = render("coop.debug.hero.set_gold");
    assert.ok(gold.includes("Sets gold for every hero with an exact display name on the server."));
    assert.ok(gold.includes("&lt;hero_name&gt; &lt;gold&gt;"));
    assert.ok(gold.includes("The exact hero display name. Quote multi-word values."));
    assert.ok(gold.includes("Required"));
    const heroes = render("coop.debug.hero.list");
    assert.ok(heroes.includes("[&lt;name_prefix&gt;]"));
    assert.ok(heroes.includes("Optional"));
    assert.ok(!gold.includes("SetGold"));
    const heroId = render("coop.debug.hero.id", "zh-CN");
    assert.ok(heroId.includes('id="cheat-coop.debug.hero.id"'));
    assert.ok(heroId.includes("&lt;heroName&gt;"));
    assert.ok(heroId.includes("查找显示名称完全匹配的英雄的注册 ID。"));
    assert.ok(heroId.includes("要查找的英雄的完整显示名称。包含多个词的值需加双引号。"));
});

test("CheatsDirectory searches translated argument help without translating command syntax", () => {
    const html = render("包含多个词的值需加双引号", "zh-CN");
    assert.ok(html.includes('id="cheat-coop.debug.hero.set_gold"'));
    assert.ok(html.includes("&lt;hero_name&gt; &lt;gold&gt;"));
    assert.ok(html.includes("参数"));
    assert.ok(html.includes("必填"));
    assert.ok(html.includes("英雄的完整显示名称。包含多个词的值需加双引号。"));
    assert.ok(html.includes("/cheats?cheat=coop.debug.hero.set_gold&amp;lang=zh-CN"));
});

test("CheatsDirectory filters Both using extracted Side metadata", () => {
    const html = render("coop.debug.hero.", "en", "either");
    assert.ok(html.includes('id="cheat-coop.debug.hero.list"'));
    assert.ok(!html.includes('id="cheat-coop.debug.hero.set_gold"'));
    assert.ok(html.includes("Both"));
});
