import { requireUuid } from "./server-file-contract.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const present = Object.keys(value).sort();
    return present.length === keys.length && [...keys].sort().every((key, index) => key === present[index]);
}

/** Mirrors the control plane's `server-saves`, `select-save` and `reset-campaign` owner operations. */
export type CampaignSummary = {
    saveId: string;
    displayName: string;
    byteSize: number;
    createdAt: string;
    lastUsedAt: string | null;
    importedBy: "system" | "owner";
};

export type CampaignPage = {
    serverId: string;
    updatedAt: string;
    activeSaveId: string | null;
    items: CampaignSummary[];
    nextCursor: string | null;
};

export type CampaignSelection = { serverId: string; activeSaveId: string | null; updatedAt: string };

export type CampaignResetResult = { outcome: "enqueued" | "existing"; jobId: string; action: "reset-campaign" };

export type CampaignMutation =
    | { action: "select-save"; serverId: string; saveId: string; expectedUpdatedAt: string }
    | { action: "reset-campaign"; serverId: string; expectedUpdatedAt: string };

export const MAXIMUM_CAMPAIGN_LIMIT = 100;

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function isTimestamp(value: unknown): value is string {
    return typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function requireCampaignTimestamp(value: unknown): asserts value is string {
    if (!isTimestamp(value)) throw new Error("Invalid campaign timestamp");
}

function parseCampaignSummary(value: unknown): CampaignSummary {
    if (!isRecord(value) || !hasExactKeys(value, ["byteSize", "createdAt", "displayName", "importedBy", "lastUsedAt", "saveId"])) throw new Error("Invalid campaign");
    requireUuid(value.saveId);
    if (typeof value.displayName !== "string" || value.displayName.length < 1 || value.displayName.length > 128 || /[\p{Cc}\p{Cf}]/u.test(value.displayName)) throw new Error("Invalid campaign name");
    if (typeof value.byteSize !== "number" || !Number.isSafeInteger(value.byteSize) || value.byteSize < 0) throw new Error("Invalid campaign size");
    if (!isTimestamp(value.createdAt) || (value.lastUsedAt !== null && !isTimestamp(value.lastUsedAt))) throw new Error("Invalid campaign timestamps");
    if (value.importedBy !== "system" && value.importedBy !== "owner") throw new Error("Invalid campaign origin");
    return value as CampaignSummary;
}

export function parseCampaignPage(value: unknown): CampaignPage {
    if (!isRecord(value) || !hasExactKeys(value, ["activeSaveId", "items", "nextCursor", "serverId", "updatedAt"]) || !Array.isArray(value.items)) throw new Error("Invalid campaign page");
    requireUuid(value.serverId);
    requireCampaignTimestamp(value.updatedAt);
    if (value.activeSaveId !== null) requireUuid(value.activeSaveId);
    if (value.nextCursor !== null && (typeof value.nextCursor !== "string" || value.nextCursor.length < 1 || value.nextCursor.length > 4_096)) throw new Error("Invalid campaign cursor");
    if (value.items.length > MAXIMUM_CAMPAIGN_LIMIT) throw new Error("Too many campaigns");
    const items = value.items.map(parseCampaignSummary);
    if (new Set(items.map((item) => item.saveId)).size !== items.length) throw new Error("Duplicate campaign");
    return { serverId: value.serverId, updatedAt: value.updatedAt, activeSaveId: value.activeSaveId as string | null, items, nextCursor: value.nextCursor as string | null };
}

export function parseCampaignSelection(value: unknown): CampaignSelection {
    if (!isRecord(value) || !hasExactKeys(value, ["activeSaveId", "serverId", "updatedAt"])) throw new Error("Invalid campaign selection");
    requireUuid(value.serverId);
    if (value.activeSaveId !== null) requireUuid(value.activeSaveId);
    requireCampaignTimestamp(value.updatedAt);
    return value as CampaignSelection;
}

export function parseCampaignResetResult(value: unknown): CampaignResetResult {
    if (!isRecord(value) || !hasExactKeys(value, ["action", "jobId", "outcome"]) || value.action !== "reset-campaign"
        || (value.outcome !== "enqueued" && value.outcome !== "existing")) throw new Error("Invalid campaign reset result");
    requireUuid(value.jobId);
    return value as CampaignResetResult;
}

export function parseCampaignMutation(value: unknown): CampaignMutation {
    if (!isRecord(value)) throw new Error("Invalid campaign request");
    requireUuid(value.serverId);
    requireCampaignTimestamp(value.expectedUpdatedAt);
    if (value.action === "select-save") {
        if (!hasExactKeys(value, ["action", "expectedUpdatedAt", "saveId", "serverId"])) throw new Error("Invalid campaign selection request");
        requireUuid(value.saveId);
        return { action: "select-save", serverId: value.serverId, saveId: value.saveId, expectedUpdatedAt: value.expectedUpdatedAt };
    }
    if (value.action === "reset-campaign") {
        if (!hasExactKeys(value, ["action", "expectedUpdatedAt", "serverId"])) throw new Error("Invalid campaign reset request");
        return { action: "reset-campaign", serverId: value.serverId, expectedUpdatedAt: value.expectedUpdatedAt };
    }
    throw new Error("Invalid campaign request");
}
