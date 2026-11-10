// Boosty evidence rules. These decide control-plane removals (the CP treats nonqualifying with
// a recent paidAccessEndedAt as confirmed loss), so every uncertain case stays non-loss.
import { sha256 } from "./membership.ts";
import { BOOSTY_POLICY_VERSION } from "./funding-provider.ts";
import type { BoostySubscriber } from "./boosty-api.ts";
import type { BoostyPolicy } from "./boosty-policy.ts";

export const ABSENCE_CONFIRMATION_MS = 3_600_000;
export type BoostyEvidence = {
    verification: "qualifying" | "nonqualifying" | "unknown"; programId: string; memberId: null; tierIds: string[];
    verifiedAt: string; paidThroughAt: null; paidAccessEndedAt?: string; policyVersion: typeof BOOSTY_POLICY_VERSION; evidenceSha256: string;
};
export type LinkedBoostyHead = { accountId: string; providerUserId: string; linkGeneration: string; absentSince: string | null };
export type BoostyDecision = { accountId: string; providerUserId: string; linkGeneration: string; evidence: BoostyEvidence; absentSince: string | null };

type Outcome = { verification: BoostyEvidence["verification"]; tierIds: string[]; loss: boolean; absentSince: string | null };

/** Classifies one linked head against a complete subscriber list; never infers loss from uncertainty. */
function classify(policy: BoostyPolicy, head: LinkedBoostyHead, subscriber: BoostySubscriber | undefined, polledAt: string): Outcome {
    if (subscriber === undefined) {
        // Absent: loss only after a second complete poll at least an hour after the first absence.
        if (head.absentSince === null) return { verification: "nonqualifying", tierIds: [], loss: false, absentSince: polledAt };
        const confirmed = Date.parse(polledAt) - Date.parse(head.absentSince) >= ABSENCE_CONFIRMATION_MS;
        return { verification: "nonqualifying", tierIds: [], loss: confirmed, absentSince: head.absentSince };
    }
    if (subscriber.subscribed === false) return { verification: "nonqualifying", tierIds: [], loss: true, absentSince: null };
    if (subscriber.subscribed !== true || subscriber.blacklisted === null || subscriber.levelId === null || subscriber.price === null) {
        return { verification: "unknown", tierIds: [], loss: false, absentSince: null };
    }
    if (subscriber.blacklisted) return { verification: "nonqualifying", tierIds: [], loss: false, absentSince: null };
    const qualifies = policy.qualifyingLevelIds.includes(subscriber.levelId) && subscriber.price >= policy.minimumPrice;
    return { verification: qualifies ? "qualifying" : "nonqualifying", tierIds: [subscriber.levelId], loss: false, absentSince: null };
}

/** Decides one head's evidence; `nextPayTime` is never read, so paidThroughAt is always null. */
export async function decideBoostyEvidence(policy: BoostyPolicy, head: LinkedBoostyHead, subscriber: BoostySubscriber | undefined, polledAt: string): Promise<BoostyDecision> {
    const outcome = classify(policy, head, subscriber, polledAt);
    // Canonical fixed-order facts; the digest identifies exactly what was observed.
    const facts = [BOOSTY_POLICY_VERSION, policy.blog, policy.priceField, head.providerUserId, polledAt, subscriber === undefined ? "absent" : "listed",
        subscriber?.subscribed ?? null, subscriber?.blacklisted ?? null, subscriber?.levelId ?? null, subscriber?.price ?? null, outcome.verification, outcome.loss];
    const evidence: BoostyEvidence = {
        verification: outcome.verification, programId: policy.blog, memberId: null, tierIds: outcome.tierIds, verifiedAt: polledAt, paidThroughAt: null,
        ...(outcome.loss ? { paidAccessEndedAt: polledAt } : {}), policyVersion: BOOSTY_POLICY_VERSION, evidenceSha256: await sha256(JSON.stringify(facts)),
    };
    return { accountId: head.accountId, providerUserId: head.providerUserId, linkGeneration: head.linkGeneration, evidence, absentSince: outcome.absentSince };
}

/** Trips when a complete list shrinks by more than the configured fraction of the last complete one. */
export function circuitBreakerTripped(policy: BoostyPolicy, lastCompleteCount: number | null, total: number): boolean {
    if (lastCompleteCount === null || lastCompleteCount === 0) return false;
    return total < lastCompleteCount * (1 - policy.maximumDropFraction);
}
