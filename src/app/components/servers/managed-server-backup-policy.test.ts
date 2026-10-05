import {
    canManageServerBackups,
    canRequestServerBackupRestore,
    restoreDisabledReason,
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

// Proves injected presentation does not change restore eligibility or the selected reason.
test("injects the selected restore reason without changing eligibility", () => {
    const messages = { expired: "localized expired", inProgress: "localized progress", installedBuildUnknown: "localized installed",
        backupBuildUnknown: "localized backup", buildMismatch: "localized mismatch", unknown: "localized unknown" };
    const backup = { canRestore: false, restoreState: "available", restoreUnavailableReason: "build_mismatch" } as const;
    assert.equal(restoreDisabledReason(backup, messages), "localized mismatch");
    assert.equal(canRequestServerBackupRestore(backup), false);
    assert.equal(restoreDisabledReason({ canRestore: true, restoreState: "available" }, messages), undefined);
});

test("legacy responses explain known states without inventing a build mismatch", () => {
    assert.match(restoreDisabledReason({ canRestore: false, restoreState: "available" })!, /did not provide/);
    assert.match(restoreDisabledReason({ canRestore: false, restoreState: "expired" })!, /expired/);
    assert.match(restoreDisabledReason({ canRestore: false, restoreState: "restoring" })!, /already part/);
    assert.equal(restoreDisabledReason({ canRestore: true, restoreState: "available" }), undefined);
    assert.match(restoreDisabledReason({ canRestore: false, restoreState: "queued", restoreUnavailableReason: "expired" })!, /expired/);
});
