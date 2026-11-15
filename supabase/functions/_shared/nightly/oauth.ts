import type { GatewayContext } from "./context.ts";
import { approveDevice, isSponsorStillEligible, storeSupporterGrant } from "./eligibility.ts";
import { GatewayError, json } from "./http.ts";
import { hasNightlyAccessRole, OAUTH_STATE_SECONDS, SPONSOR_SESSION_SECONDS } from "./policy.ts";
import { randomToken, SECRET_TOKEN_PATTERN, sha256, USER_CODE_PATTERN } from "./tokens.ts";

type AuthorizableDevice = { id: string; status: string; expires_at: number };

/** `POST /oauth/start`: stores a state hash for the device or sponsor-portal flow and returns Discord's URL. */
export async function startOAuth(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    if (body.purpose === "device") return startDeviceOAuth(context, body.user_code);
    if (body.purpose === "sponsor-portal") return startPortalOAuth(context);
    throw new GatewayError(400, "invalid_request");
}

/** `POST /oauth/complete`: resolves the state to a portal login or a device session and finishes that flow. */
export async function completeOAuth(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    const { code, state } = body;
    if (typeof code !== "string" || code.length === 0 || code.length > 512
        || typeof state !== "string" || !SECRET_TOKEN_PATTERN.test(state)) {
        throw new GatewayError(400, "invalid_request");
    }
    const stateHash = await sha256(state);
    if (await consumePortalState(context, stateHash)) return completePortalLogin(context, code);
    const device = await context.db.prepare(
        "SELECT id, status, expires_at FROM device_sessions WHERE oauth_state_hash = ?",
    ).bind(stateHash).first<AuthorizableDevice>();
    if (device === null || device.expires_at < context.now() || !["pending", "awaiting-sponsor"].includes(device.status)) {
        throw new GatewayError(400, "expired");
    }
    return completeDeviceLogin(context, device.id, code);
}

/** Binds a fresh OAuth state to a live pending or awaiting-sponsor device session. */
async function startDeviceOAuth(context: GatewayContext, rawUserCode: unknown): Promise<Response> {
    const userCode = typeof rawUserCode === "string" ? rawUserCode.toUpperCase() : "";
    if (!USER_CODE_PATTERN.test(userCode)) throw new GatewayError(400, "invalid_code");
    const session = await context.db.prepare(
        "SELECT id, expires_at FROM device_sessions WHERE user_code = ? AND status IN ('pending', 'awaiting-sponsor')",
    ).bind(userCode).first<{ id: string; expires_at: number }>();
    if (session === null || session.expires_at < context.now()) throw new GatewayError(400, "expired");
    const state = randomToken(context.random);
    await context.db.prepare("UPDATE device_sessions SET oauth_state_hash = ? WHERE id = ?")
        .bind(await sha256(state), session.id).run();
    return json({ authorize_url: context.discord.authorizeUrl(state) });
}

/** Stores a 10-minute sponsor-portal OAuth state. */
async function startPortalOAuth(context: GatewayContext): Promise<Response> {
    const state = randomToken(context.random);
    const now = context.now();
    await context.db.prepare(
        "INSERT INTO oauth_states (state_hash, purpose, created_at, expires_at) VALUES (?, 'sponsor-portal', ?, ?)",
    ).bind(await sha256(state), now, now + OAUTH_STATE_SECONDS).run();
    return json({ authorize_url: context.discord.authorizeUrl(state) });
}

/** Deletes a live sponsor-portal state, reporting whether one existed; each state works once. */
async function consumePortalState(context: GatewayContext, stateHash: string): Promise<boolean> {
    const row = await context.db.prepare(
        "DELETE FROM oauth_states WHERE state_hash = ? AND expires_at >= ? RETURNING state_hash",
    ).bind(stateHash, context.now()).first();
    return row !== null;
}

/** Signs an eligible guild member into the sponsor portal with a 24-hour session. */
async function completePortalLogin(context: GatewayContext, code: string): Promise<Response> {
    const accessToken = await context.discord.exchangeCode(code);
    const user = await context.discord.currentUser(accessToken);
    const member = await context.discord.currentMember(accessToken);
    if (!hasNightlyAccessRole(member.roles)) throw new GatewayError(403, "supporter_role_required");
    await storeSupporterGrant(context, user.id);
    const session = randomToken(context.random);
    const now = context.now();
    await context.db.prepare(
        "INSERT INTO sponsor_sessions (token_hash, supporter_discord_user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).bind(await sha256(session), user.id, now, now + SPONSOR_SESSION_SECONDS).run();
    return json({ outcome: "portal", session, expires_in: SPONSOR_SESSION_SECONDS });
}

/** Approves a direct member or a still-sponsored friend, otherwise parks the device awaiting a sponsor code. */
async function completeDeviceLogin(context: GatewayContext, deviceId: string, code: string): Promise<Response> {
    const accessToken = await context.discord.exchangeCode(code);
    const user = await context.discord.currentUser(accessToken);
    const member = await context.discord.currentMemberIfPresent(accessToken);
    if (member !== null && hasNightlyAccessRole(member.roles)) {
        await storeSupporterGrant(context, user.id);
        await approveDevice(context, deviceId, user.id, user.id);
        return json({ outcome: "approved" });
    }
    const existing = await context.db.prepare(
        "SELECT supporter_discord_user_id FROM sponsorships WHERE sponsored_discord_user_id = ?",
    ).bind(user.id).first<{ supporter_discord_user_id: string }>();
    // Keep the code form available when the previous sponsor no longer has access.
    if (existing !== null && await isSponsorStillEligible(context, existing.supporter_discord_user_id)) {
        await approveDevice(context, deviceId, user.id, existing.supporter_discord_user_id);
        return json({ outcome: "sponsored-approved" });
    }
    await context.db.prepare("UPDATE device_sessions SET status = 'awaiting-sponsor', discord_user_id = ? WHERE id = ?")
        .bind(user.id, deviceId).run();
    return json({
        outcome: "needs-sponsor",
        device_id: deviceId,
        username: user.username,
        previous_sponsor_revoked: existing !== null,
    });
}
