import type { GatewayContext } from "./context.ts";
import { firstRow } from "./database.ts";
import { approveDevice, findClaimableDevice } from "./device.ts";
import { revokeDownloadsForFriend } from "./downloads.ts";
import { assertSponsorEligible, revokeSponsorIfIneligible } from "./eligibility.ts";
import {
    DEVICE_ID_PATTERN,
    MAXIMUM_SPONSOR_CODE_LENGTH,
    normalizeSponsorCode,
    SECRET_TOKEN_PATTERN,
} from "./formats.ts";
import { findSupporterByCodeHash, replaceSponsorCodeHash } from "./grants.ts";
import { GatewayError, json } from "./http.ts";
import { isDiscordSnowflake, SPONSOR_SESSION_SECONDS, SPONSORED_ACCOUNT_LIMIT } from "./policy.ts";
import { randomSponsorCode, randomToken, sha256 } from "./tokens.ts";

// The single owner of nightly_gateway.sponsorships and nightly_gateway.sponsor_sessions: the website's
// sponsor routes, the seat queries the OAuth flow needs, and opening and resolving sponsor-portal sessions.

type SupporterRow = { supporter_discord_user_id: string };

/** Whether a friend's seat is already held by the claiming sponsor, or free for them to take. */
type SeatAvailability = "already-held" | "free";

/** A well-formed `/sponsorship/claim` body: a device session ID and a plausibly sized sponsor code. */
type ClaimRequest = { device_id: string; sponsor_code: string };

/** Whether a website body is a well-formed sponsorship claim. */
function isValidClaimRequest(body: Record<string, unknown>): body is Record<string, unknown> & ClaimRequest {
    const { device_id: deviceId, sponsor_code: sponsorCode } = body;
    return typeof deviceId === "string" && DEVICE_ID_PATTERN.test(deviceId)
        && typeof sponsorCode === "string" && sponsorCode.length <= MAXIMUM_SPONSOR_CODE_LENGTH;
}

/** `POST /sponsorship/claim`: spends a sponsor's seat on an awaiting device's Discord account and approves it. */
export async function claimSponsorship(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    if (!isValidClaimRequest(body)) throw new GatewayError(400, "invalid_request");
    const device = await findClaimableDevice(context, body.device_id);
    if (device === null) throw new GatewayError(400, "expired");
    const sponsorId = await eligibleSponsorForCode(context, body.sponsor_code);
    const seat = await releaseRevokedSeat(context, device.userId, sponsorId);
    if (seat === "free") await takeSeat(context, device.userId, sponsorId);
    await approveDevice(context, body.device_id, device.userId, sponsorId);
    return json({ outcome: "sponsored-approved" });
}

/** `POST /sponsor/portal`: lists an eligible sponsor's seats as `{seats}`; an ineligible sponsor is `403`. */
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
    });
}

/** `POST /sponsor/code`: replaces the sponsor's code with a new one, returned once and stored as a hash. */
export async function rotateSponsorCode(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const sponsorId = await requireSponsorSession(context, body.session);
    const code = randomSponsorCode(context.random);
    await replaceSponsorCodeHash(context, sponsorId, await sha256(code));
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
        await revokeDownloadsForFriend(tx, friendId, sponsorId);
    });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/** Returns the supporter whose seat a friend holds, or null when nobody sponsors them. */
export async function findSeatHolder(context: GatewayContext, friendId: string): Promise<string | null> {
    const seat = firstRow(await context.db.query<SupporterRow>(
        "SELECT supporter_discord_user_id FROM nightly_gateway.sponsorships WHERE sponsored_discord_user_id = $1",
        [friendId],
    ));
    return seat?.supporter_discord_user_id ?? null;
}

/** Opens a 24-hour sponsor-portal session for a supporter and returns its token, stored only as a hash. */
export async function openSponsorSession(context: GatewayContext, supporterId: string): Promise<string> {
    const session = randomToken(context.random);
    const now = context.now();
    await context.db.query(
        "INSERT INTO nightly_gateway.sponsor_sessions (token_hash, supporter_discord_user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
        [await sha256(session), supporterId, now, now + SPONSOR_SESSION_SECONDS],
    );
    return session;
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
    const sponsorId = await findSupporterByCodeHash(context, await sha256(normalizeSponsorCode(sponsorCode)));
    if (sponsorId === null) throw new GatewayError(403, "invalid_sponsor_code");
    await assertSponsorEligible(context, sponsorId);
    return sponsorId;
}

/**
 * Reports whether `sponsorId` already holds the friend's seat or it is free, first freeing a seat whose other
 * holder lost eligibility. Another holder who is still eligible is `409 already_sponsored`.
 */
async function releaseRevokedSeat(context: GatewayContext, friendId: string, sponsorId: string): Promise<SeatAvailability> {
    const holder = await findSeatHolder(context, friendId);
    if (holder === null) return "free";
    if (holder === sponsorId) return "already-held";
    const holderStillEligible = await revokeSponsorIfIneligible(context, holder);
    if (holderStillEligible) throw new GatewayError(409, "already_sponsored");
    await context.db.transaction(async (tx) => {
        await tx.query("DELETE FROM nightly_gateway.sponsorships WHERE sponsored_discord_user_id = $1", [friendId]);
        await revokeDownloadsForFriend(tx, friendId);
    });
    return "free";
}

/** Gives the friend a seat under the sponsor; a full sponsor is `409 seats_full`. */
async function takeSeat(context: GatewayContext, friendId: string, sponsorId: string): Promise<void> {
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
