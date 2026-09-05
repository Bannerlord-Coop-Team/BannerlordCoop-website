import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { backupRequestOutcomeIsUncertain } from "@/app/servers/managed-server-backup-errors";
import { retainManagedServerBackupIntent } from "@/app/servers/managed-server-backup-intent";
import type { ManagedServerBackupInput } from "@/app/servers/managed-server-backup-input";
import assert from "node:assert/strict";
import test from "node:test";

const retained: ManagedServerBackupInput = {
    serverId: "22222222-2222-4222-8222-222222222222",
    backupId: "33333333-3333-4333-8333-333333333333",
    action: "restore-backup",
    expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
    requestId: "11111111-1111-4111-8111-111111111111",
};

test("retains the exact restore UUID and inputs despite a changed or absent list target", () => {
    const changedCandidate: ManagedServerBackupInput = {
        serverId: retained.serverId,
        backupId: "44444444-4444-4444-8444-444444444444",
        action: "restore-backup",
        expectedUpdatedAt: "2026-09-02T15:45:07.479Z",
        requestId: "55555555-5555-4555-8555-555555555555",
    };

    assert.strictEqual(retainManagedServerBackupIntent(retained, changedCandidate), retained);
    assert.deepEqual(retainManagedServerBackupIntent(retained, changedCandidate), {
        serverId: "22222222-2222-4222-8222-222222222222",
        backupId: "33333333-3333-4333-8333-333333333333",
        action: "restore-backup",
        expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
        requestId: "11111111-1111-4111-8111-111111111111",
    });
    assert.strictEqual(retainManagedServerBackupIntent(null, changedCandidate), changedCandidate);
});

test("distinguishes uncertain delivery failures from definite typed rejections", () => {
    for (const code of [
        "control_plane_unavailable",
        "invalid_response",
        "response_too_large",
        "server_api_unavailable",
    ]) {
        assert.equal(backupRequestOutcomeIsUncertain(new MyServersApiError(code, "Uncertain", true)), true);
    }
    for (const code of [
        "backup_build_mismatch",
        "request_conflict",
        "server_not_found",
        "stale_interaction",
    ]) {
        assert.equal(backupRequestOutcomeIsUncertain(new MyServersApiError(code, "Rejected")), false);
    }
    assert.equal(backupRequestOutcomeIsUncertain(new Error("Server Action transport failed")), true);
});
