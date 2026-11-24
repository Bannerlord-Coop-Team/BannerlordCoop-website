// Website-account Boosty status: whether the poll linked this account by email, and its
// verification. No Boosty user id leaves this boundary.
import { exact, record } from "./membership.ts";
import { parseFundingSnapshot } from "./funding-provider.ts";
import type { membershipStore } from "./membership-store.ts";

type Store = ReturnType<typeof membershipStore>;
type User = { accountId: string; discordUserId: string | null };
const VERIFICATIONS = ["qualifying", "nonqualifying", "unknown", "review_required", "unverified"];
export type BoostyStatus = { version: 1; configured: false } | { version: 1; configured: true; linked: boolean; verification: string };

/** Reads the account's fenced Boosty head as the public status; inert while the adapter is unconfigured. */
export async function boostyStatus(store: Store, user: User, configured: boolean): Promise<BoostyStatus> {
    if (!configured) return { version: 1, configured: false };
    const value = await store.rpc("membership_funding_fence", { p_account_id: user.accountId, p_provider: "boosty", p_discord_user_id: user.discordUserId, p_deleted: false });
    const snapshot = parseFundingSnapshot(value, user.accountId, "boosty");
    return { version: 1, configured: true, linked: snapshot.linkState === "linked", verification: snapshot.verification };
}

/** Strictly validates the Edge's public Boosty status reply for the website server. */
export function parseBoostyStatus(value: unknown): BoostyStatus {
    if (!record(value) || value.version !== 1) throw new Error("Invalid Boosty status");
    if (value.configured === false && exact(value, ["version", "configured"])) return { version: 1, configured: false };
    if (value.configured !== true || !exact(value, ["version", "configured", "linked", "verification"]) || typeof value.linked !== "boolean"
        || !VERIFICATIONS.includes(value.verification as string)) throw new Error("Invalid Boosty status");
    return value as BoostyStatus;
}
