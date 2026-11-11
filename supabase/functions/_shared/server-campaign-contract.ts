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
    /** The save's War Sails mode read from its header; null when unknown, absent from older control planes. */
    warSails?: boolean | null;
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

export const CAMPAIGN_RESET_RUNNER_UPDATE_INSTRUCTION = "Contact support to update this server's runner, then request Reset Campaign again.";
const RESET_STATES = ["queued", "running", "retry-wait", "succeeded", "failed", "cancelled"] as const;
export type CampaignResetStatus = {
    serverId: string;
    jobId: string;
    state: typeof RESET_STATES[number];
    errorCode: "agent_capability_unavailable" | "queue_timeout" | "operation_failed" | null;
    instruction: string | null;
};

/** Accepts only the named job's safe projection, including the fixed support instruction. */
export function parseCampaignResetStatus(value: unknown, serverId: string, jobId: string): CampaignResetStatus {
    requireUuid(serverId); requireUuid(jobId);
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "jobId", "state", "errorCode", "instruction"])
        || value.serverId !== serverId || value.jobId !== jobId || typeof value.state !== "string"
        || !(RESET_STATES as readonly string[]).includes(value.state)) throw new Error("Invalid campaign reset status");
    const terminal = value.state === "failed" || value.state === "cancelled";
    if (!terminal) {
        if (value.errorCode !== null || value.instruction !== null) throw new Error("Nonterminal campaign reset failure");
    } else if (value.state === "failed" && value.errorCode === "agent_capability_unavailable") {
        if (value.instruction !== CAMPAIGN_RESET_RUNNER_UPDATE_INSTRUCTION) throw new Error("Invalid campaign reset instruction");
    } else if (typeof value.errorCode !== "string" || !["queue_timeout", "operation_failed"].includes(value.errorCode) || value.instruction !== null) {
        throw new Error("Invalid campaign reset failure");
    }
    return value as CampaignResetStatus;
}

/** Fixed presentation shared by the authenticated action and its consumer checks. */
export function campaignResetStatusMessage(status: CampaignResetStatus | null): string {
    if (status === null) return "The reset status is not available from the hosting service yet. Your request has not been submitted again.";
    if (status.state === "succeeded") return "Your fresh campaign is ready. Start the server when you want to play it.";
    if (status.errorCode === "agent_capability_unavailable") return CAMPAIGN_RESET_RUNNER_UPDATE_INSTRUCTION;
    if (status.errorCode === "queue_timeout") return "The campaign reset expired before it could start. Refresh before requesting another reset.";
    if (status.state === "failed" || status.state === "cancelled") return "The campaign reset did not complete. Check your campaigns or contact support before trying again.";
    return "Preparing your fresh campaign. This takes about a minute…";
}

export type CampaignMutation =
    | { action: "select-save"; serverId: string; saveId: string; expectedUpdatedAt: string }
    | { action: "reset-campaign"; serverId: string; expectedUpdatedAt: string; warSails?: true };

export const MAXIMUM_CAMPAIGN_LIMIT = 100;

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function isTimestamp(value: unknown): value is string {
    return typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function requireCampaignTimestamp(value: unknown): asserts value is string {
    if (!isTimestamp(value)) throw new Error("Invalid campaign timestamp");
}

const CAMPAIGN_KEYS = ["byteSize", "createdAt", "displayName", "importedBy", "lastUsedAt", "saveId"];

/** Validates one listed campaign; the War Sails label is optional so older control planes still parse. */
function parseCampaignSummary(value: unknown): CampaignSummary {
    if (!isRecord(value) || !hasExactKeys(value, Object.hasOwn(value, "warSails") ? [...CAMPAIGN_KEYS, "warSails"] : CAMPAIGN_KEYS)) throw new Error("Invalid campaign");
    if (Object.hasOwn(value, "warSails") && value.warSails !== null && typeof value.warSails !== "boolean") throw new Error("Invalid campaign War Sails mode");
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

/**
 * Validates a fresh-campaign request. `warSails` is optional (absent = Classic); only `true` is forwarded, so a
 * Classic request stays byte-identical to the request older control planes accept.
 */
function parseCampaignResetMutation(value: Record<string, unknown>, serverId: string, expectedUpdatedAt: string): CampaignMutation {
    const keys = ["action", "expectedUpdatedAt", "serverId"];
    if (!hasExactKeys(value, Object.hasOwn(value, "warSails") ? [...keys, "warSails"] : keys)) throw new Error("Invalid campaign reset request");
    if (Object.hasOwn(value, "warSails") && typeof value.warSails !== "boolean") throw new Error("Invalid campaign reset mode");
    return { action: "reset-campaign", serverId, expectedUpdatedAt, ...(value.warSails === true ? { warSails: true as const } : {}) };
}

/** Validates an owner's select-save or reset-campaign request before it is relayed. */
export function parseCampaignMutation(value: unknown): CampaignMutation {
    if (!isRecord(value)) throw new Error("Invalid campaign request");
    requireUuid(value.serverId);
    requireCampaignTimestamp(value.expectedUpdatedAt);
    if (value.action === "select-save") {
        if (!hasExactKeys(value, ["action", "expectedUpdatedAt", "saveId", "serverId"])) throw new Error("Invalid campaign selection request");
        requireUuid(value.saveId);
        return { action: "select-save", serverId: value.serverId, saveId: value.saveId, expectedUpdatedAt: value.expectedUpdatedAt };
    }
    if (value.action === "reset-campaign") return parseCampaignResetMutation(value, value.serverId, value.expectedUpdatedAt);
    throw new Error("Invalid campaign request");
}
