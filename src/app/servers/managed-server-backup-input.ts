import type { MyServerBackupOperation } from "@/app/lib/hosting/my-servers";

const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type ManagedServerBackupInput =
    | {
        serverId: string;
        action: "create-backup";
        expectedUpdatedAt: string;
        requestId: string;
    }
    | {
        serverId: string;
        backupId: string;
        action: "restore-backup";
        expectedUpdatedAt: string;
        requestId: string;
    };

export function parseManagedServerBackupInput(value: unknown): ManagedServerBackupInput | null {
    if (!isRecord(value) || typeof value.action !== "string") return null;
    if (typeof value.serverId !== "string" || !SERVER_ID.test(value.serverId)) return null;
    if (typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) return null;
    if (!isTimestamp(value.expectedUpdatedAt)) return null;

    const action = value.action as MyServerBackupOperation;
    if (action === "create-backup") {
        if (!hasExactKeys(value, ["action", "expectedUpdatedAt", "requestId", "serverId"])) return null;
        return {
            serverId: value.serverId,
            action,
            expectedUpdatedAt: value.expectedUpdatedAt,
            requestId: value.requestId,
        };
    }
    if (action === "restore-backup") {
        if (!hasExactKeys(value, ["action", "backupId", "expectedUpdatedAt", "requestId", "serverId"])) return null;
        if (typeof value.backupId !== "string" || !SERVER_ID.test(value.backupId)) return null;
        return {
            serverId: value.serverId,
            backupId: value.backupId,
            action,
            expectedUpdatedAt: value.expectedUpdatedAt,
            requestId: value.requestId,
        };
    }
    return null;
}

function isTimestamp(value: unknown): value is string {
    return typeof value === "string"
        && value.length <= 64
        && ISO_TIMESTAMP.test(value)
        && Number.isFinite(Date.parse(value));
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
    const keys = Object.keys(value).sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
