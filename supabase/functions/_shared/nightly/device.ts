import type { GatewayContext } from "./context.ts";
import { firstRow, isUniqueViolation } from "./database.ts";
import { assertSponsorEligible } from "./eligibility.ts";
import { GatewayError, json, readForm } from "./http.ts";
import {
    DEVICE_POLL_INTERVAL_SECONDS,
    DEVICE_SESSION_SECONDS,
    DOWNLOAD_SESSION_SECONDS,
    isDiscordSnowflake,
} from "./policy.ts";
import { randomToken, randomUserCode, randomUuid, SECRET_TOKEN_PATTERN, sha256 } from "./tokens.ts";

type DeviceSessionRow = {
    id: string;
    status: string;
    discord_user_id: string | null;
    sponsor_discord_user_id: string | null;
    expires_at: number;
};

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
    if (row.status === "pending" || row.status === "awaiting-sponsor") throw new GatewayError(428, "authorization_pending");
    if (row.status !== "approved" || !isDiscordSnowflake(row.discord_user_id)
        || !isDiscordSnowflake(row.sponsor_discord_user_id)) {
        throw new GatewayError(403, "access_denied");
    }
    await assertSponsorEligible(context, row.sponsor_discord_user_id);
    return issueDownloadToken(context, row.id, now);
}

/** Marks a device session approved for a user under the given sponsor (themselves for direct members). */
export async function approveDevice(
    context: GatewayContext,
    deviceId: string,
    userId: string,
    sponsorId: string,
): Promise<void> {
    await context.db.query(
        `UPDATE nightly_gateway.device_sessions
         SET status = 'approved', discord_user_id = $1, sponsor_discord_user_id = $2, authorized_at = $3
         WHERE id = $4`,
        [userId, sponsorId, context.now(), deviceId],
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
        await tx.query(
            `INSERT INTO nightly_gateway.download_sessions
                (token_hash, device_session_id, discord_user_id, supporter_discord_user_id, created_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [tokenHash, deviceId, device.discord_user_id, device.sponsor_discord_user_id, now, now + DOWNLOAD_SESSION_SECONDS],
        );
    }).catch(rethrowUniqueViolationAsAlreadyUsed);
    return json({ access_token: accessToken, token_type: "Bearer", expires_in: DOWNLOAD_SESSION_SECONDS });
}

/** A download session already issued for this device (unique device_session_id) is the same `409 already_used`. */
function rethrowUniqueViolationAsAlreadyUsed(error: unknown): never {
    if (isUniqueViolation(error)) throw new GatewayError(409, "already_used");
    throw error;
}
