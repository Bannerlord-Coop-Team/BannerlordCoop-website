import { hasExactKeys, isRecord } from "./dto-validation.ts";
import { requireFileTimestamp, requireUuid } from "./server-file-contract.ts";

export type SaveDeletionInput = { serverId: string; saveId: string; expectedUpdatedAt: string; confirmationText: string; requestId: string };
export type SaveDeletionStatus = {
    serverId: string; jobId: string; saveId: string;
    state: "queued" | "running" | "retry-wait" | "succeeded" | "failed" | "cancelled";
    errorCode: string | null;
};

export function parseSaveDeletionInput(value: unknown): SaveDeletionInput {
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "saveId", "expectedUpdatedAt", "confirmationText", "requestId"])) throw new Error("Invalid deletion request");
    requireUuid(value.serverId); requireUuid(value.saveId); requireUuid(value.requestId); requireFileTimestamp(value.expectedUpdatedAt);
    if (typeof value.confirmationText !== "string" || value.confirmationText.length < 1 || value.confirmationText.length > 48) throw new Error("Invalid deletion confirmation");
    return value as SaveDeletionInput;
}

export function parseSaveDeletionStatus(value: unknown, serverId: string, jobId: string): SaveDeletionStatus {
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "jobId", "saveId", "state", "errorCode"])) throw new Error("Invalid deletion status");
    requireUuid(value.serverId); requireUuid(value.jobId); requireUuid(value.saveId);
    if (value.serverId !== serverId || value.jobId !== jobId || typeof value.state !== "string"
        || !["queued", "running", "retry-wait", "succeeded", "failed", "cancelled"].includes(value.state)) throw new Error("Invalid deletion identity or state");
    const failed = value.state === "failed" || value.state === "cancelled";
    if (failed ? typeof value.errorCode !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value.errorCode) : value.errorCode !== null) throw new Error("Invalid deletion error code");
    return value as SaveDeletionStatus;
}
