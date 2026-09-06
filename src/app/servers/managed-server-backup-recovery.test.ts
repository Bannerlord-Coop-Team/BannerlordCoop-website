import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { backupRequestOutcomeIsUncertain } from "@/app/servers/managed-server-backup-errors";
import {
    clearManagedServerBackupIntent,
    managedServerBackupIntentKey,
    readManagedServerBackupIntent,
    retainManagedServerBackupIntent,
    storeManagedServerBackupIntent,
} from "@/app/servers/managed-server-backup-intent";
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

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
    };
}

test("session recovery accepts only bounded exact inputs for the scoped server", () => {
    const storage = memoryStorage();
    const key = managedServerBackupIntentKey("user", retained.serverId);
    storeManagedServerBackupIntent(storage, key, retained);
    assert.deepEqual(readManagedServerBackupIntent(storage, key, retained.serverId), retained);
    for (const raw of [
        "not json", "null", "[]", " ".repeat(1_025),
        JSON.stringify({ ...retained, requestId: "invalid" }),
        JSON.stringify({ ...retained, expectedUpdatedAt: "yesterday" }),
        JSON.stringify({ ...retained, backupId: "invalid" }),
        JSON.stringify({ ...retained, serverId: "55555555-5555-4555-8555-555555555555" }),
        JSON.stringify({ ...retained, actorId: "user" }),
        JSON.stringify({ ...retained, buildId: "older-build" }),
        JSON.stringify({ ...retained, accessToken: "not-a-real-token" }),
    ]) {
        storage.setItem(key, raw);
        assert.throws(() => readManagedServerBackupIntent(storage, key, retained.serverId));
        assert.equal(storage.getItem(key), raw);
    }
});

test("session intent keys isolate authenticated accounts and servers without delimiter collisions", () => {
    const storage = memoryStorage();
    const key = managedServerBackupIntentKey("user", retained.serverId);
    storeManagedServerBackupIntent(storage, key, retained);
    assert.equal(readManagedServerBackupIntent(storage, managedServerBackupIntentKey("another-user", retained.serverId), retained.serverId), null);
    assert.equal(readManagedServerBackupIntent(storage, managedServerBackupIntentKey("user", "another-server"), "another-server"), null);
    assert.notEqual(managedServerBackupIntentKey("user:server", "id"), managedServerBackupIntentKey("user", "server:id"));
});

test("session storage refuses to replace an unresolved intent and ignores late clearing of older requests", () => {
    const storage = memoryStorage();
    const key = managedServerBackupIntentKey("user", retained.serverId);
    const newer = { ...retained, requestId: "55555555-5555-4555-8555-555555555555" };
    storeManagedServerBackupIntent(storage, key, retained);
    storeManagedServerBackupIntent(storage, key, retained);
    assert.throws(() => storeManagedServerBackupIntent(storage, key, newer));
    clearManagedServerBackupIntent(storage, key, retained);
    assert.equal(storage.getItem(key), null);
    storeManagedServerBackupIntent(storage, key, newer);
    clearManagedServerBackupIntent(storage, key, retained);
    assert.deepEqual(readManagedServerBackupIntent(storage, key, retained.serverId), newer);
    clearManagedServerBackupIntent(storage, key, newer);
    assert.equal(storage.getItem(key), null);
});
