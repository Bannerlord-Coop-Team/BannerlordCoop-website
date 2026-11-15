import type { GatewayContext } from "./context.ts";
import { firstRow, type GatewayQueries } from "./database.ts";

// The single owner of nightly_gateway.supporter_grants: recording an eligible member's grant, revoking it,
// and storing or resolving the hash of their sponsor code. Deleting a grant cascades to seats and portal sessions.

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

/** Deletes a supporter's grant, which cascades to their seats and sponsor-portal sessions. */
export async function revokeSupporterGrant(tx: GatewayQueries, supporterId: string): Promise<void> {
    await tx.query("DELETE FROM nightly_gateway.supporter_grants WHERE supporter_discord_user_id = $1", [supporterId]);
}

/** Replaces a supporter's sponsor-code hash, so only the newest code redeems. */
export async function replaceSponsorCodeHash(context: GatewayContext, supporterId: string, codeHash: string): Promise<void> {
    await context.db.query(
        "UPDATE nightly_gateway.supporter_grants SET sponsor_code_hash = $1, updated_at = $2 WHERE supporter_discord_user_id = $3",
        [codeHash, context.now(), supporterId],
    );
}

/** Returns the supporter whose current sponsor code has this hash, or null when no grant has it. */
export async function findSupporterByCodeHash(context: GatewayContext, codeHash: string): Promise<string | null> {
    const grant = firstRow(await context.db.query<{ supporter_discord_user_id: string }>(
        "SELECT supporter_discord_user_id FROM nightly_gateway.supporter_grants WHERE sponsor_code_hash = $1",
        [codeHash],
    ));
    return grant?.supporter_discord_user_id ?? null;
}
