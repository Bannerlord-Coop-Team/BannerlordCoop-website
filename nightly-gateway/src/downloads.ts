import { GatewayError } from "./http";
import { nowSeconds, sha256 } from "./primitives";

// Authorizes artifact and manifest downloads from a bearer download session, nightly or create-build pin.

const DEVICE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** What a download session grants: the latest nightly, or one pinned create-build. */
export type DownloadAuthorization = { kind: "nightly" } | PinAuthorization;
/** A download session bound to one create-build pin's build. */
export type PinAuthorization = { kind: "pin"; buildId: string };

// Requires a nightly download session, refusing pin sessions.
export async function requireNightlyDownloadSession(request: Request, env: Env): Promise<void> {
    const authorization = await authorizeDownload(request, env);
    if (authorization.kind !== "nightly") throw new GatewayError(403, "access_denied");
}

// Requires a create-build pin download session and returns the build it unlocks.
export async function requirePinDownloadSession(request: Request, env: Env): Promise<PinAuthorization> {
    const authorization = await authorizeDownload(request, env);
    if (authorization.kind !== "pin") throw new GatewayError(403, "access_denied");
    return authorization;
}

// Resolves a bearer token to a live pin or nightly download session, or throws 401.
export async function authorizeDownload(request: Request, env: Env): Promise<DownloadAuthorization> {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new GatewayError(401, "authorization_required");
    const token = authorization.slice(7);
    if (!DEVICE_SECRET_PATTERN.test(token)) throw new GatewayError(401, "authorization_invalid");
    const tokenHash = await sha256(token);
    const now = nowSeconds();
    const pinSession = await env.DB.prepare(`
        SELECT pin.build_id, session.expires_at AS session_expires_at, pin.expires_at AS pin_expires_at
        FROM pin_download_sessions AS session
        JOIN installer_pins AS pin ON pin.token_hash = session.pin_token_hash
        WHERE session.token_hash = ?
    `).bind(tokenHash).first<{ build_id: string; session_expires_at: number; pin_expires_at: number }>();
    if (pinSession !== null) {
        if (pinSession.session_expires_at < now || pinSession.pin_expires_at < now) {
            throw new GatewayError(401, "authorization_expired");
        }
        return { kind: "pin", buildId: pinSession.build_id };
    }
    const row = await env.DB.prepare(
        "SELECT supporter_discord_user_id, expires_at FROM download_sessions WHERE token_hash = ?",
    ).bind(tokenHash).first<{ supporter_discord_user_id: string; expires_at: number }>();
    if (row === null || row.expires_at < now) throw new GatewayError(401, "authorization_expired");
    return { kind: "nightly" };
}
