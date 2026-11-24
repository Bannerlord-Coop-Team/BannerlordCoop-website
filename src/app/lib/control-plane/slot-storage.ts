import type { HostingAdminVpsHost } from "./types";

/** Missing, incompatible or invalid readings stay unknown during rolling upgrades. */
export function readSlotStorage(value: unknown): NonNullable<HostingAdminVpsHost["occupiedSlots"][number]["storage"]> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || !bytes(record.usedBytes)
        || (record.quotaBytes !== null && !bytes(record.quotaBytes))) return null;
    return { usedBytes: record.usedBytes, quotaBytes: record.quotaBytes };
}

function bytes(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
