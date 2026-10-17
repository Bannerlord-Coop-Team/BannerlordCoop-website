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

test("accepts only an earlier autosave of a named campaign as an autosave restore input", () => {
    const autosave = { ...base, saveId: "77777777-7777-4777-8777-777777777777", generation: "backup1", action: "restore-save-generation" };
    assert.deepEqual(parseManagedServerBackupInput(autosave), autosave);
    assert.deepEqual(parseManagedServerBackupInput({ ...autosave, generation: "backup2" }), { ...autosave, generation: "backup2" });
    // The confirmed save time travels with the request; requests retained before it existed still parse.
    const confirmed = { ...autosave, expectedLastModifiedAt: "2026-09-02T14:41:00.000Z" };
    assert.deepEqual(parseManagedServerBackupInput(confirmed), confirmed);
    for (const expectedLastModifiedAt of ["2026-09-02T14:41:00Z", "2026-09-02T16:41:00.000+02:00", "yesterday", null, 1_788_000_000_000]) {
        assert.equal(parseManagedServerBackupInput({ ...autosave, expectedLastModifiedAt }), null);
    }
    assert.equal(parseManagedServerBackupInput({ ...confirmed, action: "restore-backup", backupId: "33333333-3333-4333-8333-333333333333" }), null);
    for (const value of [
        { ...autosave, generation: "current" },
        { ...autosave, generation: "backup3" },
        { ...autosave, generation: undefined },
        { ...autosave, saveId: "not-a-save" },
        { ...autosave, saveId: undefined },
        { ...autosave, backupId: "33333333-3333-4333-8333-333333333333" },
        { ...autosave, ownerDiscordUserId: "192469416892432384" },
        { ...autosave, expectedUpdatedAt: "2026-09-02T16:45:07.479+02:00" },
    ]) {
        assert.equal(parseManagedServerBackupInput(value), null);
    }
});
