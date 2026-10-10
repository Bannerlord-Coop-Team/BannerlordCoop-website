// Shared closed, public DTOs: usable by both the Edge boundary and website facade.
// Regions are keys only: the control plane resolves each key against its own stored catalog.
import { hasExactKeys, isRecord } from "./dto-validation.ts";
import { isRegionKey, MAXIMUM_REGIONS } from "./hosting-regions.ts";

// The onboarding summary version this website requests and accepts.
const ONBOARDING_SUMMARY_VERSION = 3;
const MAXIMUM_OTHER_REQUESTS = 32;
export const ONBOARDING_UNAVAILABLE_REASONS = ["provider_cannot_assign", "required_approval_missing", "pilot_only", "provisioning_paused", "validated_build_unavailable"] as const;
export type OnboardingReleaseChannel = "stable" | "nightly";
export type OnboardingMutation =
    | { action: "create-server"; displayName: string; releaseChannel?: OnboardingReleaseChannel; region: string }
    | { action: "request-region"; region: string };
export type OnboardingIntent = OnboardingMutation & { requestId: string };
// A stored request keeps the key it was made with, which may no longer be offered.
export type RegionRequest = { requestId: string; region: string; status: "outstanding"; createdAt: string };
/** One entry of the control plane's stored region catalog, in its stored order. */
export type OnboardingRegionStatus = { region: string; available: boolean; request: RegionRequest | null };
export type OnboardingSummary = {
    version: typeof ONBOARDING_SUMMARY_VERSION;
    sources: { administrativeBase: number; administrativeBonus: number; baseSource: "legacy" | "administrative" | "none"; membershipAllowance: 0 | 1 };
    membership: { enabled: boolean; verification: "qualifying" | "nonqualifying" | "unknown" | "review_required" | "unverified"; verifiedAt: string | null; validUntil: string | null; refreshMode: "oauth_reauthorization" };
    eligibility: { eligible: boolean; reason: "eligible" | "no_grant" | "quota_exhausted"; granted: number; used: number; remaining: number };
    unavailableReason: typeof ONBOARDING_UNAVAILABLE_REASONS[number] | null;
    regions: OnboardingRegionStatus[];
    // Outstanding requests whose key the stored catalog no longer offers.
    otherRequests: RegionRequest[];
};
export type OnboardingResult =
    | { action: "create-server"; serverId: string; displayName: string; releaseChannel?: OnboardingReleaseChannel; region: string; state: "stopped"; createdAt: string; passwordManagement: "website-owner-controls" | "discord-owner-controls" }
    | { action: "request-region"; request: RegionRequest };
/** The exact control-plane operations onboarding sends; owners never send placements. */
type OnboardingControlPlaneRequest =
    | { operation: "server-onboarding"; input: { version: typeof ONBOARDING_SUMMARY_VERSION } }
    | { operation: "create-server"; input: { displayName: string; region: string; releaseChannel?: OnboardingReleaseChannel } }
    | { operation: "request-region"; input: { region: string } };

/** The control-plane request for the owner's onboarding summary. */
export type OnboardingSummaryRequest = Extract<OnboardingControlPlaneRequest, { operation: "server-onboarding" }>;
/** Builds the control-plane request for the owner's version-3 onboarding summary. */
export function onboardingSummaryRequest(): OnboardingSummaryRequest {
    return { operation: "server-onboarding", input: { version: ONBOARDING_SUMMARY_VERSION } };
}

/** The key-only control-plane requests for owner mutations. */
export type OnboardingMutationRequest = Exclude<OnboardingControlPlaneRequest, { operation: "server-onboarding" }>;
/** Builds the key-only control-plane request for one parsed owner mutation. */
export function onboardingMutationRequest(mutation: OnboardingMutation): OnboardingMutationRequest {
    if (mutation.action === "request-region") return { operation: mutation.action, input: { region: mutation.region } };
    const { action, ...input } = mutation;
    return { operation: action, input };
}
/** Recovers the owner mutation a key-only control-plane request carries, so its receipt can be checked against it. */
export function onboardingRequestMutation(request: OnboardingMutationRequest): OnboardingMutation {
    if (request.operation === "request-region") return { action: request.operation, region: request.input.region };
    return { action: request.operation, ...request.input };
}
/** Whether a value is a v1-v8 UUID in either case. */
export function isOnboardingUuid(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
/** Applies the backend's server-name policy; null when the name is not acceptable. */
export function normalizeOnboardingName(value: unknown): string | null {
    if (typeof value !== "string" || value.length < 3 || value.length > 48) return null;
    const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    return name.length >= 3 && name.length <= 48 && /^[\p{L}\p{N}][\p{L}\p{N} .'-]*[\p{L}\p{N}]$/u.test(name) ? name : null;
}
/** Parses a browser mutation: a well-formed region key and, for Create, a policy-conforming name; nothing else. */
export function parseOnboardingMutation(value: unknown): OnboardingMutation {
    if (!isRecord(value) || !isRegionKey(value.region)) throw invalid();
    if (value.action === "request-region" && hasExactKeys(value, ["action", "region"])) {
        return { action: value.action, region: value.region };
    }
    if (value.action !== "create-server") throw invalid();
    const hasChannel = Object.hasOwn(value, "releaseChannel");
    if (!hasExactKeys(value, ["action", "displayName", "region", ...(hasChannel ? ["releaseChannel"] : [])])) throw invalid();
    if (hasChannel && value.releaseChannel !== "stable" && value.releaseChannel !== "nightly") throw invalid();
    const displayName = normalizeOnboardingName(value.displayName);
    if (displayName === null) throw invalid();
    return { action: value.action, displayName, region: value.region,
        ...(hasChannel ? { releaseChannel: value.releaseChannel as OnboardingReleaseChannel } : {}) };
}
/** Parses a retained or submitted intent: a mutation plus its lowercased idempotency UUID. */
export function parseOnboardingIntent(value: unknown): OnboardingIntent {
    if (!isRecord(value) || !isOnboardingUuid(value.requestId)) throw invalid();
    const { requestId, ...mutation } = value;
    return { ...parseOnboardingMutation(mutation), requestId: requestId.toLowerCase() };
}
/** Parses the version-3 summary: the control plane's stored catalog in its order, plus requests outside it. */
export function parseOnboardingSummary(value: unknown): OnboardingSummary {
    if (!isRecord(value) || !hasExactKeys(value, ["version", "sources", "membership", "eligibility", "unavailableReason", "regions", "otherRequests"])) throw invalid();
    if (value.version !== ONBOARDING_SUMMARY_VERSION) throw invalid();
    if (value.unavailableReason !== null && !ONBOARDING_UNAVAILABLE_REASONS.includes(value.unavailableReason as never)) throw invalid();
    const unavailableReason = value.unavailableReason as OnboardingSummary["unavailableReason"];
    const regions = parseRegionStatuses(value.regions, unavailableReason !== null);
    const otherRequests = parseOtherRequests(value.otherRequests, regions);
    return { version: ONBOARDING_SUMMARY_VERSION, sources: parseSources(value.sources), membership: parseMembership(value.membership),
        eligibility: parseEligibility(value.eligibility), unavailableReason, regions, otherRequests };
}
/** Parses a mutation receipt and requires it to answer exactly the expected mutation. */
export function parseOnboardingResult(value: unknown, expected: OnboardingMutation): OnboardingResult {
    if (!isRecord(value) || value.action !== expected.action) throw invalid();
    if (expected.action === "create-server") return parseCreatedServer(value, expected);
    if (!hasExactKeys(value, ["action", "request"])) throw invalid();
    const request = parseRegionRequest(value.request);
    // Dedupe may return another UUID for the same owner's outstanding region request.
    if (request.region !== expected.region) throw invalid();
    return { action: expected.action, request };
}
/** Parses a Create receipt that echoes the expected name, region and channel. */
function parseCreatedServer(value: Record<string, unknown>, expected: Extract<OnboardingMutation, { action: "create-server" }>): OnboardingResult {
    const hasChannel = Object.hasOwn(value, "releaseChannel");
    if (!hasExactKeys(value, ["action", "serverId", "displayName", "region", "state", "createdAt", "passwordManagement", ...(hasChannel ? ["releaseChannel"] : [])])) throw invalid();
    if (hasChannel && value.releaseChannel !== "stable" && value.releaseChannel !== "nightly") throw invalid();
    if ((value.releaseChannel ?? "stable") !== (expected.releaseChannel ?? "stable")) throw invalid();
    if (!isOnboardingUuid(value.serverId) || value.displayName !== expected.displayName || normalizeOnboardingName(value.displayName) !== value.displayName) throw invalid();
    if (value.region !== expected.region || value.state !== "stopped" || !timestamp(value.createdAt)) throw invalid();
    if (value.passwordManagement !== "website-owner-controls" && value.passwordManagement !== "discord-owner-controls") throw invalid();
    return { action: "create-server", serverId: value.serverId, displayName: expected.displayName, region: expected.region,
        state: value.state, createdAt: value.createdAt, passwordManagement: value.passwordManagement,
        ...(hasChannel ? { releaseChannel: value.releaseChannel as OnboardingReleaseChannel } : {}) };
}
/** Parses allocation sources without extra fields. */
function parseSources(sources: unknown): OnboardingSummary["sources"] {
    if (!isRecord(sources) || !hasExactKeys(sources, ["administrativeBase", "administrativeBonus", "baseSource", "membershipAllowance"])) throw invalid();
    if (!integer(sources.administrativeBase) || !integer(sources.administrativeBonus)) throw invalid();
    if (!["legacy", "administrative", "none"].includes(sources.baseSource as string) || ![0, 1].includes(sources.membershipAllowance as number)) throw invalid();
    return sources as OnboardingSummary["sources"];
}
/** Parses the membership state without extra fields. */
function parseMembership(membership: unknown): OnboardingSummary["membership"] {
    if (!isRecord(membership) || !hasExactKeys(membership, ["enabled", "verification", "verifiedAt", "validUntil", "refreshMode"])) throw invalid();
    if (typeof membership.enabled !== "boolean" || membership.refreshMode !== "oauth_reauthorization") throw invalid();
    if (!["qualifying", "nonqualifying", "unknown", "review_required", "unverified"].includes(membership.verification as string)) throw invalid();
    if ((membership.verifiedAt !== null && !timestamp(membership.verifiedAt)) || (membership.validUntil !== null && !timestamp(membership.validUntil))) throw invalid();
    return membership as OnboardingSummary["membership"];
}
/** Parses eligibility and requires its derived fields to be internally consistent. */
function parseEligibility(e: unknown): OnboardingSummary["eligibility"] {
    if (!isRecord(e) || !hasExactKeys(e, ["eligible", "reason", "granted", "used", "remaining"])) throw invalid();
    if (typeof e.eligible !== "boolean" || !integer(e.granted) || !integer(e.used) || !integer(e.remaining)) throw invalid();
    const remaining = Math.max(0, e.granted - e.used);
    const reason = e.granted === 0 ? "no_grant" : remaining === 0 ? "quota_exhausted" : "eligible";
    if (e.remaining !== remaining || e.reason !== reason || e.eligible !== (reason === "eligible")) throw invalid();
    return { eligible: e.eligible, reason, granted: e.granted, used: e.used, remaining };
}
/** Parses the stored catalog: 1..32 unique keys, each request belonging to its entry; none available while blocked. */
function parseRegionStatuses(value: unknown, blocked: boolean): OnboardingRegionStatus[] {
    // An empty stored catalog fails closed: the summary is rejected, so owners see onboarding as unavailable.
    if (!Array.isArray(value) || value.length < 1 || value.length > MAXIMUM_REGIONS) throw invalid();
    const regions = value.map((entry: unknown) => {
        if (!isRecord(entry) || !hasExactKeys(entry, ["region", "available", "request"]) || !isRegionKey(entry.region)) throw invalid();
        if (typeof entry.available !== "boolean" || (blocked && entry.available)) throw invalid();
        const request = entry.request === null ? null : parseRegionRequest(entry.request);
        if (request !== null && request.region !== entry.region) throw invalid();
        return { region: entry.region, available: entry.available, request };
    });
    if (new Set(regions.map((entry) => entry.region)).size !== regions.length) throw invalid();
    return regions;
}
/** Parses requests outside the stored catalog; their keys and every request ID must be distinct from the catalog's. */
function parseOtherRequests(value: unknown, regions: readonly OnboardingRegionStatus[]): RegionRequest[] {
    if (!Array.isArray(value) || value.length > MAXIMUM_OTHER_REQUESTS) throw invalid();
    const otherRequests = value.map(parseRegionRequest);
    if (otherRequests.some((request) => regions.some((entry) => entry.region === request.region))) throw invalid();
    const requestIds = [...regions.flatMap((entry) => entry.request ?? []), ...otherRequests].map((request) => request.requestId.toLowerCase());
    if (new Set(requestIds).size !== requestIds.length) throw invalid();
    return otherRequests;
}
/** Parses one outstanding region request. */
function parseRegionRequest(value: unknown): RegionRequest {
    if (!isRecord(value) || !hasExactKeys(value, ["requestId", "region", "status", "createdAt"])) throw invalid();
    if (!isOnboardingUuid(value.requestId) || !isRegionKey(value.region) || value.status !== "outstanding" || !timestamp(value.createdAt)) throw invalid();
    return { requestId: value.requestId, region: value.region, status: value.status, createdAt: value.createdAt };
}
/** Whether a value is a non-negative safe integer. */
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
/** Whether a value is a canonical millisecond ISO-8601 UTC timestamp. */
function timestamp(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
/** The single error type every rejected onboarding DTO raises. */
class OnboardingDtoError extends Error { constructor() { super("Invalid server onboarding DTO"); } }
/** The single error every rejected DTO raises. */
function invalid() { return new OnboardingDtoError(); }
