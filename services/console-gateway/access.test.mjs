import assert from "node:assert/strict";
import test from "node:test";
import {
    getConsoleServerAccess,
    LIVE_CONSOLE_OPERATOR_IDS_KEY,
    LIVE_CONSOLE_OWNER_IDS_KEY,
} from "./access.mjs";

const serverId = "server-one";

test("authorizes administrators for every configured server", () => {
    assert.equal(getConsoleServerAccess({
        email: "admin@example.com",
        app_metadata: { role: "Admin" },
    }, serverId), "admin");
    assert.equal(getConsoleServerAccess({
        email: "bootstrap@example.com",
        app_metadata: { role: "User" },
    }, serverId, new Set(["bootstrap@example.com"])), "admin");
});

test("authorizes only the owner and operators assigned to the requested server", () => {
    assert.equal(getConsoleServerAccess({
        app_metadata: { [LIVE_CONSOLE_OWNER_IDS_KEY]: [serverId] },
    }, serverId), "owner");
    assert.equal(getConsoleServerAccess({
        app_metadata: { [LIVE_CONSOLE_OPERATOR_IDS_KEY]: [serverId] },
    }, serverId), "operator");
    assert.equal(getConsoleServerAccess({
        app_metadata: { [LIVE_CONSOLE_OPERATOR_IDS_KEY]: ["server-two"] },
    }, serverId), null);
});

test("rejects malformed and unassigned metadata", () => {
    assert.equal(getConsoleServerAccess(null, serverId), null);
    assert.equal(getConsoleServerAccess({ app_metadata: {
        [LIVE_CONSOLE_OWNER_IDS_KEY]: serverId,
        [LIVE_CONSOLE_OPERATOR_IDS_KEY]: { serverId },
    } }, serverId), null);
});
