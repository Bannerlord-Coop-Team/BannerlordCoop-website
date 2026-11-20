import type { HostingAdminVpsHost } from "./types";

export const SLOT_ADMISSION_REASON = {
    storage_evidence_missing: "Storage evidence is missing.",
    storage_evidence_stale: "Storage evidence is stale (over 5 minutes old or dated in the future).",
    storage_identity_changed: "Storage evidence belongs to an earlier slot identity.",
    storage_reserve: "Storage headroom is insufficient or reserved for inbound moves.",
    slot_target: "The slot target limits new assignments.",
    runner_onboarding: "Runner onboarding is incomplete.",
    runner_update: "Runner update or recovery holds admission.",
    host_decommission: "Host decommission holds admission.",
    native_ram_commission: "Native RAM commissioning holds admission.",
} satisfies Record<NonNullable<HostingAdminVpsHost["slotAvailability"]>["reasons"][number], string>;

/** Reject incompatible readiness details while retaining the older control plane's admission count. */
export function parseSlotAvailability(value: unknown): HostingAdminVpsHost["slotAvailability"] {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 32;
    if (Object.keys(record).sort().join(",") !== "launchProven,ready,reasons,storageObservedAt"
        || !count(record.ready) || !count(record.launchProven) || record.launchProven > record.ready
        || !(record.storageObservedAt === null || (typeof record.storageObservedAt === "string"
            && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(record.storageObservedAt)
            && Number.isFinite(Date.parse(record.storageObservedAt))))
        || !Array.isArray(record.reasons) || record.reasons.length > Object.keys(SLOT_ADMISSION_REASON).length
        || new Set(record.reasons).size !== record.reasons.length
        || !record.reasons.every(reason => typeof reason === "string" && Object.hasOwn(SLOT_ADMISSION_REASON, reason))) return undefined;
    return record as HostingAdminVpsHost["slotAvailability"];
}
