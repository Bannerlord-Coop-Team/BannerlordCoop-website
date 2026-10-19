import { hasExactKeys, isRecord } from "./dto-validation.ts";
import { REQUEST_ID } from "./server-visibility-contract.ts";

export type ServerDeletionInput = { serverId: string; expectedUpdatedAt: string; confirmationText: string };
export type ServerDeletionIntent = ServerDeletionInput & { requestId: string };
export type ServerDeletionResult = { outcome: "enqueued" | "existing"; jobId: string; action: "delete" };

/** No normalization: deletion requires the exact current server name. */
export function parseServerDeletionInput(value: unknown): ServerDeletionInput {
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "expectedUpdatedAt", "confirmationText"])
        || typeof value.serverId !== "string" || !REQUEST_ID.test(value.serverId)
        || typeof value.expectedUpdatedAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.expectedUpdatedAt)
        || !Number.isFinite(Date.parse(value.expectedUpdatedAt))
        || typeof value.confirmationText !== "string" || value.confirmationText.length < 1 || value.confirmationText.length > 48) {
        throw new Error("Invalid server deletion request");
    }
    return { serverId: value.serverId, expectedUpdatedAt: value.expectedUpdatedAt, confirmationText: value.confirmationText };
}

export function parseServerDeletionIntent(value: unknown): ServerDeletionIntent {
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "expectedUpdatedAt", "confirmationText", "requestId"])
        || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid deletion request ID");
    const { requestId, ...input } = value;
    return { ...parseServerDeletionInput(input), requestId };
}

export function parseServerDeletionResult(value: unknown): ServerDeletionResult {
    if (!isRecord(value) || !hasExactKeys(value, ["outcome", "jobId", "action"])
        || !["enqueued", "existing"].includes(String(value.outcome)) || value.action !== "delete"
        || typeof value.jobId !== "string" || !REQUEST_ID.test(value.jobId)) throw new Error("Invalid deletion receipt");
    return value as ServerDeletionResult;
}
