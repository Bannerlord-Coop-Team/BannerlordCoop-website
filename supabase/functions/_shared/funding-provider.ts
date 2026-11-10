// Closed funding-provider vocabulary and the version 2 snapshot / version 3 claim
// contract served to the control plane. Mirrors CP `membership/funding-provider.ts`.
import { ALLOCATION_POLICY_VERSION, DECIMAL, exact, HASH, IDENTIFIER, POLICY_VERSION, record, timestamp, UUID, type Verification } from "./membership.ts";

export const FUNDING_PROVIDERS = ["patreon", "boosty"] as const;
export type FundingProvider = typeof FUNDING_PROVIDERS[number];
export const BOOSTY_POLICY_VERSION = "boosty-paid-v1" as const;
// Boosty user and level IDs are decimal; a blog is named by its lowercase URL slug.
export const BOOSTY_IDENTIFIER = /^[1-9][0-9]{0,19}$/u;
export const BOOSTY_BLOG = /^[a-z0-9][a-z0-9_-]{0,31}$/u;
const LINK_STATES = ["linked", "unlinked", "identity_changed", "account_deleted"];
const VERIFICATIONS = ["qualifying", "nonqualifying", "unknown", "review_required", "unverified"];
const SNAPSHOT_KEYS = ["version", "provider", "accountId", "discordUserId", "providerUserId", "linkGeneration", "revision", "linkState", "verification", "programId", "memberId", "tierIds", "verifiedAt", "paidThroughAt", "policyVersion", "evidenceSha256"] as const;

export type FundingSnapshot = {
    version: 2; provider: FundingProvider; accountId: string; discordUserId: string | null; providerUserId: string | null;
    linkGeneration: string; revision: string; linkState: "linked" | "unlinked" | "identity_changed" | "account_deleted";
    verification: Verification; programId: string | null; memberId: string | null; tierIds: string[];
    verifiedAt: string | null; paidThroughAt: string | null; paidAccessEndedAt?: string | null;
    policyVersion: FundingPolicyVersion; evidenceSha256: string | null;
};
/** Every policy version any provider's registry entry accepts. */
export type FundingPolicyVersion = (typeof FUNDING_PROVIDER_GRAMMAR)[FundingProvider]["policyVersions"][number];
export type FundingClaimEvent = { eventId: string; accountId: string; provider: FundingProvider };
export type FundingClaim = { version: 3; claimId: string; leaseExpiresAt: string; events: FundingClaimEvent[] };

/** Reports whether a value names a supported funding provider. */
export function isFundingProvider(value: unknown): value is FundingProvider {
    return typeof value === "string" && (FUNDING_PROVIDERS as readonly string[]).includes(value);
}

/** One provider's identifier grammar, member-resource rule and accepted policy versions. */
export type FundingProviderGrammar = {
    readonly userId: RegExp; readonly programId: RegExp; readonly tierId: RegExp;
    readonly memberResource: "uuid" | "none"; readonly policyVersions: readonly string[];
};

// The provider registry, mirroring CP FUNDING_PROVIDER_GRAMMAR. `satisfies` makes a provider without an
// entry a compile error. Patreon IDs are decimal (member is a UUID); Boosty names no member.
export const FUNDING_PROVIDER_GRAMMAR = {
    patreon: { userId: IDENTIFIER, programId: IDENTIFIER, tierId: IDENTIFIER, memberResource: "uuid", policyVersions: [POLICY_VERSION, ALLOCATION_POLICY_VERSION] },
    boosty: { userId: BOOSTY_IDENTIFIER, programId: BOOSTY_BLOG, tierId: BOOSTY_IDENTIFIER, memberResource: "none", policyVersions: [BOOSTY_POLICY_VERSION] },
} as const satisfies Record<FundingProvider, FundingProviderGrammar>;

/** Reports whether a value is null or a string matching the pattern. */
function nullableMatch(value: unknown, pattern: RegExp): boolean {
    return value === null || (typeof value === "string" && pattern.test(value));
}

/** Strictly validates a version 2 snapshot for the requested account and provider; paidAccessEndedAt stays optional. */
export function parseFundingSnapshot(value: unknown, accountId: string, provider: FundingProvider): FundingSnapshot {
    if (!record(value) || !exact(value, [...(Object.hasOwn(value, "paidAccessEndedAt") ? ["paidAccessEndedAt"] : []), ...SNAPSHOT_KEYS])) throw new Error("Invalid funding snapshot");
    if (value.version !== 2 || value.provider !== provider || value.accountId !== accountId || !UUID.test(accountId)) throw new Error("Funding snapshot identity conflicted");
    const grammar: FundingProviderGrammar = FUNDING_PROVIDER_GRAMMAR[provider];
    if (typeof value.linkGeneration !== "string" || !DECIMAL.test(value.linkGeneration) || typeof value.revision !== "string" || !DECIMAL.test(value.revision)) throw new Error("Invalid generation");
    if (!LINK_STATES.includes(value.linkState as string) || !VERIFICATIONS.includes(value.verification as string) || !grammar.policyVersions.includes(value.policyVersion as string)) throw new Error("Invalid funding state");
    if (!nullableMatch(value.discordUserId, /^[0-9]{17,20}$/u) || !nullableMatch(value.providerUserId, grammar.userId) || !nullableMatch(value.programId, grammar.programId)) throw new Error("Invalid identifier");
    if (grammar.memberResource === "none" ? value.memberId !== null : !nullableMatch(value.memberId, UUID)) throw new Error("Invalid member identifier");
    if (!Array.isArray(value.tierIds) || value.tierIds.length > 50 || !value.tierIds.every(id => typeof id === "string" && grammar.tierId.test(id)) || new Set(value.tierIds).size !== value.tierIds.length) throw new Error("Invalid tiers");
    for (const field of ["verifiedAt", "paidThroughAt"]) if (value[field] !== null && !timestamp(value[field])) throw new Error("Invalid timestamp");
    if (value.paidAccessEndedAt !== undefined && value.paidAccessEndedAt !== null && !timestamp(value.paidAccessEndedAt)) throw new Error("Invalid paid access end");
    if (!nullableMatch(value.evidenceSha256, HASH)) throw new Error("Invalid digest");
    return value as FundingSnapshot;
}

/** Strictly validates a version 3 claim page for the requested claim identity and page bound. */
export function parseFundingClaim(value: unknown, claimId: string, limit: number): FundingClaim {
    if (!record(value) || !exact(value, ["version", "claimId", "leaseExpiresAt", "events"]) || value.version !== 3 || value.claimId !== claimId || !timestamp(value.leaseExpiresAt)) throw new Error("Invalid funding claim");
    if (!Array.isArray(value.events) || value.events.length > limit) throw new Error("Invalid funding claim page");
    const valid = value.events.every(e => record(e) && exact(e, ["eventId", "accountId", "provider"]) && typeof e.eventId === "string" && UUID.test(e.eventId) && typeof e.accountId === "string" && UUID.test(e.accountId) && isFundingProvider(e.provider));
    if (!valid) throw new Error("Invalid funding claim event");
    return value as FundingClaim;
}
