import assert from "node:assert/strict";
import test from "node:test";
import { tabKeyStep } from "./tab-navigation";

test("Home and End jump to the first and last tab", () => {
    assert.equal(tabKeyStep("Home", 2, 4), 0);
    assert.equal(tabKeyStep("End", 0, 4), 3);
});

test("the arrow keys step one tab and wrap at both ends", () => {
    assert.equal(tabKeyStep("ArrowRight", 1, 3), 2);
    assert.equal(tabKeyStep("ArrowRight", 2, 3), 0);
    assert.equal(tabKeyStep("ArrowLeft", 1, 3), 0);
    assert.equal(tabKeyStep("ArrowLeft", 0, 3), 2);
});

test("other keys and an empty tablist do not navigate", () => {
    assert.equal(tabKeyStep("Tab", 0, 3), null);
    assert.equal(tabKeyStep("ArrowDown", 0, 3), null);
    assert.equal(tabKeyStep("Home", 0, 0), null);
});
