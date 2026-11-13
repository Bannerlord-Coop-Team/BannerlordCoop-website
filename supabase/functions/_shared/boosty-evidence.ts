// Boosty evidence rules. These decide control-plane removals (the CP treats nonqualifying with
// a recent paidAccessEndedAt as confirmed loss), so every uncertain case stays non-loss.
import { sha256 } from "./membership.ts";
import { BOOSTY_POLICY_VERSION } from "./funding-provider.ts";
import type { BoostySubscriber } from "./boosty-api.ts";
import type { BoostyPolicy } from "./boosty-policy.ts";

export const ABSENCE_CONFIRMATION_MS = 3_600_000;
export type BoostyEvidence = {
    verification: "qualifying" | "nonqualifying" | "unknown"; programId: string; memberId: null; tierIds: string[];
    verifiedAt: string; paidThroughAt: string | null; paidAccessEndedAt?: string; policyVersion: typeof BOOSTY_POLICY_VERSION; evidenceSha256: string;
};
export type LinkedBoostyHead = { accountId: string; providerUserId: string; linkGeneration: string; absentSince: string | null };
export type BoostyDecision = { accountId: string; providerUserId: string; linkGeneration: string; evidence: BoostyEvidence; absentSince: string | null };

type Outcome = { verification: BoostyEvidence["verification"]; tierIds: string[]; paidThroughAt: string | null; endedAt: string | null; absentSince: string | null };
const outcome = (verification: Outcome["verification"], tierIds: string[] = [], paidThroughAt: string | null = null, endedAt: string | null = null): Outcome =>
    ({ verification, tierIds, paidThroughAt, endedAt, absentSince: null });

/** Classifies one linked head against a complete subscriber list; never infers loss from uncertainty. */
function classify(policy: BoostyPolicy, head: LinkedBoostyHead, subscriber: BoostySubscriber | undefined, polledAt: string): Outcome {
    if (subscriber === undefined) {
        // Absent: loss only after a second complete poll at least an hour after the first absence.
        if (head.absentSince === null) return { ...outcome("nonqualifying"), absentSince: polledAt };
        const confirmed = Date.parse(polledAt) - Date.parse(head.absentSince) >= ABSENCE_CONFIRMATION_MS;
        return { ...outcome("nonqualifying", [], null, confirmed ? polledAt : null), absentSince: head.absentSince };
    }
    const { subscribed, status, offTime } = subscriber;
    // Lapsed subscribers stay listed as inactive with the past instant their access ended.
    if (subscribed === false && status === "inactive") return offTime !== null && Date.parse(offTime) <= Date.parse(polledAt) ? outcome("nonqualifying", [], null, offTime) : outcome("unknown");
    if (status === "paused") return outcome("nonqualifying");
    if (subscribed !== true || status !== "active" || subscriber.blacklisted === null || subscriber.levelId === null || subscriber.price === null) return outcome("unknown");
    if (subscriber.blacklisted) return outcome("nonqualifying");
    const qualifies = policy.qualifyingLevelIds.includes(subscriber.levelId) && subscriber.price >= policy.minimumPrice;
    // A future offTime is a cancelled subscription whose paid period runs until then.
    return outcome(qualifies ? "qualifying" : "nonqualifying", [subscriber.levelId], qualifies && offTime !== null && Date.parse(offTime) > Date.parse(polledAt) ? offTime : null);
}

/** Decides one head's evidence; `nextPayTime` is never read, only a cancelled subscription's offTime. */
export async function decideBoostyEvidence(policy: BoostyPolicy, head: LinkedBoostyHead, subscriber: BoostySubscriber | undefined, polledAt: string): Promise<BoostyDecision> {
    const decided = classify(policy, head, subscriber, polledAt);
    // Canonical fixed-order facts; the digest identifies exactly what was observed.
    const facts = [BOOSTY_POLICY_VERSION, policy.blog, policy.priceField, head.providerUserId, polledAt, subscriber === undefined ? "absent" : "listed",
        subscriber?.subscribed ?? null, subscriber?.status ?? null, subscriber?.offTime ?? null, subscriber?.blacklisted ?? null, subscriber?.levelId ?? null, subscriber?.price ?? null,
        decided.verification, decided.endedAt];
    const evidence: BoostyEvidence = {
        verification: decided.verification, programId: policy.blog, memberId: null, tierIds: decided.tierIds, verifiedAt: polledAt, paidThroughAt: decided.paidThroughAt,
        ...(decided.endedAt === null ? {} : { paidAccessEndedAt: decided.endedAt }), policyVersion: BOOSTY_POLICY_VERSION, evidenceSha256: await sha256(JSON.stringify(facts)),
    };
    return { accountId: head.accountId, providerUserId: head.providerUserId, linkGeneration: head.linkGeneration, evidence, absentSince: decided.absentSince };
}

/** Trips when a complete list shrinks by more than the configured fraction of the last complete one. */
export function circuitBreakerTripped(policy: BoostyPolicy, lastCompleteCount: number | null, total: number): boolean {
    if (lastCompleteCount === null || lastCompleteCount === 0) return false;
    return total < lastCompleteCount * (1 - policy.maximumDropFraction);
}
