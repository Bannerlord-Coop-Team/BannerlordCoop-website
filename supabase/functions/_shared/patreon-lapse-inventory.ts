import { boundedJson } from "./membership.ts";

export type MembershipVerification = "qualifying" | "nonqualifying" | "unknown" | "review_required" | "unverified";
export type LapseServer = {
    serverPrefix: string;
    accountPrefix: string | null;
    patreonUserId: string | null;
    deletedAt: string | null;
    independentQuota: number;
    ownerUsage: number;
    fundingRecorded: boolean;
    graceDueAt: string | null;
    verification: MembershipVerification | null;
    grantReason: string | null;
    grantRecordedAt: string | null;
};
export type LapseInventory = { version: 1; observedAt: string; servers: LapseServer[] };

const MAXIMUM_SERVERS = 1000;
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
const PREFIX = /^[0-9a-f]{8}$/u;
const PROVIDER_ID = /^\d{1,32}$/u;
const VERIFICATIONS: readonly unknown[] = ["qualifying", "nonqualifying", "unknown", "review_required", "unverified", null];

export function isLapseTimestamp(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

// Grant notes can contain identifiers or addresses. Do not carry those into report text or dry-run output.
export function reportGrantReason(value: string): string {
    return value.replace(/https?:\/\/\S+/giu, "[address redacted]")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email redacted]")
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, "[account redacted]")
        .replace(/\b\d{17,20}\b/gu, "[identity redacted]")
        .replace(/[\x00-\x1f\x7f\u2028\u2029\u202a-\u202e\u2066-\u2069|]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 240);
}

// This RPC is Website-owned; it reads existing CP state and never changes entitlements or lifecycle state.
export function parseLapseInventory(value: unknown): LapseInventory {
    if (!exactKeys(value, ["version", "observed_at", "truncated", "servers"]) || value.version !== 1
        || value.truncated !== false || !isLapseTimestamp(value.observed_at)
        || !Array.isArray(value.servers) || value.servers.length > MAXIMUM_SERVERS) {
        throw new Error("Invalid or incomplete lapse inventory");
    }
    const prefixes = new Set<string>();
    const servers = value.servers.map((row): LapseServer => {
        if (!exactKeys(row, ["server_prefix", "account_prefix", "patreon_user_id", "deleted_at", "independent_quota",
            "owner_usage", "funding_recorded", "grace_due_at", "verification", "grant_reason", "grant_recorded_at"])
            || typeof row.server_prefix !== "string" || !PREFIX.test(row.server_prefix) || prefixes.has(row.server_prefix)
            || !(row.account_prefix === null || typeof row.account_prefix === "string" && PREFIX.test(row.account_prefix))
            || !(row.patreon_user_id === null || typeof row.patreon_user_id === "string" && PROVIDER_ID.test(row.patreon_user_id))
            || !(row.deleted_at === null || isLapseTimestamp(row.deleted_at))
            || !Number.isSafeInteger(row.independent_quota) || (row.independent_quota as number) < 0 || (row.independent_quota as number) > 2000
            || !Number.isSafeInteger(row.owner_usage) || (row.owner_usage as number) < 0 || (row.owner_usage as number) > 10000
            || typeof row.funding_recorded !== "boolean" || !(row.grace_due_at === null || isLapseTimestamp(row.grace_due_at))
            || !VERIFICATIONS.includes(row.verification)
            || !(row.grant_reason === null || typeof row.grant_reason === "string" && row.grant_reason.length <= 2048)
            || !(row.grant_recorded_at === null || isLapseTimestamp(row.grant_recorded_at))) {
            throw new Error("Invalid lapse inventory row");
        }
        prefixes.add(row.server_prefix);
        return {
            serverPrefix: row.server_prefix, accountPrefix: row.account_prefix as string | null,
            patreonUserId: row.patreon_user_id as string | null, deletedAt: row.deleted_at as string | null,
            independentQuota: row.independent_quota as number, ownerUsage: row.owner_usage as number,
            fundingRecorded: row.funding_recorded, graceDueAt: row.grace_due_at as string | null,
            verification: row.verification as MembershipVerification | null,
            grantReason: row.grant_reason === null ? null : reportGrantReason(row.grant_reason as string),
            grantRecordedAt: row.grant_recorded_at as string | null,
        };
    });
    return { version: 1, observedAt: value.observed_at, servers };
}

export function createLapseInventoryLoader(fetcher: typeof fetch, supabaseUrl: string, serviceKey: string): () => Promise<LapseInventory> {
    const endpoint = new URL("/rest/v1/rpc/patreon_lapse_report_inventory", supabaseUrl);
    return async () => {
        const response = await fetcher(endpoint, {
            method: "POST", body: "{}", redirect: "error", signal: AbortSignal.timeout(10_000),
            headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
        });
        if (!response.ok) throw new Error("Lapse inventory read failed");
        return parseLapseInventory(await boundedJson(response, MAXIMUM_RESPONSE_BYTES));
    };
}
