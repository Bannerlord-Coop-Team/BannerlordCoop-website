import assert from "node:assert/strict";
import test from "node:test";
import { reuseDictionaries, sameDictionary, sameMessage } from "./dictionary-reuse";
import type { Messages } from "./types";

/** Builds a fresh copy of the same two-namespace payload a refresh would deliver. */
function delivered(): Messages {
    return {
        common: { "loading.page": "Loading…" },
        cheats: { heading: "Commands", count: { one: "{count} command", other: "{count} commands" } },
    };
}

test("returns the earlier messages when a refresh re-delivers equal content in fresh objects", () => {
    const previous = delivered();
    assert.equal(reuseDictionaries(previous, delivered()), previous);
});

const changedCheats: [string, Messages["cheats"]][] = [
    ["a changed plain value", { heading: "Console commands", count: { one: "{count} command", other: "{count} commands" } }],
    ["a changed plural form", { heading: "Commands", count: { one: "{count} command", other: "{count} console commands" } }],
    ["an added key", { heading: "Commands", count: { one: "{count} command", other: "{count} commands" }, empty: "No commands" }],
    ["a removed key", { heading: "Commands" }],
];
for (const [label, cheats] of changedCheats) {
    test(`replaces a namespace with ${label} and keeps the unchanged namespace's earlier object`, () => {
        const previous = delivered();
        const next = { ...delivered(), cheats };
        const result = reuseDictionaries(previous, next);
        assert.notEqual(result, previous);
        assert.equal(result.cheats, cheats);
        assert.equal(result.common, previous.common);
    });
}

test("returns new messages with reused dictionaries when a namespace is added", () => {
    const previous = delivered();
    const support = { heading: "Support" };
    const result = reuseDictionaries(previous, { ...delivered(), support });
    assert.notEqual(result, previous);
    assert.equal(result.support, support);
    assert.equal(result.common, previous.common);
    assert.equal(result.cheats, previous.cheats);
});

test("returns new messages without a namespace the refresh no longer delivers", () => {
    const previous = delivered();
    const result = reuseDictionaries(previous, { common: { "loading.page": "Loading…" } });
    assert.notEqual(result, previous);
    assert.deepEqual(Object.keys(result), ["common"]);
    assert.equal(result.common, previous.common);
});

test("compares dictionaries and messages by value, including plural form sets", () => {
    assert.equal(sameDictionary({ a: "x" }, { a: "x" }), true);
    assert.equal(sameDictionary({ a: "x" }, { b: "x" }), false);
    assert.equal(sameMessage({ one: "a", other: "b" }, { one: "a", other: "b" }), true);
    assert.equal(sameMessage({ one: "a", other: "b" }, { other: "b" }), false);
    assert.equal(sameMessage("b", { other: "b" }), false);
});
