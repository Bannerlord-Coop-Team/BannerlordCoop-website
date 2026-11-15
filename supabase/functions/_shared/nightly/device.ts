import type { GatewayContext } from "./context.ts";
import { firstRow, type GatewayQueries, isUniqueViolation } from "./database.ts";
import { insertDownloadSession } from "./downloads.ts";
import { assertSponsorEligible } from "./eligibility.ts";
import { isDiscordSnowflake, SECRET_TOKEN_PATTERN } from "./formats.ts";
import { GatewayError, json, readForm } from "./http.ts";
import {
    DEVICE_POLL_INTERVAL_SECONDS,
    DEVICE_SESSION_SECONDS,
    DOWNLOAD_SESSION_SECONDS,
} from "./policy.ts";
import { randomToken, randomUserCode, randomUuid, sha256 } from "./tokens.ts";

// The single owner of nightly_gateway.device_sessions: the installer's device routes plus the device-session
// queries the OAuth and sponsorship flows need, so no other module names the table or its statuses.

type DeviceSessionRow = {
    id: string;
    status: string;
    discord_user_id: string | null;
    sponsor_discord_user_id: string | null;
    expires_at: number;
};

/** A polled session that may trade for a download token: approved, with both Discord IDs set. */
type DownloadableDevice = DeviceSessionRow & { discord_user_id: string; sponsor_discord_user_id: string };

/** Whether a polled device session was approved for a member under a known sponsor. */
function isApprovedForDownload(row: DeviceSessionRow): row is DownloadableDevice {
    return row.status === "approved" && isDiscordSnowflake(row.discord_user_id) && isDiscordSnowflake(row.sponsor_discord_user_id);
}

/** Whether a device-session status still waits for a sign-in or a sponsor. */
function isAwaitingAuthorization(status: string): boolean {
    return status === "pending" || status === "awaiting-sponsor";
}

type AuthorizableDevice = { id: string; status: string; expires_at: number };

/** Whether an OAuth-bound device session exists, is unexpired, and still waits to be authorized. */
function isAuthorizableDevice(device: AuthorizableDevice | null, now: number): device is AuthorizableDevice {
    return device !== null && device.expires_at >= now && isAwaitingAuthorization(device.status);
}

type ClaimableDevice = { discord_user_id: string | null; status: string; expires_at: number };

/** Whether a device session exists, is unexpired, awaits a sponsor, and is bound to a signed-in Discord user. */
function isClaimableDevice(
    device: ClaimableDevice | null,
    now: number,
): device is ClaimableDevice & { discord_user_id: string } {
    return device !== null && device.status === "awaiting-sponsor" && device.expires_at >= now
        && isDiscordSnowflake(device.discord_user_id);
}

type ApprovedDevice = { discord_user_id: string; sponsor_discord_user_id: string };

/** `POST /v1/device/sessions`: starts a 10-minute pending device session; the Worker adds `verification_uri`. */
export async function createDeviceSession(context: GatewayContext): Promise<Response> {
    const id = randomUuid(context.random);
    const deviceSecret = randomToken(context.random);
    const userCode = randomUserCode(context.random);
    const now = context.now();
    await context.db.query(
        `INSERT INTO nightly_gateway.device_sessions (id, device_secret_hash, user_code, status, created_at, expires_at)
         VALUES ($1, $2, $3, 'pending', $4, $5)`,
        [id, await sha256(deviceSecret), userCode, now, now + DEVICE_SESSION_SECONDS],
    );
    return json({
        device_code: deviceSecret,
        user_code: userCode,
        expires_in: DEVICE_SESSION_SECONDS,
        interval: DEVICE_POLL_INTERVAL_SECONDS,
    }, 201);
}

/** `POST /v1/device/token`: trades an approved device session for a one-hour download token, exactly once. */
export async function pollDeviceSession(context: GatewayContext, request: Request): Promise<Response> {
    const deviceSecret = (await readForm(request)).get("device_code");
    if (typeof deviceSecret !== "string" || !SECRET_TOKEN_PATTERN.test(deviceSecret)) {
        throw new GatewayError(400, "invalid_request");
    }
    const now = context.now();
    const row = firstRow(await context.db.query<DeviceSessionRow>(
        `SELECT id, status, discord_user_id, sponsor_discord_user_id, expires_at
         FROM nightly_gateway.device_sessions WHERE device_secret_hash = $1`,
        [await sha256(deviceSecret)],
    ));
    if (row === null || row.expires_at < now) throw new GatewayError(400, "expired_token");
    if (isAwaitingAuthorization(row.status)) throw new GatewayError(428, "authorization_pending");
    if (!isApprovedForDownload(row)) throw new GatewayError(403, "access_denied");
    await assertSponsorEligible(context, row.sponsor_discord_user_id);
    return issueDownloadToken(context, row.id, now);
}

/** Returns the ID of the live, not yet authorized device session a typed user code names, or null. */
export async function findLiveDeviceByUserCode(
    queries: GatewayQueries,
    userCode: string,
    now: number,
): Promise<string | null> {
    const device = firstRow(await queries.query<AuthorizableDevice>(
        "SELECT id, status, expires_at FROM nightly_gateway.device_sessions WHERE user_code = $1",
        [userCode],
    ));
    if (!isAuthorizableDevice(device, now)) return null;
    return device.id;
}

/** Binds an OAuth state hash to a device session, replacing any earlier one. */
export async function bindDeviceOAuthState(queries: GatewayQueries, deviceId: string, stateHash: string): Promise<void> {
    await queries.query("UPDATE nightly_gateway.device_sessions SET oauth_state_hash = $1 WHERE id = $2", [
        stateHash,
        deviceId,
    ]);
}

/** Returns the ID of the device session an OAuth state was bound to while it can still be authorized, or null. */
export async function findAuthorizableDeviceByState(
    queries: GatewayQueries,
    stateHash: string,
    now: number,
): Promise<string | null> {
    const device = firstRow(await queries.query<AuthorizableDevice>(
        "SELECT id, status, expires_at FROM nightly_gateway.device_sessions WHERE oauth_state_hash = $1",
        [stateHash],
    ));
    if (!isAuthorizableDevice(device, now)) return null;
    return device.id;
}

/** Records the signed-in Discord user on a device session and parks it until a sponsor code is redeemed. */
export async function parkAwaitingSponsor(queries: GatewayQueries, deviceId: string, userId: string): Promise<void> {
    await queries.query(
        "UPDATE nightly_gateway.device_sessions SET status = 'awaiting-sponsor', discord_user_id = $1 WHERE id = $2",
        [userId, deviceId],
    );
}

/** Returns the Discord user a device session waits to have sponsored, or null when it cannot be claimed. */
export async function findClaimableDevice(
    queries: GatewayQueries,
    deviceId: string,
    now: number,
): Promise<{ userId: string } | null> {
    const device = firstRow(await queries.query<ClaimableDevice>(
        "SELECT discord_user_id, status, expires_at FROM nightly_gateway.device_sessions WHERE id = $1",
        [deviceId],
    ));
    if (!isClaimableDevice(device, now)) return null;
    return { userId: device.discord_user_id };
}

/** Marks a device session approved for a user under the given sponsor (themselves for direct members). */
export async function approveDevice(
    queries: GatewayQueries,
    deviceId: string,
    userId: string,
    sponsorId: string,
    now: number,
): Promise<void> {
    await queries.query(
        `UPDATE nightly_gateway.device_sessions
         SET status = 'approved', discord_user_id = $1, sponsor_discord_user_id = $2, authorized_at = $3
         WHERE id = $4`,
        [userId, sponsorId, now, deviceId],
    );
}

/**
 * Consumes the approved device session and inserts its download session in one transaction. The consuming
 * UPDATE row-locks the session, so a concurrent poll finds it consumed; either loss is `409 already_used`.
 */
async function issueDownloadToken(context: GatewayContext, deviceId: string, now: number): Promise<Response> {
    const accessToken = randomToken(context.random);
    const tokenHash = await sha256(accessToken);
    await context.db.transaction(async (tx) => {
        const device = firstRow(await tx.query<ApprovedDevice>(
            `UPDATE nightly_gateway.device_sessions SET status = 'consumed'
             WHERE id = $1 AND status = 'approved'
             RETURNING discord_user_id, sponsor_discord_user_id`,
            [deviceId],
        ));
        if (device === null) throw new GatewayError(409, "already_used");
        await insertDownloadSession(tx, {
            tokenHash,
            deviceId,
            userId: device.discord_user_id,
            sponsorId: device.sponsor_discord_user_id,
            createdAt: now,
            expiresAt: now + DOWNLOAD_SESSION_SECONDS,
        });
    }).catch(rethrowUniqueViolationAsAlreadyUsed);
    return json({ access_token: accessToken, token_type: "Bearer", expires_in: DOWNLOAD_SESSION_SECONDS });
}

/** A download session already issued for this device (unique device_session_id) is the same `409 already_used`. */
function rethrowUniqueViolationAsAlreadyUsed(error: unknown): never {
    if (isUniqueViolation(error)) throw new GatewayError(409, "already_used");
    throw error;
}
