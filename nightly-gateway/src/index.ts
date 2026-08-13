import {
    DEVICE_SESSION_SECONDS,
    DISCORD_GUILD_ID,
    DISCORD_OAUTH_SCOPES,
    DOWNLOAD_SESSION_SECONDS,
    SPONSORED_ACCOUNT_LIMIT,
    hasSupporterRole,
    isAllowedArtifactKey,
    isDiscordSnowflake,
    rewriteManifestArtifactUrls,
} from "./core";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN = `${DISCORD_API}/oauth2/token`;
const JSON_HEADERS = Object.freeze({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
});
const DEVICE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const USER_CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const MAXIMUM_MANIFEST_BYTES = 128 * 1024;
const SPONSOR_SESSION_SECONDS = 24 * 60 * 60;
const OAUTH_STATE_SECONDS = 10 * 60;

type DiscordToken = {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: "Bearer";
};

type DiscordUser = { id: string; username: string };
type DiscordMember = { roles: string[]; user?: DiscordUser };

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        try {
            return await route(request, env);
        } catch (error) {
            console.error(JSON.stringify({
                event: "nightly_gateway_request_failed",
                path: new URL(request.url).pathname,
                error: error instanceof GatewayError ? error.code : "internal_error",
            }));
            if (error instanceof GatewayError) {
                return json({ error: error.code }, error.status);
            }
            return json({ error: "internal_error" }, 500);
        }
    },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
    assertConfiguration(env);
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/device/sessions") {
        return createDeviceSession(env);
    }
    if (request.method === "POST" && url.pathname === "/v1/device/token") {
        return pollDeviceSession(request, env);
    }
    if (request.method === "GET" && url.pathname === "/activate") {
        return beginDeviceAuthorization(url, env);
    }
    if (request.method === "GET" && url.pathname === "/oauth/callback") {
        return completeOAuth(url, env);
    }
    if (request.method === "POST" && url.pathname === "/v1/sponsorship/claim") {
        return claimSponsorship(request, env);
    }
    if (request.method === "GET" && url.pathname === "/sponsor") {
        return sponsorPortal(request, env);
    }
    if (request.method === "GET" && url.pathname === "/sponsor/login") {
        return beginSponsorAuthorization(env);
    }
    if (request.method === "POST" && url.pathname === "/v1/sponsor/code") {
        return rotateSponsorCode(request, env);
    }
    if (request.method === "POST" && url.pathname === "/v1/sponsor/remove") {
        return removeSponsoredAccount(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/manifests/client") {
        return serveManifest(request, env, "nightly/client.json");
    }
    if (request.method === "GET" && url.pathname === "/v1/manifests/release") {
        return serveManifest(request, env, "nightly/release.json");
    }
    if (request.method === "GET" && url.pathname.startsWith("/v1/artifacts/")) {
        return serveArtifact(request, env, url.pathname.slice("/v1/artifacts/".length));
    }
    if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true });
    }
    throw new GatewayError(404, "not_found");
}

async function createDeviceSession(env: Env): Promise<Response> {
    const id = crypto.randomUUID();
    const deviceSecret = randomToken(32);
    const userCode = `${randomCode(4)}-${randomCode(4)}`;
    const now = nowSeconds();
    await env.DB.prepare(
        "INSERT INTO device_sessions (id, device_secret_hash, user_code, status, created_at, expires_at) VALUES (?, ?, ?, 'pending', ?, ?)",
    ).bind(id, await sha256(deviceSecret), userCode, now, now + DEVICE_SESSION_SECONDS).run();
    return json({
        device_code: deviceSecret,
        user_code: userCode,
        verification_uri: `${env.PUBLIC_ORIGIN}/activate?code=${encodeURIComponent(userCode)}`,
        expires_in: DEVICE_SESSION_SECONDS,
        interval: 3,
    }, 201);
}

async function pollDeviceSession(request: Request, env: Env): Promise<Response> {
    const body = await readForm(request);
    const deviceSecret = body.get("device_code");
    if (typeof deviceSecret !== "string" || !DEVICE_SECRET_PATTERN.test(deviceSecret)) {
        throw new GatewayError(400, "invalid_request");
    }
    const now = nowSeconds();
    const row = await env.DB.prepare(
        "SELECT id, status, discord_user_id, sponsor_discord_user_id, expires_at FROM device_sessions WHERE device_secret_hash = ?",
    ).bind(await sha256(deviceSecret)).first<{
        id: string;
        status: string;
        discord_user_id: string | null;
        sponsor_discord_user_id: string | null;
        expires_at: number;
    }>();
    if (row === null || row.expires_at < now) throw new GatewayError(400, "expired_token");
    if (row.status === "pending" || row.status === "awaiting-sponsor") {
        throw new GatewayError(428, "authorization_pending");
    }
    if (row.status !== "approved" || !isDiscordSnowflake(row.discord_user_id)
        || !isDiscordSnowflake(row.sponsor_discord_user_id)) {
        throw new GatewayError(403, "access_denied");
    }
    await assertSponsorEligible(env, row.sponsor_discord_user_id);
    const accessToken = randomToken(32);
    const tokenHash = await sha256(accessToken);
    const result = await env.DB.batch([
        env.DB.prepare(`
            INSERT INTO download_sessions (token_hash, device_session_id, discord_user_id, supporter_discord_user_id, created_at, expires_at)
            SELECT ?, id, discord_user_id, sponsor_discord_user_id, ?, ?
            FROM device_sessions WHERE id = ? AND status = 'approved'
        `).bind(tokenHash, now, now + DOWNLOAD_SESSION_SECONDS, row.id),
        env.DB.prepare("UPDATE device_sessions SET status = 'consumed' WHERE id = ? AND status = 'approved'")
            .bind(row.id),
    ]);
    if (!result.every((entry) => entry.success && entry.meta.changes === 1)) {
        throw new GatewayError(409, "already_used");
    }
    return json({ access_token: accessToken, token_type: "Bearer", expires_in: DOWNLOAD_SESSION_SECONDS });
}

async function beginDeviceAuthorization(url: URL, env: Env): Promise<Response> {
    const userCode = url.searchParams.get("code")?.toUpperCase();
    if (!userCode || !USER_CODE_PATTERN.test(userCode)) return html(errorPage("That installer code is invalid."), 400);
    const session = await env.DB.prepare(
        "SELECT id, expires_at FROM device_sessions WHERE user_code = ? AND status IN ('pending', 'awaiting-sponsor')",
    ).bind(userCode).first<{ id: string; expires_at: number }>();
    if (session === null || session.expires_at < nowSeconds()) return html(errorPage("That installer code has expired."), 400);
    const state = randomToken(32);
    await env.DB.prepare("UPDATE device_sessions SET oauth_state_hash = ? WHERE id = ?")
        .bind(await sha256(state), session.id).run();
    return Response.redirect(discordAuthorizationUrl(env, state), 302);
}

async function beginSponsorAuthorization(env: Env): Promise<Response> {
    const state = randomToken(32);
    const now = nowSeconds();
    await env.DB.prepare(
        "INSERT INTO oauth_states (state_hash, purpose, created_at, expires_at) VALUES (?, 'sponsor-portal', ?, ?)",
    ).bind(await sha256(state), now, now + OAUTH_STATE_SECONDS).run();
    return Response.redirect(discordAuthorizationUrl(env, state), 302);
}

async function completeOAuth(url: URL, env: Env): Promise<Response> {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || code.length > 512 || !state || !DEVICE_SECRET_PATTERN.test(state)) {
        return html(errorPage("Discord sign-in could not be verified."), 400);
    }
    const stateHash = await sha256(state);
    const token = await exchangeDiscordCode(env, code);
    const [user, member] = await Promise.all([
        discordGet<DiscordUser>("/users/@me", token.access_token),
        discordGet<DiscordMember>(`/users/@me/guilds/${DISCORD_GUILD_ID}/member`, token.access_token),
    ]);
    if (!isDiscordSnowflake(user.id) || !Array.isArray(member.roles)) {
        throw new GatewayError(502, "discord_response_invalid");
    }
    const portalState = await env.DB.prepare(
        "SELECT state_hash FROM oauth_states WHERE state_hash = ? AND expires_at >= ?",
    ).bind(stateHash, nowSeconds()).first();
    if (portalState !== null) {
        await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?").bind(stateHash).run();
        if (!hasSupporterRole(member.roles)) return html(errorPage("A Patreon, Afdian, or Boosty supporter role is required."), 403);
        await storeSupporterGrant(env, user.id, token.refresh_token);
        const sponsorSession = randomToken(32);
        const now = nowSeconds();
        await env.DB.prepare(
            "INSERT INTO sponsor_sessions (token_hash, supporter_discord_user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        ).bind(await sha256(sponsorSession), user.id, now, now + SPONSOR_SESSION_SECONDS).run();
        return new Response(null, {
            status: 302,
            headers: {
                location: `${env.PUBLIC_ORIGIN}/sponsor`,
                "set-cookie": sponsorCookie(sponsorSession, SPONSOR_SESSION_SECONDS),
                "cache-control": "no-store",
            },
        });
    }
    const device = await env.DB.prepare(
        "SELECT id, status, expires_at FROM device_sessions WHERE oauth_state_hash = ?",
    ).bind(stateHash).first<{ id: string; status: string; expires_at: number }>();
    if (device === null || device.expires_at < nowSeconds() || !["pending", "awaiting-sponsor"].includes(device.status)) {
        return html(errorPage("That installer authorization has expired."), 400);
    }
    if (hasSupporterRole(member.roles)) {
        await storeSupporterGrant(env, user.id, token.refresh_token);
        await env.DB.prepare(
            "UPDATE device_sessions SET status = 'approved', discord_user_id = ?, sponsor_discord_user_id = ?, authorized_at = ? WHERE id = ?",
        ).bind(user.id, user.id, nowSeconds(), device.id).run();
        return html(successPage("Access approved", "Return to PowerShell. The installer will continue automatically."));
    }
    const existing = await env.DB.prepare(
        "SELECT supporter_discord_user_id FROM sponsorships WHERE sponsored_discord_user_id = ?",
    ).bind(user.id).first<{ supporter_discord_user_id: string }>();
    if (existing !== null) {
        await assertSponsorEligible(env, existing.supporter_discord_user_id);
        await env.DB.prepare(
            "UPDATE device_sessions SET status = 'approved', discord_user_id = ?, sponsor_discord_user_id = ?, authorized_at = ? WHERE id = ?",
        ).bind(user.id, existing.supporter_discord_user_id, nowSeconds(), device.id).run();
        return html(successPage("Sponsored access approved", "Return to PowerShell. The installer will continue automatically."));
    }
    await env.DB.prepare("UPDATE device_sessions SET status = 'awaiting-sponsor', discord_user_id = ? WHERE id = ?")
        .bind(user.id, device.id).run();
    return html(sponsorClaimPage(device.id, user.username));
}

async function claimSponsorship(request: Request, env: Env): Promise<Response> {
    assertSameOrigin(request, env);
    const form = await request.formData();
    const deviceId = form.get("device_id");
    const sponsorCode = form.get("sponsor_code");
    if (typeof deviceId !== "string" || deviceId.length > 64
        || typeof sponsorCode !== "string" || sponsorCode.length > 128) {
        throw new GatewayError(400, "invalid_request");
    }
    const device = await env.DB.prepare(
        "SELECT discord_user_id, status, expires_at FROM device_sessions WHERE id = ?",
    ).bind(deviceId).first<{ discord_user_id: string | null; status: string; expires_at: number }>();
    if (device === null || device.status !== "awaiting-sponsor" || device.expires_at < nowSeconds()
        || !isDiscordSnowflake(device.discord_user_id)) {
        return html(errorPage("That installer authorization has expired."), 400);
    }
    const sponsor = await env.DB.prepare(
        "SELECT supporter_discord_user_id FROM supporter_grants WHERE sponsor_code_hash = ?",
    ).bind(await sha256(normalizeSponsorCode(sponsorCode))).first<{ supporter_discord_user_id: string }>();
    if (sponsor === null) return html(errorPage("That sponsor code is not valid."), 403);
    await assertSponsorEligible(env, sponsor.supporter_discord_user_id);
    const inserted = await env.DB.prepare(`
        INSERT OR IGNORE INTO sponsorships (supporter_discord_user_id, sponsored_discord_user_id, created_at)
        SELECT ?, ?, ?
        WHERE (SELECT COUNT(*) FROM sponsorships WHERE supporter_discord_user_id = ?) < ?
    `).bind(
        sponsor.supporter_discord_user_id,
        device.discord_user_id,
        nowSeconds(),
        sponsor.supporter_discord_user_id,
        SPONSORED_ACCOUNT_LIMIT,
    ).run();
    const seat = await env.DB.prepare(
        "SELECT supporter_discord_user_id FROM sponsorships WHERE sponsored_discord_user_id = ?",
    ).bind(device.discord_user_id).first<{ supporter_discord_user_id: string }>();
    if (!inserted.success || seat?.supporter_discord_user_id !== sponsor.supporter_discord_user_id) {
        return html(errorPage("That supporter has already used all 10 sponsored-account seats."), 409);
    }
    await env.DB.prepare(
        "UPDATE device_sessions SET status = 'approved', sponsor_discord_user_id = ?, authorized_at = ? WHERE id = ?",
    ).bind(sponsor.supporter_discord_user_id, nowSeconds(), deviceId).run();
    return html(successPage("Sponsored access approved", "Return to PowerShell. The installer will continue automatically."));
}

async function sponsorPortal(request: Request, env: Env): Promise<Response> {
    const sponsorId = await requireSponsorSession(request, env, false);
    if (sponsorId === null) {
        return html(successPage(
            "Share nightlies with friends",
            "Supporters can sponsor up to 10 Discord accounts. Sign in with Discord to manage your seats.",
            `<a class="button" href="/sponsor/login">Sign in with Discord</a>`,
        ));
    }
    await assertSponsorEligible(env, sponsorId);
    const rows = await env.DB.prepare(
        "SELECT sponsored_discord_user_id, created_at FROM sponsorships WHERE supporter_discord_user_id = ? ORDER BY created_at",
    ).bind(sponsorId).all<{ sponsored_discord_user_id: string; created_at: number }>();
    const seats = rows.results.map((row) => `<li><code>${escapeHtml(row.sponsored_discord_user_id)}</code><form method="post" action="/v1/sponsor/remove"><input type="hidden" name="discord_user_id" value="${escapeHtml(row.sponsored_discord_user_id)}"><button>Remove</button></form></li>`).join("");
    return html(successPage(
        `Sponsored accounts (${rows.results.length}/${SPONSORED_ACCOUNT_LIMIT})`,
        "Friends use your sponsor code once. Every later install still checks that your supporter role is current.",
        `<form method="post" action="/v1/sponsor/code"><button class="button">Create or rotate sponsor code</button></form><ul>${seats || "<li>No sponsored accounts yet.</li>"}</ul>`,
    ));
}

async function rotateSponsorCode(request: Request, env: Env): Promise<Response> {
    assertSameOrigin(request, env);
    const sponsorId = await requireSponsorSession(request, env, true);
    const code = `${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
    await env.DB.prepare("UPDATE supporter_grants SET sponsor_code_hash = ?, updated_at = ? WHERE supporter_discord_user_id = ?")
        .bind(await sha256(code), nowSeconds(), sponsorId).run();
    return html(successPage(
        "Sponsor code created",
        "Send this code only to friends you want to sponsor. It can add accounts until your 10 seats are full.",
        `<p class="code">${escapeHtml(code)}</p><a class="button" href="/sponsor">Back to sponsored accounts</a>`,
    ));
}

async function removeSponsoredAccount(request: Request, env: Env): Promise<Response> {
    assertSameOrigin(request, env);
    const sponsorId = await requireSponsorSession(request, env, true);
    const form = await request.formData();
    const friendId = form.get("discord_user_id");
    if (!isDiscordSnowflake(friendId)) throw new GatewayError(400, "invalid_request");
    await env.DB.batch([
        env.DB.prepare("DELETE FROM sponsorships WHERE supporter_discord_user_id = ? AND sponsored_discord_user_id = ?")
            .bind(sponsorId, friendId),
        env.DB.prepare("DELETE FROM download_sessions WHERE discord_user_id = ? AND supporter_discord_user_id = ?")
            .bind(friendId, sponsorId),
    ]);
    return Response.redirect(`${env.PUBLIC_ORIGIN}/sponsor`, 303);
}

async function serveManifest(request: Request, env: Env, key: string): Promise<Response> {
    await requireDownloadSession(request, env);
    const object = await env.RELEASES.get(key);
    if (object === null || object.size > MAXIMUM_MANIFEST_BYTES) throw new GatewayError(404, "manifest_unavailable");
    const parsed = JSON.parse(await object.text()) as unknown;
    const rewritten = rewriteManifestArtifactUrls(parsed, env.PUBLIC_ORIGIN, env.LEGACY_R2_ORIGIN);
    return json(rewritten);
}

async function serveArtifact(request: Request, env: Env, encodedKey: string): Promise<Response> {
    await requireDownloadSession(request, env);
    let key: string;
    try {
        key = encodedKey.split("/").map(decodeURIComponent).join("/");
    } catch {
        throw new GatewayError(400, "invalid_artifact");
    }
    if (!isAllowedArtifactKey(key) || key.endsWith(".json")) throw new GatewayError(400, "invalid_artifact");
    const object = await env.RELEASES.get(key, { range: request.headers, onlyIf: request.headers });
    if (object === null) throw new GatewayError(404, "artifact_unavailable");
    const headers = new Headers({
        "cache-control": "private, no-store",
        "accept-ranges": "bytes",
        "x-content-type-options": "nosniff",
    });
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    if (!("body" in object)) return new Response(null, { status: 412, headers });
    if (object.range) {
        const offset = "suffix" in object.range ? object.size - object.range.suffix : (object.range.offset ?? 0);
        const length = "suffix" in object.range
            ? object.range.suffix
            : (object.range.length ?? object.size - offset);
        headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
        headers.set("content-length", String(length));
        return new Response(object.body, { status: 206, headers });
    }
    headers.set("content-length", String(object.size));
    return new Response(object.body, { status: 200, headers });
}

async function requireDownloadSession(request: Request, env: Env): Promise<void> {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new GatewayError(401, "authorization_required");
    const token = authorization.slice(7);
    if (!DEVICE_SECRET_PATTERN.test(token)) throw new GatewayError(401, "authorization_invalid");
    const row = await env.DB.prepare(
        "SELECT supporter_discord_user_id, expires_at FROM download_sessions WHERE token_hash = ?",
    ).bind(await sha256(token)).first<{ supporter_discord_user_id: string; expires_at: number }>();
    if (row === null || row.expires_at < nowSeconds()) throw new GatewayError(401, "authorization_expired");
}

async function requireSponsorSession(request: Request, env: Env, required: true): Promise<string>;
async function requireSponsorSession(request: Request, env: Env, required: false): Promise<string | null>;
async function requireSponsorSession(request: Request, env: Env, required: boolean): Promise<string | null> {
    const token = cookieValue(request.headers.get("cookie"), "nightly_sponsor");
    if (!token || !DEVICE_SECRET_PATTERN.test(token)) {
        if (required) throw new GatewayError(401, "authorization_required");
        return null;
    }
    const row = await env.DB.prepare(
        "SELECT supporter_discord_user_id, expires_at FROM sponsor_sessions WHERE token_hash = ?",
    ).bind(await sha256(token)).first<{ supporter_discord_user_id: string; expires_at: number }>();
    if (row === null || row.expires_at < nowSeconds()) {
        if (required) throw new GatewayError(401, "authorization_expired");
        return null;
    }
    return row.supporter_discord_user_id;
}

async function assertSponsorEligible(env: Env, supporterId: string): Promise<void> {
    const grant = await env.DB.prepare(
        "SELECT encrypted_refresh_token, token_nonce FROM supporter_grants WHERE supporter_discord_user_id = ?",
    ).bind(supporterId).first<{ encrypted_refresh_token: string; token_nonce: string }>();
    if (grant === null) throw new GatewayError(403, "supporter_reauthorization_required");
    let token: DiscordToken;
    try {
        const refreshToken = await decryptRefreshToken(env, grant.encrypted_refresh_token, grant.token_nonce);
        token = await refreshDiscordToken(env, refreshToken);
    } catch {
        throw new GatewayError(403, "supporter_reauthorization_required");
    }
    const member = await discordGet<DiscordMember>(
        `/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
        token.access_token,
    );
    if (!hasSupporterRole(member.roles)) {
        await env.DB.batch([
            env.DB.prepare("DELETE FROM download_sessions WHERE supporter_discord_user_id = ?").bind(supporterId),
            env.DB.prepare("DELETE FROM supporter_grants WHERE supporter_discord_user_id = ?").bind(supporterId),
        ]);
        throw new GatewayError(403, "supporter_role_required");
    }
    await storeSupporterGrant(env, supporterId, token.refresh_token);
}

async function storeSupporterGrant(env: Env, supporterId: string, refreshToken: string): Promise<void> {
    const encrypted = await encryptRefreshToken(env, refreshToken);
    await env.DB.prepare(`
        INSERT INTO supporter_grants (supporter_discord_user_id, encrypted_refresh_token, token_nonce, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(supporter_discord_user_id) DO UPDATE SET
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          token_nonce = excluded.token_nonce,
          updated_at = excluded.updated_at
    `).bind(supporterId, encrypted.ciphertext, encrypted.nonce, nowSeconds()).run();
}

function discordAuthorizationUrl(env: Env, state: string): string {
    const url = new URL(DISCORD_AUTHORIZE);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
    url.searchParams.set("scope", DISCORD_OAUTH_SCOPES);
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", `${env.PUBLIC_ORIGIN}/oauth/callback`);
    url.searchParams.set("prompt", "consent");
    return url.toString();
}

async function exchangeDiscordCode(env: Env, code: string): Promise<DiscordToken> {
    return discordTokenRequest(env, new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${env.PUBLIC_ORIGIN}/oauth/callback`,
    }));
}

async function refreshDiscordToken(env: Env, refreshToken: string): Promise<DiscordToken> {
    return discordTokenRequest(env, new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    }));
}

async function discordTokenRequest(env: Env, form: URLSearchParams): Promise<DiscordToken> {
    form.set("client_id", env.DISCORD_CLIENT_ID);
    form.set("client_secret", env.DISCORD_CLIENT_SECRET);
    const response = await fetch(DISCORD_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
    });
    const text = await boundedText(response, 16 * 1024);
    if (!response.ok) throw new GatewayError(502, "discord_authorization_failed");
    const value = JSON.parse(text) as Partial<DiscordToken>;
    if (value.token_type !== "Bearer" || typeof value.access_token !== "string"
        || typeof value.refresh_token !== "string" || typeof value.scope !== "string"
        || !DISCORD_OAUTH_SCOPES.split(" ").every((scope) => value.scope?.split(" ").includes(scope))) {
        throw new GatewayError(502, "discord_response_invalid");
    }
    return value as DiscordToken;
}

async function discordGet<T>(path: string, accessToken: string): Promise<T> {
    const response = await fetch(`${DISCORD_API}${path}`, {
        headers: { authorization: `Bearer ${accessToken}`, "user-agent": "BannerlordCoop-Nightly-Gateway/1" },
    });
    const text = await boundedText(response, 64 * 1024);
    if (!response.ok) throw new GatewayError(response.status === 404 ? 403 : 502, "discord_membership_required");
    return JSON.parse(text) as T;
}

async function encryptRefreshToken(env: Env, plaintext: string): Promise<{ ciphertext: string; nonce: string }> {
    const key = await encryptionKey(env);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(plaintext));
    return { ciphertext: base64url(new Uint8Array(ciphertext)), nonce: base64url(nonce) };
}

async function decryptRefreshToken(env: Env, ciphertext: string, nonce: string): Promise<string> {
    const key = await encryptionKey(env);
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: exactArrayBuffer(fromBase64url(nonce)) },
        key,
        exactArrayBuffer(fromBase64url(ciphertext)),
    );
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(plaintext);
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
    const bytes = fromBase64url(env.TOKEN_ENCRYPTION_KEY);
    if (bytes.byteLength !== 32) throw new Error("invalid_encryption_key");
    return crypto.subtle.importKey("raw", exactArrayBuffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function readForm(request: Request): Promise<URLSearchParams> {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (!Number.isSafeInteger(contentLength) || contentLength > 4096) throw new GatewayError(413, "request_too_large");
    return new URLSearchParams(await boundedText(request, 4096));
}

async function boundedText(response: Response | Request, maximum: number): Promise<string> {
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (!Number.isSafeInteger(declared) || declared > maximum) throw new GatewayError(502, "response_too_large");
    if (response.body === null) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximum) {
            await reader.cancel();
            throw new GatewayError(502, "response_too_large");
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}

function assertConfiguration(env: Env): void {
    if (env.PUBLIC_ORIGIN !== "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev"
        || env.LEGACY_R2_ORIGIN !== "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev"
        || !/^\d{17,20}$/.test(env.DISCORD_CLIENT_ID)
        || env.DISCORD_CLIENT_SECRET.length < 32
        || env.TOKEN_ENCRYPTION_KEY.length < 40) {
        throw new Error("gateway_configuration_invalid");
    }
}

function assertSameOrigin(request: Request, env: Env): void {
    if (request.headers.get("origin") !== env.PUBLIC_ORIGIN) throw new GatewayError(403, "origin_invalid");
}

function sponsorCookie(token: string, maxAge: number): string {
    return `nightly_sponsor=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function cookieValue(header: string | null, name: string): string | null {
    for (const part of header?.split(";") ?? []) {
        const [key, ...rest] = part.trim().split("=");
        if (key === name) return rest.join("=");
    }
    return null;
}

function json(value: unknown, status = 200): Response {
    return new Response(`${JSON.stringify(value)}\n`, { status, headers: JSON_HEADERS });
}

function html(body: string, status = 200): Response {
    return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}

function page(title: string, content: string): string {
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} | Bannerlord Coop</title><style>body{color:#eee;background:#11131a;font:16px system-ui;margin:0}.card{max-width:650px;margin:8vh auto;padding:32px;border:1px solid #444;background:#1a1d26}h1{font-size:30px}.button,button{display:inline-block;background:#8f1d23;color:white;border:0;padding:12px 18px;text-decoration:none;cursor:pointer}.code,code{font-family:ui-monospace,monospace}.code{font-size:24px;padding:14px;background:#0b0d12}li{margin:12px 0}form{display:inline;margin-left:12px}</style><main class="card">${content}</main></html>`;
}

function successPage(title: string, message: string, extra = ""): string {
    return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${extra}`);
}

function errorPage(message: string): string {
    return page("Access unavailable", `<h1>Access unavailable</h1><p>${escapeHtml(message)}</p>`);
}

function sponsorClaimPage(deviceId: string, username: string): string {
    return page("Sponsor required", `<h1>Hi ${escapeHtml(username)}</h1><p>Your Discord account does not have a current Patreon, Afdian, or Boosty supporter role. Enter a sponsor code from a supporter who has an open seat.</p><form method="post" action="/v1/sponsorship/claim"><input type="hidden" name="device_id" value="${escapeHtml(deviceId)}"><label>Sponsor code <input name="sponsor_code" required maxlength="128" autocomplete="off"></label><button>Use sponsor seat</button></form>`);
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function nowSeconds(): number { return Math.floor(Date.now() / 1000); }

function normalizeSponsorCode(value: string): string { return value.trim().toUpperCase(); }

function randomCode(length: number): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function randomToken(bytes: number): string { return base64url(crypto.getRandomValues(new Uint8Array(bytes))); }

async function sha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value: string): Uint8Array {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

class GatewayError extends Error {
    constructor(readonly status: number, readonly code: string) { super(code); }
}
