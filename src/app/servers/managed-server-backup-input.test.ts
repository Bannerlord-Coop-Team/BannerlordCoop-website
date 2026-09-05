import assert from "node:assert/strict";
import test from "node:test";
import { parseManagedServerBackupInput } from "./managed-server-backup-input";

const base = {
    serverId: "22222222-2222-4222-8222-222222222222",
    expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
    requestId: "11111111-1111-4111-8111-111111111111",
};

test("accepts exact create and restore backup action inputs", () => {
    assert.deepEqual(parseManagedServerBackupInput({
        ...base,
        action: "create-backup",
    }), {
        ...base,
        action: "create-backup",
    });
    assert.deepEqual(parseManagedServerBackupInput({
        ...base,
        backupId: "33333333-3333-4333-8333-333333333333",
        action: "restore-backup",
    }), {
        ...base,
        backupId: "33333333-3333-4333-8333-333333333333",
        action: "restore-backup",
    });
});

test("rejects forged authority, unsupported actions, and stale input formats", () => {
    for (const value of [
        { ...base, action: "rollback-server" },
        { ...base, action: "create-backup", ownerDiscordUserId: "192469416892432384" },
        { ...base, action: "create-backup", roleIds: ["1286659364455252022"] },
        { ...base, action: "restore-backup" },
        { ...base, backupId: "not-a-backup", action: "restore-backup" },
        { ...base, expectedUpdatedAt: "2026-09-02T16:45:07.479+02:00", action: "create-backup" },
        { ...base, requestId: "not-a-request", action: "create-backup" },
    ]) {
        assert.equal(parseManagedServerBackupInput(value), null);
    }
});
