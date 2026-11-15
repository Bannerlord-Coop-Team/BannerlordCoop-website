import type { GatewayContext } from "./context.ts";
import { approveDevice, isSponsorStillEligible } from "./eligibility.ts";
import { GatewayError, json } from "./http.ts";
import { isDiscordSnowflake, SPONSORED_ACCOUNT_LIMIT } from "./policy.ts";
import { normalizeSponsorCode, randomSponsorCode, SECRET_TOKEN_PATTERN, sha256, UUID_PATTERN } from "./tokens.ts";

type ClaimableDevice = { discord_user_id: string | null; status: string; expires_at: number };

/** `POST /sponsorship/claim`: spends a sponsor's seat on an awaiting device's Discord account and approves it. */
export async function claimSponsorship(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const { device_id: deviceId, sponsor_code: sponsorCode } = body;
    if (typeof deviceId !== "string" || !UUID_PATTERN.test(deviceId)
        || typeof sponsorCode !== "string" || sponsorCode.length > 128) {
        throw new GatewayError(400, "invalid_request");
    }
    const device = await context.db.prepare(
        "SELECT discord_user_id, status, expires_at FROM device_sessions WHERE id = ?",
    ).bind(deviceId).first<ClaimableDevice>();
    if (device === null || device.status !== "awaiting-sponsor" || device.expires_at < context.now()
        || !isDiscordSnowflake(device.discord_user_id)) {
        throw new GatewayError(400, "expired");
    }
    const sponsorId = await eligibleSponsorForCode(context, sponsorCode);
    await releaseRevokedSeat(context, device.discord_user_id, sponsorId);
    await takeSeat(context, device.discord_user_id, sponsorId);
    await approveDevice(context, deviceId, device.discord_user_id, sponsorId);
    return json({ outcome: "sponsored-approved" });
}

/** `POST /sponsor/portal`: lists an eligible sponsor's seats; an ineligible sponsor is `403`. */
export async function sponsorPortal(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const sponsorId = await requireSponsorSession(context, body.session);
    if (!await isSponsorStillEligible(context, sponsorId)) throw new GatewayError(403, "supporter_role_required");
    const rows = await context.db.prepare(
        "SELECT sponsored_discord_user_id, created_at FROM sponsorships WHERE supporter_discord_user_id = ? ORDER BY created_at",
    ).bind(sponsorId).all<{ sponsored_discord_user_id: string; created_at: number }>();
    return json({
        seats: rows.results.map((row) => ({ discord_user_id: row.sponsored_discord_user_id, created_at: row.created_at })),
        limit: SPONSORED_ACCOUNT_LIMIT,
    });
}

/** `POST /sponsor/code`: replaces the sponsor's code with a new one, returned once and stored as a hash. */
export async function rotateSponsorCode(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const sponsorId = await requireSponsorSession(context, body.session);
    const code = randomSponsorCode(context.random);
    await context.db.prepare("UPDATE supporter_grants SET sponsor_code_hash = ?, updated_at = ? WHERE supporter_discord_user_id = ?")
        .bind(await sha256(code), context.now(), sponsorId).run();
    return json({ code });
}

/** `POST /sponsor/remove`: frees one seat and ends that friend's download sessions under this sponsor. */
export async function removeSponsoredAccount(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const sponsorId = await requireSponsorSession(context, body.session);
    const friendId = body.discord_user_id;
    if (!isDiscordSnowflake(friendId)) throw new GatewayError(400, "invalid_request");
    await context.db.batch([
        context.db.prepare("DELETE FROM sponsorships WHERE supporter_discord_user_id = ? AND sponsored_discord_user_id = ?")
            .bind(sponsorId, friendId),
        context.db.prepare("DELETE FROM download_sessions WHERE discord_user_id = ? AND supporter_discord_user_id = ?")
            .bind(friendId, sponsorId),
    ]);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/** Resolves a sponsor session token to its supporter; malformed is `authorization_required`, stale `authorization_expired`. */
async function requireSponsorSession(context: GatewayContext, token: unknown): Promise<string> {
    if (typeof token !== "string" || !SECRET_TOKEN_PATTERN.test(token)) throw new GatewayError(401, "authorization_required");
    const row = await context.db.prepare(
        "SELECT supporter_discord_user_id, expires_at FROM sponsor_sessions WHERE token_hash = ?",
    ).bind(await sha256(token)).first<{ supporter_discord_user_id: string; expires_at: number }>();
    if (row === null || row.expires_at < context.now()) throw new GatewayError(401, "authorization_expired");
    return row.supporter_discord_user_id;
}

/** Finds the supporter behind a sponsor code and re-checks their live Discord eligibility. */
async function eligibleSponsorForCode(context: GatewayContext, sponsorCode: string): Promise<string> {
    const sponsor = await context.db.prepare(
        "SELECT supporter_discord_user_id FROM supporter_grants WHERE sponsor_code_hash = ?",
    ).bind(await sha256(normalizeSponsorCode(sponsorCode))).first<{ supporter_discord_user_id: string }>();
    if (sponsor === null) throw new GatewayError(403, "invalid_sponsor_code");
    if (!await isSponsorStillEligible(context, sponsor.supporter_discord_user_id)) {
        throw new GatewayError(403, "supporter_role_required");
    }
    return sponsor.supporter_discord_user_id;
}

/** Drops the friend's seat with a different sponsor when that sponsor lost eligibility; an eligible one is `409`. */
async function releaseRevokedSeat(context: GatewayContext, friendId: string, sponsorId: string): Promise<void> {
    const existingSeat = await currentSeat(context, friendId);
    if (existingSeat === null || existingSeat === sponsorId) return;
    if (await isSponsorStillEligible(context, existingSeat)) throw new GatewayError(409, "already_sponsored");
    await context.db.batch([
        context.db.prepare("DELETE FROM sponsorships WHERE sponsored_discord_user_id = ?").bind(friendId),
        context.db.prepare("DELETE FROM download_sessions WHERE discord_user_id = ?").bind(friendId),
    ]);
}

/** Inserts the seat while the sponsor is under the 10-seat limit; a full sponsor is `409 seats_full`. */
async function takeSeat(context: GatewayContext, friendId: string, sponsorId: string): Promise<void> {
    const inserted = await context.db.prepare(`
        INSERT OR IGNORE INTO sponsorships (supporter_discord_user_id, sponsored_discord_user_id, created_at)
        SELECT ?, ?, ?
        WHERE (SELECT COUNT(*) FROM sponsorships WHERE supporter_discord_user_id = ?) < ?
    `).bind(sponsorId, friendId, context.now(), sponsorId, SPONSORED_ACCOUNT_LIMIT).run();
    if (!inserted.success || await currentSeat(context, friendId) !== sponsorId) {
        throw new GatewayError(409, "seats_full");
    }
}

/** The sponsor currently holding the friend's seat, or null. */
async function currentSeat(context: GatewayContext, friendId: string): Promise<string | null> {
    const seat = await context.db.prepare(
        "SELECT supporter_discord_user_id FROM sponsorships WHERE sponsored_discord_user_id = ?",
    ).bind(friendId).first<{ supporter_discord_user_id: string }>();
    return seat?.supporter_discord_user_id ?? null;
}
