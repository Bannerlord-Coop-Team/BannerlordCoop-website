import assert from "node:assert/strict";
import test from "node:test";
import {
    getAssignedLiveConsoleAccess,
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
