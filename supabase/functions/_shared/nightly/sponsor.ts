import type { GatewayContext } from "./context.ts";
import { firstRow, type GatewayQueries } from "./database.ts";
import { approveDevice, findClaimableDevice } from "./device.ts";
import { revokeFriendDownloads, revokeFriendDownloadsUnder } from "./downloads.ts";
import { assertSponsorEligible, revokeSponsorIfIneligible } from "./eligibility.ts";
import {
    DEVICE_ID_PATTERN,
    isDiscordSnowflake,
    MAXIMUM_SPONSOR_CODE_LENGTH,
    normalizeSponsorCode,
    SECRET_TOKEN_PATTERN,
} from "./formats.ts";
import { findSupporterByCodeHash, replaceSponsorCodeHash } from "./grants.ts";
import { GatewayError, json } from "./http.ts";
import { SPONSOR_SESSION_SECONDS, SPONSORED_ACCOUNT_LIMIT } from "./policy.ts";
import { type RandomBytes, randomSponsorCode, randomToken, sha256 } from "./tokens.ts";

// The single owner of nightly_gateway.sponsorships and nightly_gateway.sponsor_sessions: the website's
// sponsor routes, the seat queries the OAuth flow needs, and opening and resolving sponsor-portal sessions.

type SupporterRow = { supporter_discord_user_id: string };

/** How a claim changes the friend's seat: keep the claiming sponsor's, take a free one, or replace a revoked holder's. */
type SeatPlan = { kind: "already-held" } | { kind: "free" } | { kind: "replace"; revokedHolderId: string };

/** A well-formed `/sponsorship/claim` body: a device session ID and a plausibly sized sponsor code. */
type ClaimRequest = { device_id: string; sponsor_code: string };

/** Whether a website body is a well-formed sponsorship claim. */
function isValidClaimRequest(body: Record<string, unknown>): body is Record<string, unknown> & ClaimRequest {
    const { device_id: deviceId, sponsor_code: sponsorCode } = body;
    return typeof deviceId === "string" && DEVICE_ID_PATTERN.test(deviceId)
        && typeof sponsorCode === "string" && sponsorCode.length <= MAXIMUM_SPONSOR_CODE_LENGTH;
}

/**
 * `POST /sponsorship/claim`: spends a sponsor's seat on an awaiting device's Discord account and approves it. The
 * Discord eligibility checks run first; the seat change and the approval then commit together or not at all.
 */
export async function claimSponsorship(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    if (!isValidClaimRequest(body)) throw new GatewayError(400, "invalid_request");
    const device = await findClaimableDevice(context.db, body.device_id, context.now());
    if (device === null) throw new GatewayError(400, "expired");
    const sponsorId = await eligibleSponsorForCode(context, body.sponsor_code);
    const seat = await planSeat(context, device.userId, sponsorId);
    const now = context.now();
    await context.db.transaction(async (tx) => {
        await applySeatPlan(tx, device.userId, sponsorId, seat, now);
        await approveDevice(tx, body.device_id, device.userId, sponsorId, now);
    });
    return json({ outcome: "sponsored-approved" });
}

/** `POST /sponsor/portal`: lists an eligible sponsor's seats as `{seats}`; an ineligible sponsor is `403`. */
export async function sponsorPortal(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const sponsorId = await requireSponsorSession(context.db, body.session, context.now());
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

/** `POST /sponsor/code`: creates a new sponsor code that replaces the previous one, returned once and stored as a hash. */
export async function createSponsorCode(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const sponsorId = await requireSponsorSession(context.db, body.session, context.now());
    const code = randomSponsorCode(context.random);
    await replaceSponsorCodeHash(context.db, sponsorId, await sha256(code), context.now());
    return json({ code });
}

/** `POST /sponsor/remove`: frees one seat and ends that friend's download sessions under this sponsor. */
export async function removeSponsoredAccount(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const sponsorId = await requireSponsorSession(context.db, body.session, context.now());
    const friendId = body.discord_user_id;
    if (!isDiscordSnowflake(friendId)) throw new GatewayError(400, "invalid_request");
    await context.db.transaction(async (tx) => {
        await deleteSeat(tx, sponsorId, friendId);
        await revokeFriendDownloadsUnder(tx, friendId, sponsorId);
    });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/** Returns the supporter whose seat a friend holds, or null when nobody sponsors them. */
export async function findSeatHolder(queries: GatewayQueries, friendId: string): Promise<string | null> {
    const seat = firstRow(await queries.query<SupporterRow>(
        "SELECT supporter_discord_user_id FROM nightly_gateway.sponsorships WHERE sponsored_discord_user_id = $1",
        [friendId],
    ));
    return seat?.supporter_discord_user_id ?? null;
}

/** Opens a sponsor-portal session lasting `SPONSOR_SESSION_SECONDS` for a supporter and returns its token, stored only as a hash. */
export async function openSponsorSession(
    queries: GatewayQueries,
    supporterId: string,
    random: RandomBytes,
    now: number,
): Promise<string> {
    const session = randomToken(random);
    await queries.query(
        "INSERT INTO nightly_gateway.sponsor_sessions (token_hash, supporter_discord_user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
        [await sha256(session), supporterId, now, now + SPONSOR_SESSION_SECONDS],
    );
    return session;
}

/** Resolves a sponsor session token to its supporter; malformed is `authorization_required`, stale `authorization_expired`. */
async function requireSponsorSession(queries: GatewayQueries, token: unknown, now: number): Promise<string> {
    if (typeof token !== "string" || !SECRET_TOKEN_PATTERN.test(token)) throw new GatewayError(401, "authorization_required");
    const row = firstRow(await queries.query<{ supporter_discord_user_id: string; expires_at: number }>(
        "SELECT supporter_discord_user_id, expires_at FROM nightly_gateway.sponsor_sessions WHERE token_hash = $1",
        [await sha256(token)],
    ));
    if (row === null || row.expires_at < now) throw new GatewayError(401, "authorization_expired");
    return row.supporter_discord_user_id;
}

/** Finds the supporter behind a sponsor code and re-checks their live Discord eligibility. */
async function eligibleSponsorForCode(context: GatewayContext, sponsorCode: string): Promise<string> {
    const sponsorId = await findSupporterByCodeHash(context.db, await sha256(normalizeSponsorCode(sponsorCode)));
    if (sponsorId === null) throw new GatewayError(403, "invalid_sponsor_code");
    await assertSponsorEligible(context, sponsorId);
    return sponsorId;
}

/**
 * Decides a claim's seat change before its transaction, re-checking another holder's live Discord roles (which
 * revokes a holder who lapsed). Another holder who is still eligible is `409 already_sponsored`.
 */
async function planSeat(context: GatewayContext, friendId: string, sponsorId: string): Promise<SeatPlan> {
    const holderId = await findSeatHolder(context.db, friendId);
    if (holderId === null) return { kind: "free" };
    if (holderId === sponsorId) return { kind: "already-held" };
    const holderStillEligible = await revokeSponsorIfIneligible(context, holderId);
    if (holderStillEligible) throw new GatewayError(409, "already_sponsored");
    return { kind: "replace", revokedHolderId: holderId };
}

/** Applies a seat plan inside the claim's transaction: frees a revoked holder's seat, then takes one if needed. */
async function applySeatPlan(tx: GatewayQueries, friendId: string, sponsorId: string, plan: SeatPlan, now: number): Promise<void> {
    if (plan.kind === "already-held") return;
    if (plan.kind === "replace") await releaseRevokedSeat(tx, friendId, plan.revokedHolderId);
    await takeSeat(tx, friendId, sponsorId, now);
}

/** Frees the friend's seat under a revoked holder and ends every download session the friend still holds. */
async function releaseRevokedSeat(tx: GatewayQueries, friendId: string, holderId: string): Promise<void> {
    await deleteSeat(tx, holderId, friendId);
    await revokeFriendDownloads(tx, friendId);
}

/** Deletes the seat a supporter gives a friend, if there is one. */
async function deleteSeat(tx: GatewayQueries, supporterId: string, friendId: string): Promise<void> {
    await tx.query(
        "DELETE FROM nightly_gateway.sponsorships WHERE supporter_discord_user_id = $1 AND sponsored_discord_user_id = $2",
        [supporterId, friendId],
    );
}

/** Gives the friend a seat under the sponsor; a full sponsor is `409 seats_full`. */
async function takeSeat(queries: GatewayQueries, friendId: string, sponsorId: string, now: number): Promise<void> {
    // The enforce_sponsorship_limit trigger also skips the insert at the limit, serializing concurrent claims.
    const inserted = await queries.query(
        `INSERT INTO nightly_gateway.sponsorships (supporter_discord_user_id, sponsored_discord_user_id, created_at)
         SELECT $1, $2, $3
         WHERE (SELECT COUNT(*) FROM nightly_gateway.sponsorships WHERE supporter_discord_user_id = $1) < $4
         ON CONFLICT DO NOTHING`,
        [sponsorId, friendId, now, SPONSORED_ACCOUNT_LIMIT],
    );
    if (inserted.rowCount !== 1) throw new GatewayError(409, "seats_full");
}
