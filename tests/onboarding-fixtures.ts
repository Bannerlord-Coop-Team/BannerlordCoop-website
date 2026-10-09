// Synthetic contract fixtures only. Not imported by production code.
import type { OnboardingRegionStatus, OnboardingSummary, OnboardingResult } from "../supabase/functions/_shared/server-onboarding-contract";
import { HOSTING_REGIONS } from "../supabase/functions/_shared/hosting-regions";
export const ONBOARDING_TEST_ID = "abcdefab-1111-4111-8111-111111111111";
export const ONBOARDING_TEST_TIME = "2026-09-07T14:00:00.000Z";
/** A summary whose stored catalog equals the website catalog (the control plane's seed); only the US regions have capacity. */
export function onboardingSummary(): OnboardingSummary {
    return { version: 3, sources: { administrativeBase: 1, administrativeBonus: 0, baseSource: "administrative", membershipAllowance: 0 }, membership: { enabled: false, verification: "unverified", verifiedAt: null, validUntil: null, refreshMode: "oauth_reauthorization" }, eligibility: { eligible: true, reason: "eligible", granted: 1, used: 0, remaining: 1 }, unavailableReason: null,
        regions: HOSTING_REGIONS.map(({ key }) => ({ region: key, available: key === "us-west" || key === "us-east", request: null })),
        otherRequests: [] };
}
/** The summary entry for one region key, so tests adjust regions by key rather than position. */
export function onboardingRegion(summary: OnboardingSummary, region: string): OnboardingRegionStatus {
    const entry = summary.regions.find((candidate) => candidate.region === region);
    if (entry === undefined) throw new Error(`No ${region} in the onboarding summary`);
    return entry;
}
/** A Create receipt for "My Campaign" in US-West. */
export function onboardingCreated(): OnboardingResult & { action: "create-server" } {
    return { action: "create-server", serverId: ONBOARDING_TEST_ID, displayName: "My Campaign", region: "us-west", state: "stopped", createdAt: ONBOARDING_TEST_TIME, passwordManagement: "discord-owner-controls" };
}
/** A Request receipt for France. */
export function onboardingRequested(): OnboardingResult & { action: "request-region" } {
    return { action: "request-region", request: { requestId: ONBOARDING_TEST_ID, region: "france", status: "outstanding", createdAt: ONBOARDING_TEST_TIME } };
}
/** A version-2 summary from a control plane without the stored catalog: its six fixed regions with labels; only US-West has capacity. */
export function legacyOnboardingSummary() {
    const { regions: _regions, otherRequests: _otherRequests, ...rest } = onboardingSummary();
    const labels = [["us-west", "US-West"], ["us-east", "US-East"], ["france", "France"], ["germany", "Germany"],
        ["united-kingdom", "United Kingdom"], ["poland", "Poland"]] as const;
    return { ...rest, version: 2, regions: labels.map(([region, label]) => ({ region, label, available: region === "us-west", request: null })) };
}
