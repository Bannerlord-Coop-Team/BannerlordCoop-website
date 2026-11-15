import type { GatewayContext } from "./context.ts";
import { firstRow } from "./database.ts";
import { approveDevice } from "./device.ts";
import { revokeSponsorIfIneligible, storeSupporterGrant } from "./eligibility.ts";
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
    const device = firstRow(await context.db.query<AuthorizableDevice>(
        "SELECT id, status, expires_at FROM nightly_gateway.device_sessions WHERE oauth_state_hash = $1",
        [stateHash],
    ));
    if (device === null || device.expires_at < context.now() || !["pending", "awaiting-sponsor"].includes(device.status)) {
        throw new GatewayError(400, "expired");
    }
    return completeDeviceLogin(context, device.id, code);
}

/** Binds a fresh OAuth state to a live pending or awaiting-sponsor device session. */
async function startDeviceOAuth(context: GatewayContext, rawUserCode: unknown): Promise<Response> {
    const userCode = typeof rawUserCode === "string" ? rawUserCode.toUpperCase() : "";
    if (!USER_CODE_PATTERN.test(userCode)) throw new GatewayError(400, "invalid_code");
    const session = firstRow(await context.db.query<{ id: string; expires_at: number }>(
        `SELECT id, expires_at FROM nightly_gateway.device_sessions
         WHERE user_code = $1 AND status IN ('pending', 'awaiting-sponsor')`,
        [userCode],
    ));
    if (session === null || session.expires_at < context.now()) throw new GatewayError(400, "expired");
    const state = randomToken(context.random);
    await context.db.query("UPDATE nightly_gateway.device_sessions SET oauth_state_hash = $1 WHERE id = $2", [
        await sha256(state),
        session.id,
    ]);
    return json({ authorize_url: context.discord.authorizeUrl(state) });
}

/** Stores a 10-minute sponsor-portal OAuth state. */
async function startPortalOAuth(context: GatewayContext): Promise<Response> {
    const state = randomToken(context.random);
    const now = context.now();
    await context.db.query(
        "INSERT INTO nightly_gateway.oauth_states (state_hash, purpose, created_at, expires_at) VALUES ($1, 'sponsor-portal', $2, $3)",
        [await sha256(state), now, now + OAUTH_STATE_SECONDS],
    );
    return json({ authorize_url: context.discord.authorizeUrl(state) });
}

/** Deletes a live sponsor-portal state, reporting whether one existed; each state works once. */
async function consumePortalState(context: GatewayContext, stateHash: string): Promise<boolean> {
    const deleted = await context.db.query(
        "DELETE FROM nightly_gateway.oauth_states WHERE state_hash = $1 AND expires_at >= $2",
        [stateHash, context.now()],
    );
    return deleted.rowCount === 1;
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
    await context.db.query(
        "INSERT INTO nightly_gateway.sponsor_sessions (token_hash, supporter_discord_user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
        [await sha256(session), user.id, now, now + SPONSOR_SESSION_SECONDS],
    );
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
    const existing = firstRow(await context.db.query<{ supporter_discord_user_id: string }>(
        "SELECT supporter_discord_user_id FROM nightly_gateway.sponsorships WHERE sponsored_discord_user_id = $1",
        [user.id],
    ));
    // A previous sponsor who lost access is revoked here, and the friend gets the code form instead.
    if (existing !== null && await revokeSponsorIfIneligible(context, existing.supporter_discord_user_id)) {
        await approveDevice(context, deviceId, user.id, existing.supporter_discord_user_id);
        return json({ outcome: "sponsored-approved" });
    }
    await context.db.query(
        "UPDATE nightly_gateway.device_sessions SET status = 'awaiting-sponsor', discord_user_id = $1 WHERE id = $2",
        [user.id, deviceId],
    );
    return json({
        outcome: "needs-sponsor",
        device_id: deviceId,
        username: user.username,
        previous_sponsor_revoked: existing !== null,
    });
}
