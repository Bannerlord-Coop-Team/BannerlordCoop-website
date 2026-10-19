import assert from "node:assert/strict";
import test from "node:test";
import { hasExactKeys, isRecord } from "./dto-validation.ts";

test("DTO helpers accept only plain objects and exactly the expected keys in any order", () => {
    assert.equal(hasExactKeys({ a: 1, b: 2 }, ["a", "b"]), true);
    assert.equal(hasExactKeys({ b: 2, a: 1 }, ["a", "b"]), true);
    assert.equal(hasExactKeys({ a: 1 }, ["a", "b"]), false);
    assert.equal(hasExactKeys({ a: 1, c: 2 }, ["a", "b"]), false);
    assert.equal(hasExactKeys({ a: 1, b: 2, c: 3 }, ["a", "b"]), false);
    for (const value of [null, [], "x", 1, undefined]) assert.equal(isRecord(value), false, String(value));
    assert.equal(isRecord({}), true);
});
