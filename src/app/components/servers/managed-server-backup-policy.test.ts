import {
    canManageServerBackups,
    canRequestServerBackupRestore,
    isExpiredServerBackup,
    latestServerBackupAt,
    partitionServerBackups,
    restoreDisabledReason,
    visibleBackupJob,
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

test("collapses expired backups after the current history without reordering either group", () => {
    const backups = [
        { backupId: "expired-state", restoreState: "expired" },
        { backupId: "current-1", restoreState: "available" },
        { backupId: "expired-reason", restoreState: "available", restoreUnavailableReason: "expired" as const },
        { backupId: "current-2", restoreState: "restored", restoreUnavailableReason: "build_mismatch" as const },
    ];
    const { current, expired } = partitionServerBackups(backups);
    assert.deepEqual(current.map(({ backupId }) => backupId), ["current-1", "current-2"]);
    assert.deepEqual(expired.map(({ backupId }) => backupId), ["expired-state", "expired-reason"]);
    assert.equal(isExpiredServerBackup({ restoreState: "available", restoreUnavailableReason: null }), false);
});

test("finds the newest backup time regardless of list order and ignores malformed timestamps", () => {
    assert.equal(latestServerBackupAt([]), null);
    assert.equal(latestServerBackupAt([
        { createdAt: "2026-09-01T14:45:07.479Z" },
        { createdAt: "not a date" },
        { createdAt: "2026-09-02T09:00:00.000Z" },
        { createdAt: "2026-08-30T00:00:00.000Z" },
    ]), "2026-09-02T09:00:00.000Z");
});

// Historical outcomes are not news: only active jobs or jobs watched on this page are reported.
test("reports a backup outcome only for jobs active or watched during this page session", () => {
    const watched = new Set(["watched"]);
    assert.equal(visibleBackupJob(null, watched), null);
    assert.equal(visibleBackupJob({ jobId: "old", state: "succeeded" }, watched), null);
    assert.equal(visibleBackupJob({ jobId: "old", state: "failed" }, watched), null);
    for (const state of ["queued", "running", "retry-wait"] as const) {
        assert.deepEqual(visibleBackupJob({ jobId: "new", state }, watched), { jobId: "new", state });
    }
    assert.deepEqual(visibleBackupJob({ jobId: "watched", state: "cancelled" }, watched), { jobId: "watched", state: "cancelled" });
});
