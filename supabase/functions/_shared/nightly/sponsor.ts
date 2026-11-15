import type { GatewayContext } from "./context.ts";
import { firstRow } from "./database.ts";
import { approveDevice } from "./device.ts";
import { assertSponsorEligible, revokeSponsorIfIneligible } from "./eligibility.ts";
import { GatewayError, json } from "./http.ts";
import { isDiscordSnowflake, SPONSORED_ACCOUNT_LIMIT } from "./policy.ts";
import { normalizeSponsorCode, randomSponsorCode, SECRET_TOKEN_PATTERN, sha256, UUID_PATTERN } from "./tokens.ts";

const MAXIMUM_SPONSOR_CODE_LENGTH = 128;

type ClaimableDevice = { discord_user_id: string | null; status: string; expires_at: number };
type SupporterRow = { supporter_discord_user_id: string };

/** `POST /sponsorship/claim`: spends a sponsor's seat on an awaiting device's Discord account and approves it. */
export async function claimSponsorship(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const { device_id: deviceId, sponsor_code: sponsorCode } = body;
    if (typeof deviceId !== "string" || !UUID_PATTERN.test(deviceId)
        || typeof sponsorCode !== "string" || sponsorCode.length > MAXIMUM_SPONSOR_CODE_LENGTH) {
        throw new GatewayError(400, "invalid_request");
    }
    const device = firstRow(await context.db.query<ClaimableDevice>(
        "SELECT discord_user_id, status, expires_at FROM nightly_gateway.device_sessions WHERE id = $1",
        [deviceId],
    ));
    if (device === null || device.status !== "awaiting-sponsor" || device.expires_at < context.now()
        || !isDiscordSnowflake(device.discord_user_id)) {
        throw new GatewayError(400, "expired");
    }
    const sponsorId = await eligibleSponsorForCode(context, sponsorCode);
    const holder = await releaseRevokedSeat(context, device.discord_user_id, sponsorId);
    await takeSeat(context, device.discord_user_id, sponsorId, holder);
    await approveDevice(context, deviceId, device.discord_user_id, sponsorId);
    return json({ outcome: "sponsored-approved" });
}

/** `POST /sponsor/portal`: lists an eligible sponsor's seats; an ineligible sponsor is `403`. */
export async function sponsorPortal(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const sponsorId = await requireSponsorSession(context, body.session);
    await assertSponsorEligible(context, sponsorId);
    const seats = await context.db.query<{ sponsored_discord_user_id: string; created_at: number }>(
        `SELECT sponsored_discord_user_id, created_at FROM nightly_gateway.sponsorships
         WHERE supporter_discord_user_id = $1 ORDER BY created_at`,
        [sponsorId],
    );
    return json({
        seats: seats.rows.map((row) => ({ discord_user_id: row.sponsored_discord_user_id, created_at: row.created_at })),
        limit: SPONSORED_ACCOUNT_LIMIT,
    });
}

/** `POST /sponsor/code`: replaces the sponsor's code with a new one, returned once and stored as a hash. */
export async function rotateSponsorCode(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const sponsorId = await requireSponsorSession(context, body.session);
    const code = randomSponsorCode(context.random);
    await context.db.query(
        "UPDATE nightly_gateway.supporter_grants SET sponsor_code_hash = $1, updated_at = $2 WHERE supporter_discord_user_id = $3",
        [await sha256(code), context.now(), sponsorId],
    );
    return json({ code });
}

/** `POST /sponsor/remove`: frees one seat and ends that friend's download sessions under this sponsor. */
export async function removeSponsoredAccount(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const sponsorId = await requireSponsorSession(context, body.session);
    const friendId = body.discord_user_id;
    if (!isDiscordSnowflake(friendId)) throw new GatewayError(400, "invalid_request");
    await context.db.transaction(async (tx) => {
        await tx.query(
            "DELETE FROM nightly_gateway.sponsorships WHERE supporter_discord_user_id = $1 AND sponsored_discord_user_id = $2",
            [sponsorId, friendId],
        );
        await tx.query(
            "DELETE FROM nightly_gateway.download_sessions WHERE discord_user_id = $1 AND supporter_discord_user_id = $2",
            [friendId, sponsorId],
        );
    });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/** Resolves a sponsor session token to its supporter; malformed is `authorization_required`, stale `authorization_expired`. */
async function requireSponsorSession(context: GatewayContext, token: unknown): Promise<string> {
    if (typeof token !== "string" || !SECRET_TOKEN_PATTERN.test(token)) throw new GatewayError(401, "authorization_required");
    const row = firstRow(await context.db.query<{ supporter_discord_user_id: string; expires_at: number }>(
        "SELECT supporter_discord_user_id, expires_at FROM nightly_gateway.sponsor_sessions WHERE token_hash = $1",
        [await sha256(token)],
    ));
    if (row === null || row.expires_at < context.now()) throw new GatewayError(401, "authorization_expired");
    return row.supporter_discord_user_id;
}

/** Finds the supporter behind a sponsor code and re-checks their live Discord eligibility. */
async function eligibleSponsorForCode(context: GatewayContext, sponsorCode: string): Promise<string> {
    const sponsor = firstRow(await context.db.query<SupporterRow>(
        "SELECT supporter_discord_user_id FROM nightly_gateway.supporter_grants WHERE sponsor_code_hash = $1",
        [await sha256(normalizeSponsorCode(sponsorCode))],
    ));
    if (sponsor === null) throw new GatewayError(403, "invalid_sponsor_code");
    await assertSponsorEligible(context, sponsor.supporter_discord_user_id);
    return sponsor.supporter_discord_user_id;
}

/**
 * Returns who holds the friend's seat once a revoked holder is released: null, or `sponsorId` itself.
 * A different holder is revoked and released when ineligible; a still-eligible one is `409 already_sponsored`.
 */
async function releaseRevokedSeat(context: GatewayContext, friendId: string, sponsorId: string): Promise<string | null> {
    const holder = firstRow(await context.db.query<SupporterRow>(
        "SELECT supporter_discord_user_id FROM nightly_gateway.sponsorships WHERE sponsored_discord_user_id = $1",
        [friendId],
    ))?.supporter_discord_user_id ?? null;
    if (holder === null || holder === sponsorId) return holder;
    if (await revokeSponsorIfIneligible(context, holder)) throw new GatewayError(409, "already_sponsored");
    await context.db.transaction(async (tx) => {
        await tx.query("DELETE FROM nightly_gateway.sponsorships WHERE sponsored_discord_user_id = $1", [friendId]);
        await tx.query("DELETE FROM nightly_gateway.download_sessions WHERE discord_user_id = $1", [friendId]);
    });
    return null;
}

/** Gives the friend a seat under the sponsor unless they already hold one; a full sponsor is `409 seats_full`. */
async function takeSeat(context: GatewayContext, friendId: string, sponsorId: string, holder: string | null): Promise<void> {
    if (holder === sponsorId) return;
    // The enforce_sponsorship_limit trigger also skips the insert at the limit, serializing concurrent claims.
    const inserted = await context.db.query(
        `INSERT INTO nightly_gateway.sponsorships (supporter_discord_user_id, sponsored_discord_user_id, created_at)
         SELECT $1, $2, $3
         WHERE (SELECT COUNT(*) FROM nightly_gateway.sponsorships WHERE supporter_discord_user_id = $1) < $4
         ON CONFLICT DO NOTHING`,
        [sponsorId, friendId, context.now(), SPONSORED_ACCOUNT_LIMIT],
    );
    if (inserted.rowCount !== 1) throw new GatewayError(409, "seats_full");
}
