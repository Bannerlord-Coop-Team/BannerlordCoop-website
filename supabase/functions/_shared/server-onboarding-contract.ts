// Shared closed, public DTOs: usable by both the Edge boundary and website facade.
export const ONBOARDING_REGIONS = ["us-west", "us-east", "france", "germany", "united-kingdom", "poland"] as const;
export type OnboardingRegion = typeof ONBOARDING_REGIONS[number];
export const ONBOARDING_REGION_LABELS: Record<OnboardingRegion, string> = {
    "us-west": "US-West", "us-east": "US-East", france: "France", germany: "Germany",
    "united-kingdom": "United Kingdom", poland: "Poland",
};
export const ONBOARDING_UNAVAILABLE_REASONS = ["provider_cannot_assign", "required_approval_missing", "pilot_only", "provisioning_paused", "validated_build_unavailable"] as const;
export type OnboardingMutation =
    | { action: "create-server"; displayName: string; region: OnboardingRegion }
    | { action: "request-region"; region: OnboardingRegion };
export type OnboardingIntent = OnboardingMutation & { requestId: string };
export type RegionRequest = { requestId: string; region: OnboardingRegion; status: "outstanding"; createdAt: string };
export type OnboardingSummary = {
    version: 2;
    sources: { administrativeBase: number; administrativeBonus: number; baseSource: "legacy" | "administrative" | "none"; membershipAllowance: 0 | 1 };
    membership: { enabled: boolean; verification: "qualifying" | "nonqualifying" | "unknown" | "review_required" | "unverified"; verifiedAt: string | null; validUntil: string | null; refreshMode: "oauth_reauthorization" };
    eligibility: { eligible: boolean; reason: "eligible" | "no_grant" | "quota_exhausted"; granted: number; used: number; remaining: number };
    unavailableReason: typeof ONBOARDING_UNAVAILABLE_REASONS[number] | null;
    regions: { region: OnboardingRegion; label: string; available: boolean; request: RegionRequest | null }[];
};
export type OnboardingResult =
    | { action: "create-server"; serverId: string; displayName: string; region: OnboardingRegion; state: "stopped"; createdAt: string; passwordManagement: "discord-owner-controls" }
    | { action: "request-region"; request: RegionRequest };

export function isOnboardingUuid(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
export function normalizeOnboardingName(value: unknown): string | null {
    if (typeof value !== "string" || value.length < 3 || value.length > 48) return null;
    const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    return name.length >= 3 && name.length <= 48 && /^[\p{L}\p{N}][\p{L}\p{N} .'-]*[\p{L}\p{N}]$/u.test(name) ? name : null;
}
export function parseOnboardingMutation(value: unknown): OnboardingMutation {
    if (!record(value) || !region(value.region)) throw invalid();
    if (value.action === "request-region" && keys(value, ["action", "region"])) {
        return { action: value.action, region: value.region };
    }
    if (value.action === "create-server" && keys(value, ["action", "displayName", "region"])) {
        const displayName = normalizeOnboardingName(value.displayName);
        if (displayName !== null) return { action: value.action, displayName, region: value.region };
    }
    throw invalid();
}
export function parseOnboardingIntent(value: unknown): OnboardingIntent {
    if (!record(value) || !isOnboardingUuid(value.requestId)) throw invalid();
    const { requestId, ...mutation } = value;
    return { ...parseOnboardingMutation(mutation), requestId: requestId.toLowerCase() };
}
export function parseOnboardingSummary(value: unknown): OnboardingSummary {
    if (!record(value) || !keys(value, ["version", "sources", "membership", "eligibility", "unavailableReason", "regions"]) || value.version !== 2) throw invalid();
    const sources = value.sources; const membership = value.membership;
    if (!record(sources) || !keys(sources, ["administrativeBase", "administrativeBonus", "baseSource", "membershipAllowance"]) || !integer(sources.administrativeBase) || !integer(sources.administrativeBonus) || !["legacy", "administrative", "none"].includes(sources.baseSource as string) || ![0,1].includes(sources.membershipAllowance as number)) throw invalid();
    if (!record(membership) || !keys(membership, ["enabled", "verification", "verifiedAt", "validUntil", "refreshMode"]) || typeof membership.enabled !== "boolean" || !["qualifying", "nonqualifying", "unknown", "review_required", "unverified"].includes(membership.verification as string) || membership.refreshMode !== "oauth_reauthorization" || (membership.verifiedAt !== null && !timestamp(membership.verifiedAt)) || (membership.validUntil !== null && !timestamp(membership.validUntil))) throw invalid();
    const e = value.eligibility;
    if (!record(e) || !keys(e, ["eligible", "reason", "granted", "used", "remaining"])
        || typeof e.eligible !== "boolean" || !integer(e.granted) || !integer(e.used) || !integer(e.remaining)) throw invalid();
    const remaining = Math.max(0, e.granted - e.used);
    const reason = e.granted === 0 ? "no_grant" : remaining === 0 ? "quota_exhausted" : "eligible";
    if (e.remaining !== remaining || e.reason !== reason || e.eligible !== (reason === "eligible")) throw invalid();
    if (value.unavailableReason !== null && !ONBOARDING_UNAVAILABLE_REASONS.includes(value.unavailableReason as never)) throw invalid();
    if (!Array.isArray(value.regions) || value.regions.length !== ONBOARDING_REGIONS.length) throw invalid();
    const regions = value.regions.map((entry: unknown, index: number) => {
        if (!record(entry) || !keys(entry, ["region", "label", "available", "request"])
            || !region(entry.region) || entry.region !== ONBOARDING_REGIONS[index]
            || entry.label !== ONBOARDING_REGION_LABELS[entry.region] || typeof entry.available !== "boolean"
            || (value.unavailableReason !== null && entry.available)) throw invalid();
        const request = entry.request === null ? null : parseRegionRequest(entry.request);
        if (request !== null && request.region !== entry.region) throw invalid();
        return { region: entry.region, label: entry.label as string, available: entry.available, request };
    });
    return { version: 2, sources: sources as OnboardingSummary["sources"], membership: membership as OnboardingSummary["membership"], eligibility: { eligible: e.eligible, reason, granted: e.granted, used: e.used, remaining }, unavailableReason: value.unavailableReason as OnboardingSummary["unavailableReason"], regions };
}
export function parseOnboardingResult(value: unknown, expected: OnboardingMutation): OnboardingResult {
    if (!record(value) || value.action !== expected.action) throw invalid();
    if (value.action === "request-region" && keys(value, ["action", "request"])) {
        const request = parseRegionRequest(value.request);
        // Dedupe may return another UUID for the same owner's outstanding region request.
        if (request.region !== expected.region) throw invalid();
        return { action: value.action, request };
    }
    if (value.action === "create-server" && expected.action === "create-server"
        && keys(value, ["action", "serverId", "displayName", "region", "state", "createdAt", "passwordManagement"])
        && isOnboardingUuid(value.serverId) && value.displayName === expected.displayName
        && normalizeOnboardingName(value.displayName) === value.displayName
        && value.region === expected.region && value.state === "stopped" && timestamp(value.createdAt)
        && value.passwordManagement === "discord-owner-controls") {
        return { action: value.action, serverId: value.serverId, displayName: expected.displayName, region: expected.region,
            state: value.state, createdAt: value.createdAt, passwordManagement: value.passwordManagement };
    }
    throw invalid();
}
function parseRegionRequest(value: unknown): RegionRequest {
    if (!record(value) || !keys(value, ["requestId", "region", "status", "createdAt"])
        || !isOnboardingUuid(value.requestId) || !region(value.region)
        || value.status !== "outstanding" || !timestamp(value.createdAt)) throw invalid();
    return { requestId: value.requestId, region: value.region, status: value.status, createdAt: value.createdAt };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: string[]) { return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key)); }
function region(value: unknown): value is OnboardingRegion { return ONBOARDING_REGIONS.includes(value as OnboardingRegion); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function timestamp(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function invalid() { return new Error("Invalid server onboarding DTO"); }
