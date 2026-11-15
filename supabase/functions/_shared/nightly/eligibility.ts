import type { GatewayContext } from "./context.ts";
import { GatewayError } from "./http.ts";
import { isEligibleNightlySponsor } from "./policy.ts";

/** Re-checks a sponsor's live Discord roles; an ineligible sponsor loses grants and download sessions. */
export async function assertSponsorEligible(context: GatewayContext, supporterId: string): Promise<void> {
    const member = await context.discord.botGuildMember(supporterId);
    if (isEligibleNightlySponsor(member)) return;
    await context.db.batch([
        context.db.prepare("DELETE FROM download_sessions WHERE supporter_discord_user_id = ?").bind(supporterId),
        context.db.prepare("DELETE FROM supporter_grants WHERE supporter_discord_user_id = ?").bind(supporterId),
    ]);
    throw new GatewayError(403, "supporter_role_required");
}

/** Like assertSponsorEligible, but reports ineligibility as false; Discord failures still throw. */
export async function isSponsorStillEligible(context: GatewayContext, supporterId: string): Promise<boolean> {
    try {
        await assertSponsorEligible(context, supporterId);
        return true;
    } catch (error) {
        if (error instanceof GatewayError && error.code === "supporter_role_required") return false;
        throw error;
    }
}

/** Records (or refreshes) an eligible member's supporter grant; refresh tokens are no longer stored. */
export async function storeSupporterGrant(context: GatewayContext, supporterId: string): Promise<void> {
    await context.db.prepare(`
        INSERT INTO supporter_grants (supporter_discord_user_id, encrypted_refresh_token, token_nonce, updated_at)
        VALUES (?, NULL, NULL, ?)
        ON CONFLICT(supporter_discord_user_id) DO UPDATE SET
          encrypted_refresh_token = NULL,
          token_nonce = NULL,
          updated_at = excluded.updated_at
    `).bind(supporterId, context.now()).run();
}

/** Marks a device session approved for a user under the given sponsor (themselves for direct members). */
export async function approveDevice(
    context: GatewayContext,
    deviceId: string,
    userId: string,
    sponsorId: string,
): Promise<void> {
    await context.db.prepare(
        "UPDATE device_sessions SET status = 'approved', discord_user_id = ?, sponsor_discord_user_id = ?, authorized_at = ? WHERE id = ?",
    ).bind(userId, sponsorId, context.now(), deviceId).run();
}
