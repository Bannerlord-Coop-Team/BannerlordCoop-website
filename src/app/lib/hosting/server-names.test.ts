import assert from "node:assert/strict";
import test from "node:test";
import {
    MAX_SERVER_DISPLAY_NAME_LENGTH,
    validateServerDisplayName,
} from "./server-names";

test("normalizes a valid global server display name", () => {
    assert.deepEqual(validateServerDisplayName("  Calradia   Reborn  "), {
        ok: true,
        displayName: "Calradia Reborn",
    });
});

test("rejects empty, multiline, and non-string server display names", () => {
    assert.equal(validateServerDisplayName("   ").ok, false);
    assert.equal(validateServerDisplayName("Calradia\nReborn").ok, false);
    assert.equal(validateServerDisplayName(null).ok, false);
});

test("enforces the server display-name character limit", () => {
    assert.equal(
        validateServerDisplayName("a".repeat(MAX_SERVER_DISPLAY_NAME_LENGTH)).ok,
        true,
    );
    assert.equal(
        validateServerDisplayName("a".repeat(MAX_SERVER_DISPLAY_NAME_LENGTH + 1)).ok,
        false,
    );
});
