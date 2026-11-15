import type { GatewayContext } from "./context.ts";
import type { GatewayQueries } from "./database.ts";
import {
    approveDevice,
    bindDeviceOAuthState,
    consumeDeviceOAuthState,
    findLiveDeviceByUserCode,
    parkAwaitingSponsor,
} from "./device.ts";
import type { DiscordUser } from "./discord.ts";
import { revokeSponsorIfIneligible } from "./eligibility.ts";
import { isWellFormedOAuthCallback, normalizeUserCode, USER_CODE_PATTERN } from "./formats.ts";
import { storeSupporterGrant } from "./grants.ts";
import { GatewayError, json } from "./http.ts";
import { hasNightlyAccessRole, OAUTH_STATE_SECONDS, SPONSOR_SESSION_SECONDS } from "./policy.ts";
import { findSeatHolder, openSponsorSession } from "./sponsor.ts";
import { randomToken, sha256 } from "./tokens.ts";

/** What the sponsor-code form tells the friend: whether a previous sponsor's seat was just revoked. */
type SponsorCodeNotice = { previousSponsorRevoked: boolean };

/** `POST /oauth/start`: stores a state hash for the device or sponsor-portal flow and returns Discord's URL. */
export async function startOAuth(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    if (body.purpose === "device") return startDeviceOAuth(context, body.user_code);
    if (body.purpose === "sponsor-portal") return startPortalOAuth(context);
    throw new GatewayError(400, "invalid_request");
}

/** `POST /oauth/complete`: resolves the state to a portal login or a device session and finishes that flow. */
export async function completeOAuth(context: GatewayContext, body: Record<string, unknown>): Promise<Response> {
    if (!isWellFormedOAuthCallback(body)) throw new GatewayError(400, "invalid_request");
    const stateHash = await sha256(body.state);
    const portalLogin = await consumePortalState(context.db, stateHash, context.now());
    if (portalLogin) return completePortalLogin(context, body.code);
    const deviceId = await consumeDeviceOAuthState(context.db, stateHash, context.now());
    if (deviceId === null) throw new GatewayError(400, "expired");
    return completeDeviceLogin(context, deviceId, body.code);
}

/** Binds a fresh OAuth state to a live pending or awaiting-sponsor device session. */
async function startDeviceOAuth(context: GatewayContext, rawUserCode: unknown): Promise<Response> {
    const userCode = typeof rawUserCode === "string" ? normalizeUserCode(rawUserCode) : "";
    if (!USER_CODE_PATTERN.test(userCode)) throw new GatewayError(400, "invalid_code");
    const deviceId = await findLiveDeviceByUserCode(context.db, userCode, context.now());
    if (deviceId === null) throw new GatewayError(400, "expired");
    const state = randomToken(context.random);
    await bindDeviceOAuthState(context.db, deviceId, await sha256(state));
    return json({ authorize_url: context.discord.authorizeUrl(state) });
}

/** Stores a sponsor-portal OAuth state lasting `OAUTH_STATE_SECONDS`. */
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
async function consumePortalState(queries: GatewayQueries, stateHash: string, now: number): Promise<boolean> {
    const deleted = await queries.query(
        "DELETE FROM nightly_gateway.oauth_states WHERE state_hash = $1 AND expires_at >= $2",
        [stateHash, now],
    );
    return deleted.rowCount === 1;
}

/** Signs an eligible guild member into the sponsor portal: their grant and a session lasting `SPONSOR_SESSION_SECONDS`, stored together. */
async function completePortalLogin(context: GatewayContext, code: string): Promise<Response> {
    const accessToken = await context.discord.exchangeCode(code);
    const user = await context.discord.currentUser(accessToken);
    const member = await context.discord.currentMember(accessToken);
    if (!hasNightlyAccessRole(member.roles)) throw new GatewayError(403, "supporter_role_required");
    const now = context.now();
    const session = await context.db.transaction(async (tx) => {
        await storeSupporterGrant(tx, user.id, now);
        return openSponsorSession(tx, user.id, context.random, now);
    });
    return json({ outcome: "portal", session, expires_in: SPONSOR_SESSION_SECONDS });
}

/** Approves a direct member or a still-sponsored friend, otherwise parks the device awaiting a sponsor code. */
async function completeDeviceLogin(context: GatewayContext, deviceId: string, code: string): Promise<Response> {
    const accessToken = await context.discord.exchangeCode(code);
    const user = await context.discord.currentUser(accessToken);
    const member = await context.discord.currentMemberIfPresent(accessToken);
    if (member !== null && hasNightlyAccessRole(member.roles)) return approveDirectMember(context, deviceId, user.id);
    const previousSponsorId = await findSeatHolder(context.db, user.id);
    if (previousSponsorId === null) return awaitSponsorCode(context, deviceId, user, { previousSponsorRevoked: false });
    // A previous sponsor who lost access is revoked here, and the friend gets the code form instead.
    const sponsorStillEligible = await revokeSponsorIfIneligible(context, previousSponsorId);
    if (!sponsorStillEligible) return awaitSponsorCode(context, deviceId, user, { previousSponsorRevoked: true });
    await approveDevice(context.db, deviceId, user.id, previousSponsorId, context.now());
    return json({ outcome: "sponsored-approved" });
}

/** Records a qualifying member's grant and approves their device as their own sponsor, in one transaction. */
async function approveDirectMember(context: GatewayContext, deviceId: string, userId: string): Promise<Response> {
    const now = context.now();
    await context.db.transaction(async (tx) => {
        await storeSupporterGrant(tx, userId, now);
        await approveDevice(tx, deviceId, userId, userId, now);
    });
    return json({ outcome: "approved" });
}

/** Parks the device for the signed-in user and tells the website to show the sponsor-code form. */
async function awaitSponsorCode(
    context: GatewayContext,
    deviceId: string,
    user: DiscordUser,
    { previousSponsorRevoked }: SponsorCodeNotice,
): Promise<Response> {
    await parkAwaitingSponsor(context.db, deviceId, user.id);
    return json({
        outcome: "needs-sponsor",
        device_id: deviceId,
        username: user.username,
        previous_sponsor_revoked: previousSponsorRevoked,
    });
}
