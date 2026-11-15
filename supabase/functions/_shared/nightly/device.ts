import type { GatewayContext } from "./context.ts";
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

/** `POST /v1/device/sessions`: starts a 10-minute pending device session verified on the forwarding host. */
export async function createDeviceSession(context: GatewayContext, origin: string): Promise<Response> {
    const id = randomUuid(context.random);
    const deviceSecret = randomToken(context.random);
    const userCode = randomUserCode(context.random);
    const now = context.now();
    await context.db.prepare(
        "INSERT INTO device_sessions (id, device_secret_hash, user_code, status, created_at, expires_at) VALUES (?, ?, ?, 'pending', ?, ?)",
    ).bind(id, await sha256(deviceSecret), userCode, now, now + DEVICE_SESSION_SECONDS).run();
    return json({
        device_code: deviceSecret,
        user_code: userCode,
        verification_uri: `${origin}/activate?code=${encodeURIComponent(userCode)}`,
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
    const row = await context.db.prepare(
        "SELECT id, status, discord_user_id, sponsor_discord_user_id, expires_at FROM device_sessions WHERE device_secret_hash = ?",
    ).bind(await sha256(deviceSecret)).first<DeviceSessionRow>();
    if (row === null || row.expires_at < now) throw new GatewayError(400, "expired_token");
    if (row.status === "pending" || row.status === "awaiting-sponsor") throw new GatewayError(428, "authorization_pending");
    if (row.status !== "approved" || !isDiscordSnowflake(row.discord_user_id)
        || !isDiscordSnowflake(row.sponsor_discord_user_id)) {
        throw new GatewayError(403, "access_denied");
    }
    await assertSponsorEligible(context, row.sponsor_discord_user_id);
    return issueDownloadToken(context, row.id, now);
}

/** Atomically inserts the download session and consumes the device session; a lost race is `409 already_used`. */
async function issueDownloadToken(context: GatewayContext, deviceId: string, now: number): Promise<Response> {
    const accessToken = randomToken(context.random);
    const result = await context.db.batch([
        context.db.prepare(`
            INSERT INTO download_sessions (token_hash, device_session_id, discord_user_id, supporter_discord_user_id, created_at, expires_at)
            SELECT ?, id, discord_user_id, sponsor_discord_user_id, ?, ?
            FROM device_sessions WHERE id = ? AND status = 'approved'
        `).bind(await sha256(accessToken), now, now + DOWNLOAD_SESSION_SECONDS, deviceId),
        context.db.prepare("UPDATE device_sessions SET status = 'consumed' WHERE id = ? AND status = 'approved'")
            .bind(deviceId),
    ]).catch(rethrowUniqueViolationAsAlreadyUsed);
    if (!result.every((entry) => entry.success && entry.meta.changes === 1)) {
        throw new GatewayError(409, "already_used");
    }
    return json({ access_token: accessToken, token_type: "Bearer", expires_in: DOWNLOAD_SESSION_SECONDS });
}

/** A concurrent poll that loses the unique device_session_id race in PostgreSQL is the same `409 already_used`. */
function rethrowUniqueViolationAsAlreadyUsed(error: unknown): never {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505") {
        throw new GatewayError(409, "already_used");
    }
    throw error;
}
