// Shared closed, public DTOs: usable by both the Edge boundary and website facade.
import { HOSTING_REGIONS, HOSTING_REGION_KEYS, REGION_KEY_PATTERN, isHostingRegionKey, type HostingRegionKey } from "./hosting-regions.ts";

// Offered regions are the website's catalog; the control plane answers for exactly these.
export const ONBOARDING_REGIONS: readonly HostingRegionKey[] = HOSTING_REGION_KEYS;
export type OnboardingRegion = HostingRegionKey;
export const ONBOARDING_REGION_LABELS = Object.fromEntries(
    HOSTING_REGIONS.map((region) => [region.key, region.label]),
) as Record<OnboardingRegion, string>;
const MAXIMUM_OTHER_REQUESTS = 32;
export const ONBOARDING_UNAVAILABLE_REASONS = ["provider_cannot_assign", "required_approval_missing", "pilot_only", "provisioning_paused", "validated_build_unavailable"] as const;
export type OnboardingReleaseChannel = "stable" | "nightly";
export type OnboardingMutation =
    | { action: "create-server"; displayName: string; releaseChannel?: OnboardingReleaseChannel; region: OnboardingRegion }
    | { action: "request-region"; region: OnboardingRegion };
export type OnboardingIntent = OnboardingMutation & { requestId: string };
// A stored request keeps the key it was made with, which may no longer be offered.
export type RegionRequest = { requestId: string; region: string; status: "outstanding"; createdAt: string };
export type OnboardingSummary = {
    version: 3;
    sources: { administrativeBase: number; administrativeBonus: number; baseSource: "legacy" | "administrative" | "none"; membershipAllowance: 0 | 1 };
    membership: { enabled: boolean; verification: "qualifying" | "nonqualifying" | "unknown" | "review_required" | "unverified"; verifiedAt: string | null; validUntil: string | null; refreshMode: "oauth_reauthorization" };
    eligibility: { eligible: boolean; reason: "eligible" | "no_grant" | "quota_exhausted"; granted: number; used: number; remaining: number };
    unavailableReason: typeof ONBOARDING_UNAVAILABLE_REASONS[number] | null;
    regions: { region: OnboardingRegion; label: string; available: boolean; request: RegionRequest | null }[];
    // Outstanding requests for regions this catalog no longer offers.
    otherRequests: RegionRequest[];
};
export type OnboardingResult =
    | { action: "create-server"; serverId: string; displayName: string; releaseChannel?: OnboardingReleaseChannel; region: OnboardingRegion; state: "stopped"; createdAt: string; passwordManagement: "website-owner-controls" | "discord-owner-controls" }
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
    if (!record(value) || !isHostingRegionKey(value.region)) throw invalid();
    if (value.action === "request-region" && keys(value, ["action", "region"])) {
        return { action: value.action, region: value.region };
    }
    if (value.action === "create-server" && keys(value, ["action", "displayName", "region", ...(Object.hasOwn(value, "releaseChannel") ? ["releaseChannel"] : [])])) {
        const displayName = normalizeOnboardingName(value.displayName);
        if (Object.hasOwn(value, "releaseChannel") && value.releaseChannel !== "stable" && value.releaseChannel !== "nightly") throw invalid();
        if (displayName !== null) return { action: value.action, displayName, region: value.region,
            ...(value.releaseChannel !== undefined ? { releaseChannel: value.releaseChannel as OnboardingReleaseChannel } : {}) };
    }
    throw invalid();
}
export function parseOnboardingIntent(value: unknown): OnboardingIntent {
    if (!record(value) || !isOnboardingUuid(value.requestId)) throw invalid();
    const { requestId, ...mutation } = value;
    return { ...parseOnboardingMutation(mutation), requestId: requestId.toLowerCase() };
}
export function parseOnboardingSummary(value: unknown): OnboardingSummary {
    // Version 3 answers exactly the region definitions this website sent, in order, without labels.
    if (!record(value) || !keys(value, ["version", "sources", "membership", "eligibility", "unavailableReason", "regions", "otherRequests"]) || value.version !== 3) throw invalid();
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
        if (!record(entry) || !keys(entry, ["region", "available", "request"])
            || !isHostingRegionKey(entry.region) || entry.region !== ONBOARDING_REGIONS[index]
            || typeof entry.available !== "boolean"
            || (value.unavailableReason !== null && entry.available)) throw invalid();
        const request = entry.request === null ? null : parseRegionRequest(entry.request);
        if (request !== null && request.region !== entry.region) throw invalid();
        return { region: entry.region, label: ONBOARDING_REGION_LABELS[entry.region], available: entry.available, request };
    });
    if (!Array.isArray(value.otherRequests) || value.otherRequests.length > MAXIMUM_OTHER_REQUESTS) throw invalid();
    const otherRequests = value.otherRequests.map(parseRegionRequest);
    if (otherRequests.some((request) => isHostingRegionKey(request.region))) throw invalid();
    return { version: 3, sources: sources as OnboardingSummary["sources"], membership: membership as OnboardingSummary["membership"], eligibility: { eligible: e.eligible, reason, granted: e.granted, used: e.used, remaining }, unavailableReason: value.unavailableReason as OnboardingSummary["unavailableReason"], regions, otherRequests };
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
        && keys(value, ["action", "serverId", "displayName", "region", "state", "createdAt", "passwordManagement", ...(Object.hasOwn(value, "releaseChannel") ? ["releaseChannel"] : [])])
        && (!Object.hasOwn(value, "releaseChannel") || value.releaseChannel === "stable" || value.releaseChannel === "nightly")
        && (value.releaseChannel ?? "stable") === (expected.releaseChannel ?? "stable")
        && isOnboardingUuid(value.serverId) && value.displayName === expected.displayName
        && normalizeOnboardingName(value.displayName) === value.displayName
        && value.region === expected.region && value.state === "stopped" && timestamp(value.createdAt)
        && (value.passwordManagement === "website-owner-controls" || value.passwordManagement === "discord-owner-controls")) {
        return { action: value.action, serverId: value.serverId, displayName: expected.displayName, region: expected.region,
            state: value.state, createdAt: value.createdAt, passwordManagement: value.passwordManagement,
            ...(value.releaseChannel !== undefined ? { releaseChannel: value.releaseChannel as OnboardingReleaseChannel } : {}) };
    }
    throw invalid();
}
function parseRegionRequest(value: unknown): RegionRequest {
    if (!record(value) || !keys(value, ["requestId", "region", "status", "createdAt"])
        || !isOnboardingUuid(value.requestId) || typeof value.region !== "string" || !REGION_KEY_PATTERN.test(value.region)
        || value.status !== "outstanding" || !timestamp(value.createdAt)) throw invalid();
    return { requestId: value.requestId, region: value.region, status: value.status, createdAt: value.createdAt };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: string[]) { return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key)); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function timestamp(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function invalid() { return new Error("Invalid server onboarding DTO"); }
