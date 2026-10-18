import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import {
    getAssignedLiveConsoleAccess,
    getLiveConsoleMember,
    getOperatedLiveConsoleServerIds,
    getOwnedLiveConsoleServerIds,
    LIVE_CONSOLE_OPERATOR_IDS_KEY,
    LIVE_CONSOLE_OWNER_IDS_KEY,
} from "./access";

test("reads only valid unique live-console assignments", () => {
    const metadata = {
        [LIVE_CONSOLE_OWNER_IDS_KEY]: ["one", "one", "two", 3, ""],
        [LIVE_CONSOLE_OPERATOR_IDS_KEY]: "one",
    };

    assert.deepEqual(getOwnedLiveConsoleServerIds(metadata), ["one", "two"]);
    assert.deepEqual(getOperatedLiveConsoleServerIds(metadata), []);
    assert.deepEqual(getOwnedLiveConsoleServerIds(undefined), []);
    assert.equal(getAssignedLiveConsoleAccess(metadata, "two"), "owner");
    assert.equal(getAssignedLiveConsoleAccess(metadata, "missing"), null);
});

test("owner access wins over an accidental duplicate operator assignment", () => {
    const metadata = {
        [LIVE_CONSOLE_OWNER_IDS_KEY]: ["server-one"],
        [LIVE_CONSOLE_OPERATOR_IDS_KEY]: ["server-one"],
    };

    assert.equal(getAssignedLiveConsoleAccess(metadata, "server-one"), "owner");
});

// Supplies only the identity fields consumed by member presentation.
function member(metadata: Record<string, unknown>, email?: string): User {
    return { id: "member-id", user_metadata: metadata, email } as User;
}

// Verifies localized fallbacks are used only for missing identity values.
test("injects missing member labels while preserving default English", () => {
    const user = member({});
    assert.deepEqual(getLiveConsoleMember(user), { id: "member-id", displayName: "Unnamed member", email: "No email" });
    assert.deepEqual(getLiveConsoleMember(user, { missingName: "Missing name", missingEmail: "Missing email" }), {
        id: "member-id", displayName: "Missing name", email: "Missing email",
    });
});

// Preserves nullish precedence, coercion, empty values, and email-derived display names.
test("does not translate or replace real member identities", () => {
    const labels = { missingName: "Fallback name", missingEmail: "Fallback email" };
    const cases: [Record<string, unknown>, string | undefined, string, string][] = [
        [{ full_name: "Full {name}", name: "Name", user_name: "User" }, "mail@example.com", "Full {name}", "mail@example.com"],
        [{ full_name: null, name: "Name", user_name: "User" }, undefined, "Name", "Fallback email"],
        [{ user_name: "User" }, undefined, "User", "Fallback email"],
        [{}, "mail@example.com", "mail", "mail@example.com"],
        [{ full_name: 0 }, undefined, "0", "Fallback email"],
        [{ full_name: "" }, "", "", ""],
        [{ full_name: "Unnamed member" }, "No email", "Unnamed member", "No email"],
    ];
    for (const [metadata, email, displayName, expectedEmail] of cases) {
        assert.deepEqual(getLiveConsoleMember(member(metadata, email), labels), { id: "member-id", displayName, email: expectedEmail });
    }
});
