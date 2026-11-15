import type { GatewayContext } from "./context.ts";
import { revokeDownloadsForSupporter } from "./downloads.ts";
import { revokeSupporterGrant } from "./grants.ts";
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
        await revokeSupporterGrant(tx, supporterId);
    });
    return false;
}

/** Throws `403 supporter_role_required` for a sponsor who no longer qualifies, after revoking them. */
export async function assertSponsorEligible(context: GatewayContext, supporterId: string): Promise<void> {
    if (!await revokeSponsorIfIneligible(context, supporterId)) throw new GatewayError(403, "supporter_role_required");
}
