import { hasExactKeys, isRecord } from "./dto-validation.ts";
import { REQUEST_ID, timestamp } from "./server-visibility-contract.ts";

export const START_WAITING_REASONS = ["scheduled", "server-recovery", "host-maintenance", "capacity", "host-busy", "worker"] as const;
export type StartQueueDetails = {
    waitingReason: typeof START_WAITING_REASONS[number] | null;
    canCancel: boolean;
    updatedAt: string;
};
export type StartCancellationInput = { serverId: string; jobId: string; expectedUpdatedAt: string };

export function isStartQueueDetails(value: unknown): value is StartQueueDetails {
    return isRecord(value) && hasExactKeys(value, ["waitingReason", "canCancel", "updatedAt"])
        && (value.waitingReason === null || START_WAITING_REASONS.includes(value.waitingReason as typeof START_WAITING_REASONS[number]))
        && typeof value.canCancel === "boolean" && timestamp(value.updatedAt);
}

export function parseStartCancellationInput(value: unknown): StartCancellationInput {
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "jobId", "expectedUpdatedAt"])
        || typeof value.serverId !== "string" || !REQUEST_ID.test(value.serverId)
        || typeof value.jobId !== "string" || !REQUEST_ID.test(value.jobId) || !timestamp(value.expectedUpdatedAt)) {
        throw new Error("Invalid Start cancellation");
    }
    return value as StartCancellationInput;
}

export function parseStartCancellationResult(value: unknown): { serverId: string; jobId: string; state: "cancelled" } {
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "jobId", "state"])
        || typeof value.serverId !== "string" || !REQUEST_ID.test(value.serverId)
        || typeof value.jobId !== "string" || !REQUEST_ID.test(value.jobId) || value.state !== "cancelled") {
        throw new Error("Invalid Start cancellation result");
    }
    return value as { serverId: string; jobId: string; state: "cancelled" };
}
