import type { GatewayContext } from "./context.ts";
import { revokeDownloadsForSupporter } from "./downloads.ts";
import { GatewayError } from "./http.ts";
import { isEligibleNightlySponsor } from "./policy.ts";

/**
 * Re-checks a sponsor's live Discord roles and returns whether they still qualify. An ineligible sponsor's
 * grant (cascading to seats and portal sessions) and download sessions are deleted; Discord failures throw.
 */
export async function revokeSponsorIfIneligible(context: GatewayContext, supporterId: string): Promise<boolean> {
    const member = await context.discord.botGuildMember(supporterId);
    if (isEligibleNightlySponsor(member)) return true;
    await context.db.transaction(async (tx) => {
        await revokeDownloadsForSupporter(tx, supporterId);
        await tx.query("DELETE FROM nightly_gateway.supporter_grants WHERE supporter_discord_user_id = $1", [supporterId]);
    });
    return false;
}

/** Throws `403 supporter_role_required` for a sponsor who no longer qualifies, after revoking them. */
export async function assertSponsorEligible(context: GatewayContext, supporterId: string): Promise<void> {
    if (!await revokeSponsorIfIneligible(context, supporterId)) throw new GatewayError(403, "supporter_role_required");
}

/** Records (or refreshes) an eligible member's supporter grant; refresh tokens are no longer stored. */
export async function storeSupporterGrant(context: GatewayContext, supporterId: string): Promise<void> {
    await context.db.query(
        `INSERT INTO nightly_gateway.supporter_grants (supporter_discord_user_id, encrypted_refresh_token, token_nonce, updated_at)
         VALUES ($1, NULL, NULL, $2)
         ON CONFLICT (supporter_discord_user_id) DO UPDATE SET
           encrypted_refresh_token = NULL,
           token_nonce = NULL,
           updated_at = excluded.updated_at`,
        [supporterId, context.now()],
    );
}
