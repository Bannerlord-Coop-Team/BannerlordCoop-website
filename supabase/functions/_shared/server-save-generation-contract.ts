import { hasExactKeys, isRecord } from "./dto-validation.ts";
import { REQUEST_ID } from "./server-visibility-contract.ts";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** The runner keeps the current save plus two earlier autosave copies, always listed in this order. */
export const SAVE_GENERATIONS = ["current", "backup1", "backup2"] as const;
export type SaveGeneration = typeof SAVE_GENERATIONS[number];
/** Only earlier autosaves can be restored; the current save is what they replace. */
export type RestorableSaveGeneration = Exclude<SaveGeneration, "current">;
export type SaveGenerationSummary = { generation: SaveGeneration; byteSize: number; lastModifiedAt: string; observedAt: string };
export type SaveGenerationList = { serverId: string; saveId: string; items: SaveGenerationSummary[] };
export type SaveGenerationRestoreMutation = {
    action: "restore-save-generation"; serverId: string; saveId: string; generation: RestorableSaveGeneration; expectedUpdatedAt: string;
};
export type SaveGenerationRestoreResult = { outcome: "enqueued" | "existing"; jobId: string; action: "restore" };

/** Accepts only the requested campaign's generations: unique, ordered, and at most one per slot. */
export function parseSaveGenerationList(value: unknown, serverId: string, saveId: string): SaveGenerationList {
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "saveId", "items"]) || value.serverId !== serverId
        || value.saveId !== saveId || !Array.isArray(value.items) || value.items.length > SAVE_GENERATIONS.length) {
        throw new Error("Invalid save generations");
    }
    let previous = -1;
    const items = value.items.map((item): SaveGenerationSummary => {
        if (!isRecord(item) || !hasExactKeys(item, ["generation", "byteSize", "lastModifiedAt", "observedAt"])
            || typeof item.generation !== "string" || typeof item.byteSize !== "number"
            || !Number.isSafeInteger(item.byteSize) || item.byteSize < 1
            || !isTimestamp(item.lastModifiedAt) || !isTimestamp(item.observedAt)) throw new Error("Invalid save generation");
        const index = SAVE_GENERATIONS.indexOf(item.generation as SaveGeneration);
        // A strictly increasing position rejects unknown, duplicate and out-of-order generations alike.
        if (index <= previous) throw new Error("Invalid save generation order");
        previous = index;
        return { generation: item.generation as SaveGeneration, byteSize: item.byteSize, lastModifiedAt: item.lastModifiedAt, observedAt: item.observedAt };
    });
    return { serverId, saveId, items };
}

export function parseSaveGenerationRestoreMutation(value: unknown): SaveGenerationRestoreMutation {
    if (!isRecord(value) || !hasExactKeys(value, ["action", "serverId", "saveId", "generation", "expectedUpdatedAt"])
        || value.action !== "restore-save-generation"
        || typeof value.serverId !== "string" || !REQUEST_ID.test(value.serverId)
        || typeof value.saveId !== "string" || !REQUEST_ID.test(value.saveId)
        || (value.generation !== "backup1" && value.generation !== "backup2")
        || !isTimestamp(value.expectedUpdatedAt)) throw new Error("Invalid save generation restore");
    return {
        action: "restore-save-generation", serverId: value.serverId, saveId: value.saveId,
        generation: value.generation, expectedUpdatedAt: value.expectedUpdatedAt,
    };
}

export function parseSaveGenerationRestoreResult(value: unknown): SaveGenerationRestoreResult {
    if (!isRecord(value) || !hasExactKeys(value, ["outcome", "jobId", "action"])
        || (value.outcome !== "enqueued" && value.outcome !== "existing") || value.action !== "restore"
        || typeof value.jobId !== "string" || !REQUEST_ID.test(value.jobId)) throw new Error("Invalid save generation restore receipt");
    return { outcome: value.outcome, jobId: value.jobId, action: "restore" };
}

function isTimestamp(value: unknown): value is string {
    return typeof value === "string" && value.length <= 64 && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}
