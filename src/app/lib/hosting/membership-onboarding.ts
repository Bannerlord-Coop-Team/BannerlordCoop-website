import { currentDiscord, exact, record, timestamp, UUID, type Verification } from "../../../../supabase/functions/_shared/membership";
import type { OnboardingSummary } from "../../../../supabase/functions/_shared/server-onboarding-contract";
export type MembershipStatus = { linked: boolean; verification: Verification; sync: "not_needed" | "pending" | "applied" | "unavailable"; verifiedAt: string | null; validUntil: string | null; retryAt: string | null; refreshMode: "oauth_reauthorization" };
export const NEXT_ACTION = { signed_out: "sign_in", needs_discord: "connect_discord", identity_repair: "repair_account", configuration_blocked: "contact_support", needs_patreon: "connect_patreon", verification_pending: "confirm_account", sync_pending: "refresh_status", nonqualifying: "subscribe_or_upgrade", verification_expired: "check_again", review_required: "contact_support", unavailable: "retry_status", eligible: "choose_name_region", quota_exhausted: "manage_owned_servers", provisioning_unavailable: "retry_status", created: "manage_created_server" } as const;
export type WebsiteOnboardingSummary = { version: 2; accountId: string | null; status: keyof typeof NEXT_ACTION; nextAction: typeof NEXT_ACTION[keyof typeof NEXT_ACTION]; membership: MembershipStatus; allocation: OnboardingSummary | null; ownedServerIds: string[] };
export type AccountStatus = { version: 1; accountId: string; hasDiscord: boolean; configured: boolean; verificationPending: boolean; membership: MembershipStatus };
export const EMPTY_MEMBERSHIP: MembershipStatus = { linked: false, verification: "unverified", sync: "unavailable", verifiedAt: null, validUntil: null, retryAt: null, refreshMode: "oauth_reauthorization" };
export function parseAccountStatus(value: unknown, accountId: string): AccountStatus {
    if (!record(value) || !exact(value, ["version", "accountId", "hasDiscord", "configured", "verificationPending", "membership"]) || value.version !== 1 || value.accountId !== accountId || !UUID.test(accountId) || typeof value.hasDiscord !== "boolean" || typeof value.configured !== "boolean" || typeof value.verificationPending !== "boolean") throw new Error("Invalid account status");
    const m = value.membership;
    if (!record(m) || !exact(m, ["linked", "verification", "sync", "verifiedAt", "validUntil", "retryAt", "refreshMode"]) || typeof m.linked !== "boolean" || !["unverified", "qualifying", "nonqualifying", "unknown", "review_required"].includes(m.verification as string) || !["not_needed", "pending", "applied", "unavailable"].includes(m.sync as string) || m.refreshMode !== "oauth_reauthorization") throw new Error("Invalid membership status");
    for (const field of ["verifiedAt", "validUntil", "retryAt"]) if (m[field] !== null && !timestamp(m[field])) throw new Error("Invalid status time");
    return value as AccountStatus;
}
export function identityStep(user: unknown): "signed_out" | "needs_discord" | "identity_repair" | null {
    if (user === null) return "signed_out";
    try { return currentDiscord(user) === null ? "needs_discord" : null; } catch { return "identity_repair"; }
}
export function composeOnboarding(accountId: string | null, identity: ReturnType<typeof identityStep>, account: AccountStatus | null, allocation: OnboardingSummary | null, ownedServerIds: string[] = [], now = Date.now()): WebsiteOnboardingSummary {
    let status: keyof typeof NEXT_ACTION;
    const m = account?.membership ?? EMPTY_MEMBERSHIP;
    // Browser exact-UUID pending mutation recovery overrides this presentation in ServerOnboarding.
    const independent = allocation !== null && allocation.eligibility.eligible && allocation.sources.administrativeBase + allocation.sources.administrativeBonus > allocation.eligibility.used;
    if (identity !== null) status = identity;
    else if (independent) status = allocation!.unavailableReason === null ? "eligible" : "provisioning_unavailable";
    else if (allocation?.eligibility.reason === "quota_exhausted") status = "quota_exhausted";
    else if (account === null) status = "unavailable";
    else if (!account.hasDiscord) status = "identity_repair";
    else if (!account.configured) status = "configuration_blocked";
    else if (account.verificationPending) status = "verification_pending";
    else if (!m.linked) status = "needs_patreon";
    else if (m.verification === "unverified") status = "verification_expired";
    else if (m.verification === "unknown") status = "unavailable";
    else if (m.verification === "review_required") status = "review_required";
    else if (m.verification === "nonqualifying") status = "nonqualifying";
    else if (m.validUntil === null || Date.parse(m.validUntil) <= now) status = "verification_expired";
    else if (m.sync === "pending") status = "sync_pending";
    else if (allocation === null) status = "unavailable";
    else if (allocation.eligibility.eligible) status = allocation.unavailableReason === null ? "eligible" : "provisioning_unavailable";
    else if (!allocation.membership.enabled) status = "configuration_blocked";
    else if (m.sync === "unavailable") status = "unavailable";
    else status = "review_required";
    return { version: 2, accountId, status, nextAction: NEXT_ACTION[status], membership: m, allocation: identity === null ? allocation : null, ownedServerIds: ownedServerIds.filter(id => UUID.test(id)).slice(0, 1000) };
}
