import {
    DEVICE_SESSION_SECONDS,
    DISCORD_GUILD_ID,
    DISCORD_OAUTH_SCOPES,
    DOWNLOAD_SESSION_SECONDS,
    SPONSORED_ACCOUNT_LIMIT,
    createSponsorFormToken,
    hasNightlyAccessRole,
    isAllowedSponsorClaimRequest,
    isAllowedArtifactKey,
    isDiscordSnowflake,
    rewriteManifestArtifactUrls,
    verifySponsorFormToken,
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
const SITE_HERO_IMAGE = "https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop-website/07491ba62e3b038b16458402b4cc92dccf71b985/public/images/singleleader.png";

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
    if (request.method === "GET" && url.pathname === "/") {
        return html(nightlyAccessPage());
    }
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

export async function completeOAuth(url: URL, env: Env): Promise<Response> {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || code.length > 512 || !state || !DEVICE_SECRET_PATTERN.test(state)) {
        return html(errorPage("Discord sign-in could not be verified."), 400);
    }
    const stateHash = await sha256(state);
    const token = await exchangeDiscordCode(env, code);
    const user = await discordGet<DiscordUser>("/users/@me", token.access_token);
    if (!isDiscordSnowflake(user.id)) {
        throw new GatewayError(502, "discord_response_invalid");
    }
    const portalState = await env.DB.prepare(
        "SELECT state_hash FROM oauth_states WHERE state_hash = ? AND expires_at >= ?",
    ).bind(stateHash, nowSeconds()).first();
    if (portalState !== null) {
        await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?").bind(stateHash).run();
        const member = await discordGet<DiscordMember>(
            `/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
            token.access_token,
        );
        if (!Array.isArray(member.roles)) throw new GatewayError(502, "discord_response_invalid");
        if (!hasNightlyAccessRole(member.roles)) return html(errorPage("A Staff, Tester, Patreon, Boosty, or Afdian role is required."), 403);
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
    const member = await discordGet<DiscordMember>(
        `/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
        token.access_token,
        true,
    );
    if (member !== null && !Array.isArray(member.roles)) {
        throw new GatewayError(502, "discord_response_invalid");
    }
    if (member !== null && hasNightlyAccessRole(member.roles)) {
        await storeSupporterGrant(env, user.id, token.refresh_token);
        await env.DB.prepare(
            "UPDATE device_sessions SET status = 'approved', discord_user_id = ?, sponsor_discord_user_id = ?, authorized_at = ? WHERE id = ?",
        ).bind(user.id, user.id, nowSeconds(), device.id).run();
        return html(successPage("Access approved", "Return to the installer window. It will continue automatically."));
    }
    const existing = await env.DB.prepare(
        "SELECT supporter_discord_user_id FROM sponsorships WHERE sponsored_discord_user_id = ?",
    ).bind(user.id).first<{ supporter_discord_user_id: string }>();
    if (existing !== null) {
        await assertSponsorEligible(env, existing.supporter_discord_user_id);
        await env.DB.prepare(
            "UPDATE device_sessions SET status = 'approved', discord_user_id = ?, sponsor_discord_user_id = ?, authorized_at = ? WHERE id = ?",
        ).bind(user.id, existing.supporter_discord_user_id, nowSeconds(), device.id).run();
        return html(successPage("Sponsored access approved", "Return to the installer window. It will continue automatically."));
    }
    await env.DB.prepare("UPDATE device_sessions SET status = 'awaiting-sponsor', discord_user_id = ? WHERE id = ?")
        .bind(user.id, device.id).run();
    return html(sponsorClaimPage(device.id, user.username));
}

async function claimSponsorship(request: Request, env: Env): Promise<Response> {
    assertSponsorClaimRequest(request, env);
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
        return html(errorPage("That eligible member has already used all 10 sponsored-account seats."), 409);
    }
    await env.DB.prepare(
        "UPDATE device_sessions SET status = 'approved', sponsor_discord_user_id = ?, authorized_at = ? WHERE id = ?",
    ).bind(sponsor.supporter_discord_user_id, nowSeconds(), deviceId).run();
    return html(successPage("Sponsored access approved", "Return to the installer window. It will continue automatically."));
}

async function sponsorPortal(request: Request, env: Env): Promise<Response> {
    const sponsorId = await requireSponsorSession(request, env, false);
    if (sponsorId === null) {
        return html(page(
            "Share nightlies with friends",
            "Nightly access portal",
            `<h1>Bring your <span>warband.</span></h1>
            <p class="lede">Staff, Testers, and Patreon, Boosty, or Afdian supporters can each share nightly access with up to 10 Discord accounts.</p>
            <div class="actions"><a class="button" href="/sponsor/login">Continue with Discord <span aria-hidden="true">&rarr;</span></a></div>
            <p class="fine-print">We verify your qualifying Staff, Tester, Patreon, Boosty, or Afdian Discord role when you sign in and whenever a sponsored friend installs or updates.</p>`,
            "portal",
        ));
    }
    await assertSponsorEligible(env, sponsorId);
    const formToken = await sponsorFormToken(request);
    const rows = await env.DB.prepare(
        "SELECT sponsored_discord_user_id, created_at FROM sponsorships WHERE supporter_discord_user_id = ? ORDER BY created_at",
    ).bind(sponsorId).all<{ sponsored_discord_user_id: string; created_at: number }>();
    const seats = rows.results.map((row, index) => `<li class="seat"><span class="seat-number">${String(index + 1).padStart(2, "0")}</span><span class="seat-account"><span class="seat-label">Discord account</span><code>${escapeHtml(row.sponsored_discord_user_id)}</code></span><form method="post" action="/v1/sponsor/remove"><input type="hidden" name="form_token" value="${formToken}"><input type="hidden" name="discord_user_id" value="${escapeHtml(row.sponsored_discord_user_id)}"><button class="text-button">Remove access</button></form></li>`).join("");
    const seatCount = rows.results.length;
    return html(page(
        `Sponsored accounts (${rows.results.length}/${SPONSORED_ACCOUNT_LIMIT})`,
        "Nightly access portal",
        `<div class="portal-heading"><div><h1>Your <span>warband.</span></h1><p class="lede">Create a code for friends to use during installation. Their access remains tied to your current qualifying Staff, Tester, Patreon, Boosty, or Afdian Discord role.</p></div><div class="seat-count" aria-label="${seatCount} of ${SPONSORED_ACCOUNT_LIMIT} seats used"><strong>${seatCount}</strong><span>of ${SPONSORED_ACCOUNT_LIMIT}<br>seats used</span></div></div>
        <form class="code-action" method="post" action="/v1/sponsor/code"><input type="hidden" name="form_token" value="${formToken}"><button class="button">${seatCount === 0 ? "Create sponsor code" : "Create a new code"} <span aria-hidden="true">&rarr;</span></button><p>Creating a new code disables the previous one. Existing sponsored accounts keep access.</p></form>
        <section class="seat-section" aria-labelledby="seat-heading"><div class="section-heading"><h2 id="seat-heading">Sponsored accounts</h2><span>${SPONSORED_ACCOUNT_LIMIT - seatCount} open</span></div><ul class="seat-list">${seats || `<li class="empty-state"><strong>No seats claimed yet.</strong><span>Create a sponsor code and send it to a friend you trust.</span></li>`}</ul></section>`,
        "portal portal-wide",
    ));
}

async function rotateSponsorCode(request: Request, env: Env): Promise<Response> {
    const sponsorId = await requireSponsorSession(request, env, true);
    const form = await readForm(request);
    await assertSponsorFormRequest(request, form);
    const code = `${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
    await env.DB.prepare("UPDATE supporter_grants SET sponsor_code_hash = ?, updated_at = ? WHERE supporter_discord_user_id = ?")
        .bind(await sha256(code), nowSeconds(), sponsorId).run();
    return html(successPage(
        "Sponsor code created",
        "Send this code only to friends you want to sponsor. It can add accounts until your 10 seats are full.",
        `<div class="code-block"><span>Your sponsor code</span><p class="code">${escapeHtml(code)}</p></div><div class="actions"><a class="button secondary" href="/sponsor">Back to sponsored accounts</a></div>`,
    ));
}

async function removeSponsoredAccount(request: Request, env: Env): Promise<Response> {
    const sponsorId = await requireSponsorSession(request, env, true);
    const form = await readForm(request);
    await assertSponsorFormRequest(request, form);
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
    if (!hasNightlyAccessRole(member.roles)) {
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

async function discordGet<T>(path: string, accessToken: string): Promise<T>;
async function discordGet<T>(path: string, accessToken: string, allowNotFound: true): Promise<T | null>;
async function discordGet<T>(path: string, accessToken: string, allowNotFound = false): Promise<T | null> {
    const response = await fetch(`${DISCORD_API}${path}`, {
        headers: { authorization: `Bearer ${accessToken}`, "user-agent": "BannerlordCoop-Nightly-Gateway/1" },
    });
    const text = await boundedText(response, 64 * 1024);
    if (allowNotFound && response.status === 404) return null;
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

function assertSponsorClaimRequest(request: Request, env: Env): void {
    if (!isAllowedSponsorClaimRequest(
        request.headers.get("origin"),
        request.headers.get("sec-fetch-site"),
        env.PUBLIC_ORIGIN,
    )) throw new GatewayError(403, "origin_invalid");
}

async function sponsorFormToken(request: Request): Promise<string> {
    const token = cookieValue(request.headers.get("cookie"), "nightly_sponsor");
    if (!token || !DEVICE_SECRET_PATTERN.test(token)) throw new GatewayError(401, "authorization_required");
    return createSponsorFormToken(token);
}

async function assertSponsorFormRequest(request: Request, form: URLSearchParams): Promise<void> {
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new GatewayError(403, "origin_invalid");
    const token = cookieValue(request.headers.get("cookie"), "nightly_sponsor");
    if (!token || !await verifySponsorFormToken(token, form.get("form_token"))) {
        throw new GatewayError(403, "form_token_invalid");
    }
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
    return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "content-security-policy": `default-src 'none'; img-src ${SITE_HERO_IMAGE}; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` } });
}

export function page(title: string, eyebrow: string, content: string, pageClass = ""): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#070806"><title>${escapeHtml(title)} | Bannerlord Coop</title><style>${GATEWAY_CSS}</style></head><body><div class="backdrop" style="--hero:url('${SITE_HERO_IMAGE}')" aria-hidden="true"></div><header class="site-header"><a class="brand" href="/" aria-label="Bannerlord Coop Nightly Access home"><span class="brand-mark" aria-hidden="true"><i></i><b></b></span><span>Bannerlord Coop</span></a><span class="product-label">Nightly Access</span></header><main class="shell ${escapeHtml(pageClass)}"><section class="card"><div class="card-accent" aria-hidden="true"></div><p class="eyebrow">${escapeHtml(eyebrow)}</p>${content}</section></main><footer><span>Bannerlord Coop</span><span class="footer-rule"></span><span>Private nightly gateway</span></footer></body></html>`;
}

function successPage(title: string, message: string, extra = ""): string {
    return page(title, "Nightly access", `<div class="status-icon success" aria-hidden="true"><span>&#10003;</span></div><h1>${escapeHtml(title)}</h1><p class="lede">${escapeHtml(message)}</p>${extra}<p class="fine-print">You may safely close this tab once the installer continues.</p>`, "status-page");
}

function errorPage(message: string): string {
    return page("Access unavailable", "Nightly access", `<div class="status-icon error" aria-hidden="true"><span>!</span></div><h1>Access <span>unavailable.</span></h1><p class="lede">${escapeHtml(message)}</p><div class="support-note"><strong>Need a hand?</strong><span>Ask in the Bannerlord Coop Discord and include the message shown above.</span></div>`, "status-page");
}

function sponsorClaimPage(deviceId: string, username: string): string {
    return page("Sponsor required", "Nightly installer", `<p class="account-chip"><span aria-hidden="true"></span>Signed in as <strong>${escapeHtml(username)}</strong></p><h1>One more step to <span>ride.</span></h1><p class="lede">This Discord account does not currently have a qualifying Staff, Tester, Patreon, Boosty, or Afdian role.</p><div class="divider"><span>Have a sponsor?</span></div><form class="claim-form" method="post" action="/v1/sponsorship/claim"><input type="hidden" name="device_id" value="${escapeHtml(deviceId)}"><label for="sponsor-code">Enter your friend&rsquo;s sponsor code</label><div class="field-row"><input id="sponsor-code" name="sponsor_code" required maxlength="128" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX" aria-describedby="sponsor-help"><button class="button">Claim a seat <span aria-hidden="true">&rarr;</span></button></div><p id="sponsor-help" class="field-help">Your friend must have a qualifying Staff, Tester, Patreon, Boosty, or Afdian role and an open seat. Access is checked again on every install and update.</p></form><div class="support-note"><strong>Already eligible?</strong><span>Make sure the correct Discord account has a qualifying Staff or Tester role or is connected to your Patreon, Boosty, or Afdian membership, then restart the installer.</span></div>`, "claim-page");
}

export function nightlyAccessPage(): string {
    return page("Nightly Access", "Staff, Supporter & Tester builds", `<h1>Test tomorrow&rsquo;s battles <span>today.</span></h1><p class="lede">Install or update the Bannerlord Coop client, Windows dedicated server, or both. Nightly builds are available to Staff, Testers, and Patreon, Boosty, and Afdian supporters, plus their sponsored friends.</p><div class="access-grid"><div><span class="step-number">01</span><strong>Download and double-click</strong><p>Save the Windows installer launcher, then double-click it. The window stays open so you can see every prompt or error.</p></div><div><span class="step-number">02</span><strong>Choose and verify</strong><p>Select the client, dedicated server, or both. Discord access is checked at install and update time.</p></div></div><div class="actions"><a class="button" href="/install.cmd" download="BannerlordCoop-Nightly-Installer.cmd">Download Windows installer <span aria-hidden="true">&darr;</span></a><a class="button secondary" href="/sponsor">Manage sponsored accounts</a><a class="quiet-link" href="/install.ps1" download="BannerlordCoop-Nightly-Installer.ps1">Raw PowerShell script</a><a class="quiet-link" href="https://discord.gg/bannerlordcoop">Join the Discord</a></div>`, "landing-page");
}

const GATEWAY_CSS = `
:root{--background:#070806;--surface:#0c0d0b;--surface-raised:#11120f;--foreground:#e8e4da;--muted:#96938b;--dim:#67665f;--crimson:#8f1d23;--crimson-hover:#a4232a;--gold:#aa9760;--border:rgba(232,228,218,.12);--border-gold:rgba(170,151,96,.25)}
*{box-sizing:border-box}html{min-height:100%;background:var(--background)}body{min-height:100vh;margin:0;color:var(--foreground);background:var(--background);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;overflow-x:hidden}::selection{background:var(--crimson);color:#fff}.backdrop{position:fixed;inset:0;z-index:0;background-image:linear-gradient(90deg,rgba(7,8,6,.98) 0%,rgba(7,8,6,.91) 42%,rgba(7,8,6,.55) 100%),linear-gradient(0deg,#070806 0%,transparent 44%,rgba(7,8,6,.5) 100%),radial-gradient(circle at 23% 55%,rgba(143,29,35,.22),transparent 35%),var(--hero);background-size:cover;background-position:62% center}.backdrop:after{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px);background-size:100% 4px;opacity:.45;mask-image:linear-gradient(to bottom,transparent,#000 20%,#000 80%,transparent)}
.site-header{position:relative;z-index:2;width:min(calc(100% - 3rem),1280px);height:76px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(232,228,218,.1)}.brand{display:flex;align-items:center;gap:12px;color:var(--foreground);text-decoration:none;font-family:Georgia,"Times New Roman",serif;font-size:17px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}.brand-mark{position:relative;width:25px;height:25px;display:inline-block}.brand-mark i,.brand-mark b{position:absolute;left:11px;top:1px;width:3px;height:24px;background:var(--gold);transform:rotate(45deg);transform-origin:center}.brand-mark b{transform:rotate(-45deg)}.brand-mark i:after,.brand-mark b:after{content:"";position:absolute;width:9px;height:2px;background:var(--gold);left:-3px;top:16px}.product-label{font-size:11px;font-weight:650;letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
.shell{position:relative;z-index:1;width:min(calc(100% - 3rem),1280px);margin:auto;display:grid;grid-template-columns:repeat(12,1fr);padding:64px 0}.card{position:relative;grid-column:2/span 7;max-width:760px;padding:48px 52px 50px;background:linear-gradient(145deg,rgba(17,18,15,.96),rgba(10,11,9,.92));border:1px solid var(--border);box-shadow:0 28px 90px rgba(0,0,0,.38)}.card:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 0 0,rgba(170,151,96,.1),transparent 42%)}.card-accent{position:absolute;top:-1px;left:52px;width:80px;height:2px;background:var(--gold);box-shadow:0 0 18px rgba(170,151,96,.35)}.card>*:not(.card-accent){position:relative}.eyebrow{margin:0 0 17px;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:var(--gold)}h1{max-width:680px;margin:0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(43px,5vw,70px);font-weight:500;line-height:.92;letter-spacing:-.035em;text-wrap:balance}h1 span{color:var(--crimson)}.lede{max-width:650px;margin:25px 0 0;color:var(--muted);font-size:16px;line-height:1.75;text-wrap:pretty}.actions{display:flex;align-items:center;flex-wrap:wrap;gap:22px;margin-top:32px}.button,button.button{min-height:50px;display:inline-flex;align-items:center;justify-content:center;gap:16px;padding:14px 22px;border:1px solid var(--crimson);border-radius:2px;background:var(--crimson);color:#fff;text-decoration:none;font:700 12px/1.2 Inter,ui-sans-serif,system-ui,sans-serif;letter-spacing:.13em;text-transform:uppercase;cursor:pointer;transition:background .2s,border-color .2s,color .2s}.button:hover,button.button:hover{background:var(--crimson-hover);border-color:var(--crimson-hover)}.button:focus-visible,button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:3px}.button.secondary{background:transparent;border-color:rgba(232,228,218,.2);color:var(--foreground)}.button.secondary:hover{border-color:var(--gold);color:var(--gold);background:rgba(170,151,96,.06)}.quiet-link{color:var(--muted);font-size:12px;font-weight:650;letter-spacing:.12em;text-transform:uppercase;text-underline-offset:5px}.quiet-link:hover{color:var(--gold)}.fine-print{max-width:560px;margin:28px 0 0;padding-top:20px;border-top:1px solid var(--border);color:var(--dim);font-size:12px;line-height:1.65}
.account-chip{display:inline-flex;align-items:center;gap:7px;margin:0 0 24px;padding:7px 10px 7px 8px;background:rgba(232,228,218,.055);border:1px solid var(--border);color:var(--muted);font-size:12px}.account-chip>span{width:7px;height:7px;background:#5f9565;border-radius:50%;box-shadow:0 0 9px rgba(95,149,101,.55)}.account-chip strong{color:var(--foreground);font-weight:650}.divider{display:flex;align-items:center;gap:14px;margin:30px 0 20px;color:var(--gold);font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase}.divider:after{content:"";height:1px;flex:1;background:var(--border-gold)}.claim-form{margin:0}.claim-form label{display:block;margin-bottom:9px;color:var(--foreground);font:650 12px/1.4 Inter,ui-sans-serif,system-ui,sans-serif}.field-row{display:flex;gap:10px}.field-row input{min-width:0;flex:1;height:50px;padding:0 16px;border:1px solid rgba(232,228,218,.18);border-radius:2px;background:rgba(3,4,3,.72);color:var(--foreground);font:600 16px/1 ui-monospace,"SFMono-Regular",Consolas,monospace;letter-spacing:.08em;text-transform:uppercase}.field-row input::placeholder{color:#585a54}.field-row input:hover{border-color:rgba(170,151,96,.42)}.field-help{margin:10px 0 0;color:var(--dim);font-size:11px;line-height:1.6}.support-note{display:grid;grid-template-columns:minmax(130px,.55fr) 1fr;gap:20px;margin-top:30px;padding:19px 20px;border-left:2px solid var(--gold);background:rgba(170,151,96,.055);font-size:12px;line-height:1.55}.support-note strong{color:var(--gold);font-size:10px;letter-spacing:.12em;text-transform:uppercase}.support-note span{color:var(--muted)}
.status-page .card{grid-column:3/span 6;max-width:680px}.status-icon{width:46px;height:46px;margin:0 0 25px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border-gold);color:var(--gold);font:500 24px/1 Georgia,serif;transform:rotate(45deg)}.status-icon>span{transform:rotate(-45deg)}.status-icon.success{border-color:rgba(95,149,101,.55);color:#88b28b}.status-icon.error{border-color:rgba(143,29,35,.65);color:#cf555c}.code-block{margin-top:28px;padding:20px 22px;border:1px solid var(--border-gold);background:rgba(3,4,3,.7)}.code-block>span{color:var(--gold);font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}.code{margin:9px 0 0;color:var(--foreground);font:600 clamp(20px,4vw,30px)/1.2 ui-monospace,"SFMono-Regular",Consolas,monospace;letter-spacing:.1em}.status-page .code-block+.actions+.fine-print{display:none}
.access-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;margin-top:32px;background:var(--border)}.access-grid>div{padding:20px;background:rgba(7,8,6,.88)}.step-number{display:block;margin-bottom:12px;color:var(--crimson);font:700 11px/1 Inter,sans-serif;letter-spacing:.15em}.access-grid strong{font-family:Georgia,"Times New Roman",serif;font-size:18px;font-weight:600}.access-grid p{margin:7px 0 0;color:var(--muted);font-size:12px;line-height:1.55}
.portal-wide .card{grid-column:2/span 10;max-width:none}.portal-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:42px}.portal-heading .lede{max-width:630px}.seat-count{flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:12px 15px;border:1px solid var(--border-gold);background:rgba(170,151,96,.04)}.seat-count strong{color:var(--gold);font:500 32px/1 Georgia,serif}.seat-count span{color:var(--dim);font-size:9px;line-height:1.4;letter-spacing:.12em;text-transform:uppercase}.code-action{display:flex;align-items:center;gap:20px;margin-top:32px}.code-action p{max-width:420px;margin:0;color:var(--dim);font-size:11px;line-height:1.55}.seat-section{margin-top:38px}.section-heading{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--border-gold)}.section-heading h2{margin:0;font:600 12px/1.4 Inter,sans-serif;letter-spacing:.17em;text-transform:uppercase}.section-heading>span{color:var(--gold);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.seat-list{margin:0;padding:0;list-style:none}.seat{display:grid;grid-template-columns:48px 1fr auto;align-items:center;gap:14px;min-height:70px;border-bottom:1px solid var(--border)}.seat-number{color:var(--dim);font:500 12px/1 ui-monospace,monospace}.seat-account{display:flex;flex-direction:column;gap:4px}.seat-label{color:var(--dim);font-size:9px;letter-spacing:.13em;text-transform:uppercase}.seat code{color:var(--foreground);font:500 13px/1.4 ui-monospace,monospace}.seat form{margin:0}.text-button{padding:8px 0;border:0;background:transparent;color:var(--muted);font:650 10px/1 Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}.text-button:hover{color:#cf555c}.empty-state{display:flex;flex-direction:column;gap:7px;padding:26px 0;color:var(--foreground);font:600 14px/1.4 Georgia,serif}.empty-state span{color:var(--dim);font:400 12px/1.5 Inter,sans-serif}
footer{position:relative;z-index:2;width:min(calc(100% - 3rem),1280px);min-height:54px;margin:0 auto;display:flex;align-items:center;gap:13px;color:var(--dim);font-size:9px;font-weight:650;letter-spacing:.17em;text-transform:uppercase}footer>span:first-child{color:var(--muted)}.footer-rule{width:28px;height:1px;background:var(--crimson)}
@media(max-width:900px){.shell{display:block;width:min(calc(100% - 2rem),720px);padding:42px 0}.card,.status-page .card,.portal-wide .card{max-width:none;padding:39px 34px}.site-header,footer{width:calc(100% - 2rem)}.portal-heading{align-items:flex-start}.backdrop{background-position:68% center}}
@media(max-width:600px){.site-header{height:66px}.brand{font-size:13px;letter-spacing:.08em}.brand-mark{transform:scale(.82)}.product-label{display:none}.shell{padding:24px 0}.card,.status-page .card,.portal-wide .card{padding:31px 22px 30px}.card-accent{left:22px;width:58px}h1{font-size:39px}.lede{font-size:14px;line-height:1.65}.field-row{display:block}.field-row .button{width:100%;margin-top:10px}.support-note{grid-template-columns:1fr;gap:7px}.access-grid{grid-template-columns:minmax(0,1fr)}.portal-heading{display:block}.seat-count{display:inline-flex;margin-top:24px}.code-action{display:block}.code-action .button{width:100%}.code-action p{margin-top:12px}.seat{grid-template-columns:32px minmax(0,1fr);gap:9px;padding:12px 0}.seat form{grid-column:2}.seat code{overflow-wrap:anywhere}.text-button{padding:0 0 5px}.actions{align-items:stretch;flex-direction:column}.actions .button,.code-action .button{width:100%;max-width:100%;padding-inline:14px;text-align:center;font-size:10px;letter-spacing:.08em;white-space:normal}.quiet-link{text-align:center}.backdrop{opacity:.72;background-position:72% center}footer{justify-content:center}.footer-rule,footer span:last-child{display:none}.status-icon{transform:none}.status-icon>span{transform:none}}
@media(prefers-reduced-motion:no-preference){.card{animation:arrive .45s ease-out both}@keyframes arrive{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}}
`;

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
