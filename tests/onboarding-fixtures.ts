// Synthetic contract fixtures only. Not imported by production code.
import { ONBOARDING_REGIONS, ONBOARDING_REGION_LABELS, type OnboardingSummary, type OnboardingResult } from "../supabase/functions/_shared/server-onboarding-contract";
export const ONBOARDING_TEST_ID = "abcdefab-1111-4111-8111-111111111111";
export const ONBOARDING_TEST_TIME = "2026-09-07T14:00:00.000Z";
export function onboardingSummary(): OnboardingSummary {
    return { version: 2, sources: { administrativeBase: 1, administrativeBonus: 0, baseSource: "administrative", membershipAllowance: 0 }, membership: { enabled: false, verification: "unverified", verifiedAt: null, validUntil: null, refreshMode: "oauth_reauthorization" }, eligibility: { eligible: true, reason: "eligible", granted: 1, used: 0, remaining: 1 }, unavailableReason: null,
        regions: ONBOARDING_REGIONS.map((region, index) => ({ region, label: ONBOARDING_REGION_LABELS[region], available: index < 2, request: null })) };
}
export function onboardingCreated(): OnboardingResult & { action: "create-server" } {
    return { action: "create-server", serverId: ONBOARDING_TEST_ID, displayName: "My Campaign", region: "us-west", state: "stopped", createdAt: ONBOARDING_TEST_TIME, passwordManagement: "discord-owner-controls" };
}
export function onboardingRequested(): OnboardingResult & { action: "request-region" } {
    return { action: "request-region", request: { requestId: ONBOARDING_TEST_ID, region: "france", status: "outstanding", createdAt: ONBOARDING_TEST_TIME } };
}
