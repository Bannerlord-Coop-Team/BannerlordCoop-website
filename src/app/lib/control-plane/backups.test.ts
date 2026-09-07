import assert from "node:assert/strict";
import test from "node:test";
import { backupDescription, restorableBackups } from "./backups";
import type { Backup } from "./types";

const backup: Backup = {
    backupId: "backup-a", serverId: "server-a", backupType: "pre-update",
    byteSize: 2_097_152, buildId: "stable-build-a", saveId: "save-a",
    retentionExpiresAt: "2026-09-10T12:00:00Z", createdAt: "2026-09-06T12:00:00Z",
    restoreState: "available", lastErrorCode: null,
};

test("backup choices exclude other servers, expired and busy backups", () => {
    const candidates = [backup, { ...backup, serverId: "server-b" },
        { ...backup, retentionExpiresAt: "2026-09-06T12:00:00Z" },
        ...["expired", "queued", "restoring"].map((restoreState) => ({ ...backup, restoreState })),
        { ...backup, backupId: "restored", restoreState: "restored" },
        { ...backup, backupId: "retry", restoreState: "failed" }];
    assert.deepEqual(restorableBackups(candidates, "server-a", Date.parse("2026-09-06T12:00:00Z")).map((entry) => entry.backupId),
        ["backup-a", "restored", "retry"]);
});

test("backup labels describe the snapshot rather than requiring an identifier", () => {
    const label = backupDescription(backup);
    assert.match(label, /pre update/);
    assert.match(label, /2.0 MiB/);
    assert.match(label, /stable-build-a/);
    assert.doesNotMatch(label, /backup-a/);
});
