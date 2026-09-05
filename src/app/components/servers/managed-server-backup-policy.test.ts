import {
    canManageServerBackups,
    canRequestServerBackupRestore,
} from "@/app/components/servers/managed-server-backup-policy";
import assert from "node:assert/strict";
import test from "node:test";

test("limits backup mutations to durable owner and manager roles", () => {
    assert.equal(canManageServerBackups("owner"), true);
    assert.equal(canManageServerBackups("manager"), true);
    assert.equal(canManageServerBackups("support"), false);
    assert.equal(canManageServerBackups("admin"), false);
});

test("requires server-approved eligibility and a retained restore state", () => {
    assert.equal(canRequestServerBackupRestore({ canRestore: true, restoreState: "available" }), true);
    assert.equal(canRequestServerBackupRestore({ canRestore: true, restoreState: "restored" }), true);
    assert.equal(canRequestServerBackupRestore({ canRestore: true, restoreState: "failed" }), true);
    assert.equal(canRequestServerBackupRestore({ canRestore: false, restoreState: "available" }), false);
    assert.equal(canRequestServerBackupRestore({ canRestore: true, restoreState: "queued" }), false);
    assert.equal(canRequestServerBackupRestore({ canRestore: true, restoreState: "restoring" }), false);
    assert.equal(canRequestServerBackupRestore({ canRestore: true, restoreState: "expired" }), false);
});
