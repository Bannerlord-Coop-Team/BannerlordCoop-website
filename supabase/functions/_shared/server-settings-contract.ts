import { hasExactKeys, isRecord } from "./dto-validation.ts";
import { REQUEST_ID, timestamp } from "./server-visibility-contract.ts";
import { normalizeOnboardingName } from "./server-onboarding-contract.ts";

export const HOSTING_MAINTENANCE_SLOTS = ["03:00-04:00", "10:00-11:00", "18:00-19:00"] as const;
export const HOSTING_TIME_ZONE = "America/Chicago";
export type MaintenanceSlot = (typeof HOSTING_MAINTENANCE_SLOTS)[number];
export type OwnerSettingsPatch = { displayName?: string; maintenanceSlot?: MaintenanceSlot };
export type OwnerSettingsMutation = { serverId: string; expectedUpdatedAt: string; patch: OwnerSettingsPatch };
export type OwnerSettingsResult = { outcome: "updated" | "existing"; serverId: string; updatedAt: string };

export function parseOwnerSettingsMutation(value: unknown): OwnerSettingsMutation {
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "expectedUpdatedAt", "patch"])
        || typeof value.serverId !== "string" || !REQUEST_ID.test(value.serverId) || !timestamp(value.expectedUpdatedAt)
        || !isRecord(value.patch) || Object.keys(value.patch).length === 0
        || Object.keys(value.patch).some(key => !["displayName", "maintenanceSlot"].includes(key))) throw new Error("Invalid settings request");
    const patch: OwnerSettingsPatch = {};
    if ("displayName" in value.patch) {
        const name = normalizeOnboardingName(value.patch.displayName);
        if (name === null) throw new Error("Invalid server name");
        patch.displayName = name;
    }
    if ("maintenanceSlot" in value.patch) {
        if (!HOSTING_MAINTENANCE_SLOTS.includes(value.patch.maintenanceSlot as MaintenanceSlot)) throw new Error("Invalid maintenance window");
        patch.maintenanceSlot = value.patch.maintenanceSlot as MaintenanceSlot;
    }
    return { serverId: value.serverId, expectedUpdatedAt: value.expectedUpdatedAt, patch };
}

export function parseOwnerSettingsResult(value: unknown, serverId: string): OwnerSettingsResult {
    if (!isRecord(value) || !hasExactKeys(value, ["outcome", "serverId", "updatedAt"])
        || value.serverId !== serverId || (value.outcome !== "updated" && value.outcome !== "existing")
        || !timestamp(value.updatedAt)) throw new Error("Invalid settings receipt");
    return value as OwnerSettingsResult;
}
