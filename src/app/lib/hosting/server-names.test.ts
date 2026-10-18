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

// Checks the existing Unicode character limit without changing accepted names.
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

// Covers each rejection rule with injected copy and preserves valid Unicode normalization.
test("uses injected messages without changing validation rules or normalized results", () => {
    const messages = { required: "Name required", singleLine: "One line only", tooLong: "Name too long" };
    for (const value of [null, "   "]) {
        assert.deepEqual(validateServerDisplayName(value, messages), { ok: false, error: messages.required });
    }
    assert.deepEqual(validateServerDisplayName("a\nb", messages), { ok: false, error: messages.singleLine });
    assert.deepEqual(validateServerDisplayName("😀".repeat(81), messages), { ok: false, error: messages.tooLong });
    assert.deepEqual(validateServerDisplayName("  😀   世界  ", messages), { ok: true, displayName: "😀 世界" });
    assert.equal(validateServerDisplayName("😀".repeat(80), messages).ok, true);
});

// Protects the default messages for callers that do not opt into localization.
test("retains default English validation errors", () => {
    assert.deepEqual(validateServerDisplayName(""), { ok: false, error: "Enter a server name." });
    assert.deepEqual(validateServerDisplayName("a\nb"), { ok: false, error: "Server names must use a single line of visible text." });
    assert.deepEqual(validateServerDisplayName("a".repeat(81)), { ok: false, error: "Server names cannot exceed 80 characters." });
});
