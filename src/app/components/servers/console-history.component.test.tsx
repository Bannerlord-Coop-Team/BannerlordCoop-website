import assert from "node:assert/strict";
import { test } from "vitest";
import { CONSOLE_HISTORY_LIMIT, IDLE_HISTORY_CURSOR, appendConsoleHistory, readConsoleHistory, stepConsoleHistory, writeConsoleHistory } from "./console-history";

test("appends sent commands, skipping immediate repeats and keeping only the newest", () => {
    assert.deepEqual(appendConsoleHistory(["a"], "a"), ["a"]);
    assert.deepEqual(appendConsoleHistory(["a", "b"], "a"), ["a", "b", "a"]);
    const full = Array.from({ length: CONSOLE_HISTORY_LIMIT }, (_, index) => `c${index}`);
    assert.deepEqual(appendConsoleHistory(full, "new").slice(-2), [`c${CONSOLE_HISTORY_LIMIT - 1}`, "new"]);
    assert.equal(appendConsoleHistory(full, "new").length, CONSOLE_HISTORY_LIMIT);
});

test("steps older and newer, then restores the stashed draft", () => {
    const history = ["a", "b"];
    let step = stepConsoleHistory(history, IDLE_HISTORY_CURSOR, "draft", "older")!;
    assert.deepEqual(step, { cursor: { index: 1, stash: "draft" }, draft: "b" });
    step = stepConsoleHistory(history, step.cursor, step.draft, "older")!;
    assert.equal(step.draft, "a");
    assert.equal(stepConsoleHistory(history, step.cursor, step.draft, "older")!.draft, "a");
    step = stepConsoleHistory(history, step.cursor, step.draft, "newer")!;
    assert.equal(step.draft, "b");
    assert.deepEqual(stepConsoleHistory(history, step.cursor, step.draft, "newer"), { cursor: IDLE_HISTORY_CURSOR, draft: "draft" });
    assert.equal(stepConsoleHistory(history, IDLE_HISTORY_CURSOR, "x", "newer"), null);
    assert.equal(stepConsoleHistory([], IDLE_HISTORY_CURSOR, "x", "older"), null);
});

test("treats missing, malformed or blocked storage as empty history", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    assert.deepEqual(readConsoleHistory(storage, "k"), []);
    store.set("k", "{not json");
    assert.deepEqual(readConsoleHistory(storage, "k"), []);
    store.set("k", JSON.stringify(["a", 3, "", "b"]));
    assert.deepEqual(readConsoleHistory(storage, "k"), ["a", "b"]);
    writeConsoleHistory({ setItem: () => { throw new Error("quota"); } }, "k", ["x"]);
    assert.deepEqual(readConsoleHistory({ getItem: () => { throw new Error("blocked"); } }, "k"), []);
});
