import {
    CREATE_BUILD_PIN_KIND,
    CREATE_BUILD_PIN_LIFETIME_SECONDS,
    DEVICE_SESSION_SECONDS,
    DISCORD_GUILD_ID,
    DISCORD_OAUTH_SCOPES,
    DOWNLOAD_SESSION_SECONDS,
    SPONSORED_ACCOUNT_LIMIT,
    createBuildPinInstallUrl,
    createBuildPinToken,
    createSponsorFormToken,
    hasNightlyAccessRole,
    isAllowedArtifactKey,
    isAllowedManualServerKey,
    isAllowedPinClientKey,
    isAllowedSponsorClaimRequest,
    isCreateBuildPinCommitSha,
    isCreateBuildPinToken,
    isDiscordSnowflake,
    isEligibleNightlySponsor,
    isSha256Hex,
    mintSecretsEqual,
    pinClientObjectKey,
    rewriteManifestArtifactUrls,
    verifySponsorFormToken,
} from "./core";
import { databaseForRequest } from "./database";

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
const MAXIMUM_PIN_CLIENT_BYTES = 8 * 1024 * 1024;
const MAXIMUM_PIN_MINT_BYTES = MAXIMUM_PIN_CLIENT_BYTES + 16 * 1024;
const MAXIMUM_PIN_SERVER_BYTES = 6 * 1024 * 1024 * 1024;
const MANUAL_SERVER_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$/;
const PUBLIC_MANUAL_SERVER_ORIGIN = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
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
            const database = await databaseForRequest(env);
            return await route(request, { ...env, DB: database });
        } catch (error) {
            console.error(JSON.stringify({
                event: "nightly_gateway_request_failed",
                path: new URL(request.url).pathname,
                error: error instanceof GatewayError ? error.code : "internal_error",
            }));
            if (error instanceof GatewayError) {
                if (prefersHtmlError(request)) {
                    return html(errorPage(gatewayErrorMessage(error.code)), error.status);
                }
                return json({ error: error.code }, error.status);
            }
            return json({ error: "internal_error" }, 500);
        }
    },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
    assertConfiguration(env);
    const url = new URL(request.url);
    if (env.MIGRATION_MODE !== undefined && env.MIGRATION_MODE !== "locked") {
        throw new Error("gateway_migration_mode_invalid");
    }
    if (env.MIGRATION_MODE === "locked") {
        if (request.method === "GET" && url.pathname === "/health") {
            return json({ ok: false, maintenance: true }, 503);
        }
        throw new GatewayError(503, "migration_in_progress");
    }
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
    if (request.method === "GET" && url.pathname === "/install" && url.searchParams.has("pin")) {
        return serveCreateBuildPinPage(url, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/pins/install.cmd") {
        return serveCreateBuildPinLauncher(url, env);
    }
    if (request.method === "POST" && url.pathname === "/v1/pins") {
        return mintCreateBuildPin(request, env);
    }
    if (request.method === "POST" && url.pathname === "/v1/pins/token") {
        return redeemCreateBuildPin(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/manifests/pin") {
        return servePinManifest(request, env);
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
        if (!hasNightlyAccessRole(member.roles)) {
            return html(errorPage(
                "A Staff, Tester, Patreon, Boosty, or Afdian role is required.",
                sponsorCodeHelp(),
            ), 403);
        }
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
    // Keep the code form available when the previous sponsor no longer has access.
    if (existing !== null && await tryAssertSponsorEligible(env, existing.supporter_discord_user_id)) {
        await env.DB.prepare(
            "UPDATE device_sessions SET status = 'approved', discord_user_id = ?, sponsor_discord_user_id = ?, authorized_at = ? WHERE id = ?",
        ).bind(user.id, existing.supporter_discord_user_id, nowSeconds(), device.id).run();
        return html(successPage("Sponsored access approved", "Return to the installer window. It will continue automatically."));
    }
    await env.DB.prepare("UPDATE device_sessions SET status = 'awaiting-sponsor', discord_user_id = ? WHERE id = ?")
        .bind(user.id, device.id).run();
    return html(sponsorClaimPage(
        device.id,
        user.username,
        existing === null ? "" : previousSponsorAccessRevokedHelp(),
    ));
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
    if (!await tryAssertSponsorEligible(env, sponsor.supporter_discord_user_id)) {
        return html(errorPage(
            "That sponsor no longer has a qualifying Staff, Tester, Patreon, Boosty, or Afdian role.",
        ), 403);
    }
    const existingSeat = await env.DB.prepare(
        "SELECT supporter_discord_user_id FROM sponsorships WHERE sponsored_discord_user_id = ?",
    ).bind(device.discord_user_id).first<{ supporter_discord_user_id: string }>();
    if (existingSeat !== null && existingSeat.supporter_discord_user_id !== sponsor.supporter_discord_user_id) {
        if (await tryAssertSponsorEligible(env, existingSeat.supporter_discord_user_id)) {
            return html(errorPage("This Discord account already has sponsored access."), 409);
        }
        await env.DB.batch([
            env.DB.prepare("DELETE FROM sponsorships WHERE sponsored_discord_user_id = ?")
                .bind(device.discord_user_id),
            env.DB.prepare("DELETE FROM download_sessions WHERE discord_user_id = ?")
                .bind(device.discord_user_id),
        ]);
    }
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
    if (!await tryAssertSponsorEligible(env, sponsorId)) {
        return Response.redirect(`${env.PUBLIC_ORIGIN}/sponsor/login`, 302);
    }
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

type DownloadAuthorization = { kind: "nightly" } | PinAuthorization;
type PinAuthorization = { kind: "pin"; buildId: string };

type CreateBuildPinMetadata = {
    buildId: string;
    clientSha: string;
    serverSha: string;
    expiresAt: string;
    client: { fileName: string; bytes: number; sha256: string };
    server: {
        fileName: string;
        key: string;
        publicUrl: string;
        bytes: number;
        sha256: string;
    };
};

type InstallerPinRow = {
    token_hash: string;
    build_id: string;
    client_sha: string;
    server_sha: string;
    client_file_name: string;
    client_bytes: number;
    client_sha256: string;
    server_file_name: string;
    server_key: string;
    server_public_url: string;
    server_bytes: number;
    server_sha256: string;
    created_at: number;
    expires_at: number;
    consumed_at: number | null;
};

export async function mintCreateBuildPin(request: Request, env: Env): Promise<Response> {
    await requirePinMintSecret(request, env);
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
        const declared = Number(contentLength);
        if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAXIMUM_PIN_MINT_BYTES) {
            throw new GatewayError(413, "request_too_large");
        }
    }
    const form = await request.formData();
    const rawMetadata = form.get("metadata");
    const clientFile = form.get("client");
    if (typeof rawMetadata !== "string" || rawMetadata.length > 8 * 1024 || !(clientFile instanceof File)) {
        throw new GatewayError(400, "invalid_request");
    }
    let metadata: CreateBuildPinMetadata;
    try {
        metadata = JSON.parse(rawMetadata) as CreateBuildPinMetadata;
    } catch {
        throw new GatewayError(400, "invalid_request");
    }
    const parsed = parseCreateBuildPinMetadata(metadata, env);
    if (clientFile.size !== parsed.client.bytes || clientFile.size > MAXIMUM_PIN_CLIENT_BYTES) {
        throw new GatewayError(400, "invalid_request");
    }
    const clientBytes = new Uint8Array(await clientFile.arrayBuffer());
    if (clientBytes.byteLength !== parsed.client.bytes) throw new GatewayError(400, "invalid_request");
    const digest = await sha256Bytes(clientBytes);
    if (digest !== parsed.client.sha256) throw new GatewayError(400, "invalid_request");
    const token = await createBuildPinToken(
        pinMintSecret(env),
        parsed.buildId,
        parsed.client.sha256,
        parsed.server.sha256,
    );
    const tokenHash = await sha256(token);
    const now = nowSeconds();
    const expiresAt = Math.floor(Date.parse(parsed.expiresAt) / 1000);
    const existing = await env.DB.prepare(
        "SELECT token_hash, client_sha256, server_sha256, expires_at FROM installer_pins WHERE build_id = ?",
    ).bind(parsed.buildId).first<{
        token_hash: string;
        client_sha256: string;
        server_sha256: string;
        expires_at: number;
    }>();
    if (existing !== null) {
        if (existing.token_hash !== tokenHash
            || existing.client_sha256 !== parsed.client.sha256
            || existing.server_sha256 !== parsed.server.sha256) {
            throw new GatewayError(409, "pin_identity_conflict");
        }
    } else {
        const inserted = await env.DB.prepare(`
            INSERT INTO installer_pins (
                token_hash, build_id, client_sha, server_sha,
                client_file_name, client_bytes, client_sha256,
                server_file_name, server_key, server_public_url, server_bytes, server_sha256,
                created_at, expires_at, consumed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `).bind(
            tokenHash,
            parsed.buildId,
            parsed.clientSha,
            parsed.serverSha,
            parsed.client.fileName,
            parsed.client.bytes,
            parsed.client.sha256,
            parsed.server.fileName,
            parsed.server.key,
            parsed.server.publicUrl,
            parsed.server.bytes,
            parsed.server.sha256,
            now,
            expiresAt,
        ).run();
        if (!inserted.success) throw new GatewayError(500, "internal_error");
    }
    await env.RELEASES.put(pinClientObjectKey(parsed.buildId), clientBytes, {
        httpMetadata: { contentType: "application/x-7z-compressed" },
        customMetadata: { sha256: parsed.client.sha256 },
    });
    return json({
        token,
        installUrl: createBuildPinInstallUrl(env.PUBLIC_ORIGIN, token),
        expiresAt: parsed.expiresAt,
    }, existing === null ? 201 : 200);
}

export async function redeemCreateBuildPin(request: Request, env: Env): Promise<Response> {
    const body = await readForm(request);
    const pin = body.get("pin");
    if (!isCreateBuildPinToken(pin)) throw new GatewayError(400, "invalid_request");
    const now = nowSeconds();
    const pinHash = await sha256(pin);
    const row = await env.DB.prepare(
        "SELECT build_id, expires_at, consumed_at FROM installer_pins WHERE token_hash = ?",
    ).bind(pinHash).first<{ build_id: string; expires_at: number; consumed_at: number | null }>();
    if (row === null) throw new GatewayError(400, "invalid_request");
    if (row.expires_at < now) throw new GatewayError(400, "expired_token");
    if (row.consumed_at !== null) throw new GatewayError(409, "already_used");
    const object = await env.RELEASES.get(pinClientObjectKey(row.build_id));
    if (object === null) throw new GatewayError(409, "pin_incomplete");
    const accessToken = randomToken(32);
    const result = await env.DB.batch([
        env.DB.prepare(`
            UPDATE installer_pins SET consumed_at = ?
            WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
        `).bind(now, pinHash, now),
        env.DB.prepare(`
            INSERT INTO pin_download_sessions (token_hash, pin_token_hash, created_at, expires_at)
            SELECT ?, token_hash, ?, ?
            FROM installer_pins WHERE token_hash = ? AND consumed_at = ?
        `).bind(await sha256(accessToken), now, now + DOWNLOAD_SESSION_SECONDS, pinHash, now),
    ]);
    if (!result.every((entry) => entry.success && entry.meta.changes === 1)) {
        throw new GatewayError(409, "already_used");
    }
    return json({ access_token: accessToken, token_type: "Bearer", expires_in: DOWNLOAD_SESSION_SECONDS });
}

export async function servePinManifest(request: Request, env: Env): Promise<Response> {
    const session = await requirePinDownloadSession(request, env);
    const pin = await env.DB.prepare(`
        SELECT build_id, client_sha, server_sha, client_file_name, client_bytes, client_sha256,
               server_file_name, server_key, server_public_url, server_bytes, server_sha256,
               created_at, expires_at
        FROM installer_pins WHERE build_id = ?
    `).bind(session.buildId).first<InstallerPinRow>();
    if (pin === null) throw new GatewayError(404, "manifest_unavailable");
    const clientKey = pinClientObjectKey(pin.build_id);
    const builtAt = new Date(pin.created_at * 1000).toISOString();
    return json({
        version: 1,
        kind: CREATE_BUILD_PIN_KIND,
        releaseDate: builtAt.slice(0, 10),
        headSha: pin.client_sha,
        clientSha: pin.client_sha,
        serverSha: pin.server_sha,
        builtAt,
        expiresAt: new Date(pin.expires_at * 1000).toISOString(),
        client: {
            fileName: pin.client_file_name,
            key: clientKey,
            publicUrl: `${env.PUBLIC_ORIGIN}/v1/artifacts/${clientKey.split("/").map(encodeURIComponent).join("/")}`,
            bytes: pin.client_bytes,
            sha256: pin.client_sha256,
        },
        server: {
            fileName: pin.server_file_name,
            key: pin.server_key,
            publicUrl: pin.server_public_url,
            bytes: pin.server_bytes,
            sha256: pin.server_sha256,
        },
    });
}

export async function serveCreateBuildPinPage(url: URL, env: Env): Promise<Response> {
    const pin = await loadVisibleCreateBuildPin(url, env);
    if (typeof pin === "string") return html(errorPage(pin), 400);
    return html(page(
        "Install this build",
        "Create-build installer",
        `<h1>Install this <span>exact</span> build.</h1><p class="lede">This one-time Windows installer installs client <code>${escapeHtml(pin.client_sha.slice(0, 7))}</code> and dedicated server <code>${escapeHtml(pin.server_sha.slice(0, 7))}</code>. It works once and expires after 24 hours. Discord sign-in is not required.</p><div class="actions"><a class="button" href="/v1/pins/install.cmd?pin=${encodeURIComponent(pin.token)}" download="BannerlordCoop-Create-Build-Installer.cmd">Download Windows installer <span aria-hidden="true">&darr;</span></a></div><p class="fine-print">Do not share this link. Anyone who opens the installer consumes it.</p>`,
        "landing-page",
    ));
}

export async function serveCreateBuildPinLauncher(url: URL, env: Env): Promise<Response> {
    const pin = await loadVisibleCreateBuildPin(url, env);
    if (typeof pin === "string") return new Response(pin, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response(createBuildPinLauncher(pin.token), {
        status: 200,
        headers: {
            "content-type": "application/x-bat; charset=utf-8",
            "content-disposition": 'attachment; filename="BannerlordCoop-Create-Build-Installer.cmd"',
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
        },
    });
}

type VisibleCreateBuildPin = {
    token: string;
    client_sha: string;
    server_sha: string;
};

async function loadVisibleCreateBuildPin(url: URL, env: Env): Promise<string | VisibleCreateBuildPin> {
    const token = url.searchParams.get("pin");
    if (!isCreateBuildPinToken(token)) return "That create-build installer link is invalid.";
    const row = await env.DB.prepare(
        "SELECT client_sha, server_sha, expires_at, consumed_at FROM installer_pins WHERE token_hash = ?",
    ).bind(await sha256(token)).first<{
        client_sha: string;
        server_sha: string;
        expires_at: number;
        consumed_at: number | null;
    }>();
    if (row === null) return "That create-build installer link is invalid.";
    if (row.consumed_at !== null) return "That create-build installer link was already used.";
    if (row.expires_at < nowSeconds()) return "That create-build installer link has expired.";
    return { token, client_sha: row.client_sha, server_sha: row.server_sha };
}

function parseCreateBuildPinMetadata(value: CreateBuildPinMetadata, env: Env): CreateBuildPinMetadata {
    const expiresAtMs = Date.parse(value.expiresAt);
    const now = Date.now();
    if (
        !isDiscordSnowflake(value.buildId)
        || !isCreateBuildPinCommitSha(value.clientSha)
        || !isCreateBuildPinCommitSha(value.serverSha)
        || !Number.isFinite(expiresAtMs)
        || new Date(expiresAtMs).toISOString() !== value.expiresAt
        || expiresAtMs <= now
        || expiresAtMs > now + (CREATE_BUILD_PIN_LIFETIME_SECONDS * 1_000) + 60_000
        || value.client.fileName !== "Coop.7z"
        || !Number.isSafeInteger(value.client.bytes)
        || value.client.bytes <= 0
        || value.client.bytes > MAXIMUM_PIN_CLIENT_BYTES
        || !isSha256Hex(value.client.sha256)
        || !MANUAL_SERVER_FILE.test(value.server.fileName)
        || !isAllowedManualServerKey(value.server.key, value.buildId)
        || !value.server.key.endsWith(`/${value.server.fileName}`)
        || value.server.publicUrl !== `${env.LEGACY_R2_ORIGIN}/${value.server.key}`
        || env.LEGACY_R2_ORIGIN !== PUBLIC_MANUAL_SERVER_ORIGIN
        || !Number.isSafeInteger(value.server.bytes)
        || value.server.bytes <= 0
        || value.server.bytes > MAXIMUM_PIN_SERVER_BYTES
        || !isSha256Hex(value.server.sha256)
    ) {
        throw new GatewayError(400, "invalid_request");
    }
    return value;
}

async function requirePinMintSecret(request: Request, env: Env): Promise<void> {
    const expected = pinMintSecret(env);
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new GatewayError(401, "authorization_required");
    if (!await mintSecretsEqual(expected, authorization.slice(7))) {
        throw new GatewayError(401, "authorization_invalid");
    }
}

function pinMintSecret(env: Env): string {
    const value = env.PIN_MINT_SECRET;
    if (typeof value !== "string" || value.length < 32) throw new GatewayError(503, "pin_mint_unavailable");
    return value;
}

function createBuildPinLauncher(token: string): string {
    if (!isCreateBuildPinToken(token)) throw new GatewayError(400, "invalid_request");
    return [
        "@echo off",
        "setlocal",
        "title BannerlordCoop Create-Build Installer",
        "",
        "set \"POWERSHELL_EXE=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\"",
        "set \"CURL_EXE=%SystemRoot%\\System32\\curl.exe\"",
        "set \"BANNERLORDCOOP_INSTALLER_TEMP=%TEMP%\\BannerlordCoop-Create-Build-Installer-%RANDOM%-%RANDOM%.ps1\"",
        "set \"BANNERLORDCOOP_INSTALLER_LAUNCHER=1\"",
        `set "BANNERLORDCOOP_INSTALLER_PIN=${token}"`,
        "set \"INSTALLER_PRIMARY=https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/install.ps1\"",
        "set \"INSTALLER_MIRROR=https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop-website/main/installer/install.ps1\"",
        "",
        "echo BannerlordCoop Create-Build Installer",
        "echo Installs one staff-created client and dedicated-server pair. This link works once.",
        "echo.",
        "",
        "if not exist \"%POWERSHELL_EXE%\" (",
        "  echo Windows PowerShell could not be found.",
        "  echo Expected: %POWERSHELL_EXE%",
        "  goto :failed",
        ")",
        "",
        "echo Downloading the latest installer...",
        "call :download_installer \"%INSTALLER_PRIMARY%\" \"nightly gateway\"",
        "if not errorlevel 1 goto :download_complete",
        "",
        "echo The nightly gateway download failed. Trying the GitHub mirror...",
        "call :download_installer \"%INSTALLER_MIRROR%\" \"GitHub mirror\"",
        "if errorlevel 1 goto :download_failed",
        "",
        ":download_complete",
        "",
        "\"%POWERSHELL_EXE%\" -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"%BANNERLORDCOOP_INSTALLER_TEMP%\"",
        "set \"INSTALLER_EXIT=%ERRORLEVEL%\"",
        "del /q \"%BANNERLORDCOOP_INSTALLER_TEMP%\" >nul 2>&1",
        "",
        "echo.",
        "if not \"%INSTALLER_EXIT%\"==\"0\" (",
        "  echo The installer stopped with an error. The details are shown above.",
        "  goto :failed",
        ")",
        "",
        "exit /b 0",
        "",
        ":download_installer",
        "del /q \"%BANNERLORDCOOP_INSTALLER_TEMP%\" >nul 2>&1",
        "\"%POWERSHELL_EXE%\" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command \"try { $ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%~1' -OutFile $env:BANNERLORDCOOP_INSTALLER_TEMP; exit 0 } catch { exit 1 }\"",
        "if not errorlevel 1 call :validate_installer",
        "if not errorlevel 1 exit /b 0",
        "",
        "if not exist \"%CURL_EXE%\" exit /b 1",
        "echo PowerShell could not download from the %~2. Trying Windows curl...",
        "del /q \"%BANNERLORDCOOP_INSTALLER_TEMP%\" >nul 2>&1",
        "\"%CURL_EXE%\" --fail --location --silent --show-error --connect-timeout 15 --max-time 120 --retry 2 --retry-delay 1 --output \"%BANNERLORDCOOP_INSTALLER_TEMP%\" \"%~1\"",
        "if errorlevel 1 exit /b 1",
        "call :validate_installer",
        "exit /b %ERRORLEVEL%",
        "",
        ":validate_installer",
        "if not exist \"%BANNERLORDCOOP_INSTALLER_TEMP%\" exit /b 1",
        "for %%I in (\"%BANNERLORDCOOP_INSTALLER_TEMP%\") do if %%~zI LEQ 0 exit /b 1",
        "findstr /b /l /c:\"$ErrorActionPreference = 'Stop'\" \"%BANNERLORDCOOP_INSTALLER_TEMP%\" >nul 2>&1",
        "exit /b %ERRORLEVEL%",
        "",
        ":download_failed",
        "del /q \"%BANNERLORDCOOP_INSTALLER_TEMP%\" >nul 2>&1",
        "echo.",
        "echo The latest installer could not be downloaded from the nightly gateway or GitHub mirror.",
        "echo Check your firewall or proxy, then try again.",
        "",
        ":failed",
        "echo.",
        "pause",
        "exit /b 1",
        "",
    ].join("\r\n");
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function serveManifest(request: Request, env: Env, key: string): Promise<Response> {
    await requireNightlyDownloadSession(request, env);
    const object = await env.RELEASES.get(key);
    if (object === null || object.size > MAXIMUM_MANIFEST_BYTES) throw new GatewayError(404, "manifest_unavailable");
    const parsed = JSON.parse(await object.text()) as unknown;
    const rewritten = rewriteManifestArtifactUrls(parsed, env.PUBLIC_ORIGIN, env.LEGACY_R2_ORIGIN);
    return json(rewritten);
}

async function serveArtifact(request: Request, env: Env, encodedKey: string): Promise<Response> {
    const authorization = await authorizeDownload(request, env);
    let key: string;
    try {
        key = encodedKey.split("/").map(decodeURIComponent).join("/");
    } catch {
        throw new GatewayError(400, "invalid_artifact");
    }
    if (authorization.kind === "pin") {
        if (!isAllowedPinClientKey(key, authorization.buildId)) throw new GatewayError(400, "invalid_artifact");
    } else if (!isAllowedArtifactKey(key) || key.endsWith(".json")) {
        throw new GatewayError(400, "invalid_artifact");
    }
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

async function requireNightlyDownloadSession(request: Request, env: Env): Promise<void> {
    const authorization = await authorizeDownload(request, env);
    if (authorization.kind !== "nightly") throw new GatewayError(403, "access_denied");
}

async function requirePinDownloadSession(request: Request, env: Env): Promise<PinAuthorization> {
    const authorization = await authorizeDownload(request, env);
    if (authorization.kind !== "pin") throw new GatewayError(403, "access_denied");
    return authorization;
}

async function authorizeDownload(request: Request, env: Env): Promise<DownloadAuthorization> {
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

async function tryAssertSponsorEligible(env: Env, supporterId: string): Promise<boolean> {
    try {
        await assertSponsorEligible(env, supporterId);
        return true;
    } catch (error) {
        if (error instanceof GatewayError && error.code === "supporter_role_required") {
            return false;
        }
        throw error;
    }
}

async function assertSponsorEligible(env: Env, supporterId: string): Promise<void> {
    const member = await discordBotGetGuildMember(env, supporterId);
    if (member !== null && !Array.isArray(member.roles)) {
        throw new GatewayError(502, "discord_response_invalid");
    }
    if (isEligibleNightlySponsor(member)) return;
    await env.DB.batch([
        env.DB.prepare("DELETE FROM download_sessions WHERE supporter_discord_user_id = ?").bind(supporterId),
        env.DB.prepare("DELETE FROM supporter_grants WHERE supporter_discord_user_id = ?").bind(supporterId),
    ]);
    throw new GatewayError(403, "supporter_role_required");
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

async function discordBotGetGuildMember(env: Env, userId: string): Promise<DiscordMember | null> {
    const response = await fetch(`${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/members/${userId}`, {
        headers: {
            authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            "user-agent": "BannerlordCoop-Nightly-Gateway/1",
        },
    });
    const text = await boundedText(response, 64 * 1024);
    if (response.status === 404) return null;
    if (!response.ok) throw new GatewayError(502, "discord_membership_required");
    return JSON.parse(text) as DiscordMember;
}

async function encryptRefreshToken(env: Env, plaintext: string): Promise<{ ciphertext: string; nonce: string }> {
    const key = await encryptionKey(env);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(plaintext));
    return { ciphertext: base64url(new Uint8Array(ciphertext)), nonce: base64url(nonce) };
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
        || env.DISCORD_BOT_TOKEN.length < 50
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

function errorPage(message: string, extra = ""): string {
    return page("Access unavailable", "Nightly access", `<div class="status-icon error" aria-hidden="true"><span>!</span></div><h1>Access <span>unavailable.</span></h1><p class="lede">${escapeHtml(message)}</p>${extra}<div class="support-note"><strong>Need a hand?</strong><span><a href="https://discord.gg/bannerlordcoop">Ask in the Bannerlord Coop Discord</a> and include the message shown above.</span></div>`, "status-page");
}

function prefersHtmlError(request: Request): boolean {
    return (request.headers.get("accept") ?? "").includes("text/html");
}

function gatewayErrorMessage(code: string): string {
    if (code === "migration_in_progress") {
        return "Nightly access is briefly paused while account data is moved. Try again in a few minutes.";
    }
    if (code === "supporter_role_required") {
        return "That sponsor no longer has a qualifying Staff, Tester, Patreon, Boosty, or Afdian role.";
    }
    if (code === "already_used") {
        return "That create-build installer link was already used. Ask staff for a new /create-build link.";
    }
    if (code === "expired_token") {
        return "That create-build installer link has expired.";
    }
    if (code === "pin_incomplete") {
        return "That create-build installer is not ready yet. Ask staff to run /create-build again.";
    }
    if (code === "pin_identity_conflict") {
        return "That create-build installer no longer matches this build. Ask staff for a new /create-build link.";
    }
    if (code === "pin_mint_unavailable") {
        return "Create-build installer links are not configured on this gateway.";
    }
    return "Access could not be verified. Run the installer again or ask in the Bannerlord Coop Discord.";
}

function previousSponsorAccessRevokedHelp(): string {
    return `<div class="redeem-note"><div><strong>Previous sponsor access ended</strong><p>The friend who sponsored this Discord account no longer has a qualifying Staff, Tester, Patreon, Boosty, or Afdian role. Enter a new sponsor code below.</p></div></div>`;
}

function sponsorCodeHelp(): string {
    return `<div class="redeem-note"><div><strong>Have a sponsor code?</strong><p>Codes are redeemed through the installer. Run it, sign in with your own Discord account, then enter the code on the &ldquo;One more step&rdquo; page.</p></div><a class="button secondary" href="/install.cmd" download="BannerlordCoop-Nightly-Installer.cmd">Download installer <span aria-hidden="true">&darr;</span></a></div>`;
}

function sponsorClaimPage(deviceId: string, username: string, extra = ""): string {
    return page("Sponsor required", "Nightly installer", `<p class="account-chip"><span aria-hidden="true"></span>Signed in as <strong>${escapeHtml(username)}</strong></p><h1>One more step to <span>ride.</span></h1><p class="lede">This Discord account does not currently have a qualifying Staff, Tester, Patreon, Boosty, or Afdian role.</p>${extra}<div class="divider"><span>Have a sponsor?</span></div><form class="claim-form" method="post" action="/v1/sponsorship/claim"><input type="hidden" name="device_id" value="${escapeHtml(deviceId)}"><label for="sponsor-code">Enter your friend&rsquo;s sponsor code</label><div class="field-row"><input id="sponsor-code" name="sponsor_code" required maxlength="128" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX" aria-describedby="sponsor-help"><button class="button">Claim a seat <span aria-hidden="true">&rarr;</span></button></div><p id="sponsor-help" class="field-help">Your friend must have a qualifying Staff, Tester, Patreon, Boosty, or Afdian role and an open seat. Access is checked again on every install and update.</p></form><div class="support-note"><strong>Already eligible?</strong><span>Make sure the correct Discord account has a qualifying Staff or Tester role or is connected to your Patreon, Boosty, or Afdian membership, then restart the installer.</span></div>`, "claim-page");
}

export function nightlyAccessPage(): string {
    return page("Nightly Access", "Staff, Supporter & Tester builds", `<h1>Test tomorrow&rsquo;s battles <span>today.</span></h1><p class="lede">Install or update the Bannerlord Coop client, Windows dedicated server, or both. Nightly builds are available to Staff, Testers, and Patreon, Boosty, and Afdian supporters, plus their sponsored friends.</p><div class="access-grid"><div><span class="step-number">01</span><strong>Download and run</strong><p>Save the Windows or Linux installer launcher, then run it. The window stays open so you can see every prompt or error.</p></div><div><span class="step-number">02</span><strong>Choose and verify</strong><p>Select the client, dedicated server, or both. Discord access is checked at install and update time.</p></div></div><div class="actions"><a class="button" href="/install.cmd" download="BannerlordCoop-Nightly-Installer.cmd">Download Windows installer <span aria-hidden="true">&darr;</span></a><a class="button" href="/install.sh" download="BannerlordCoop-Nightly-Installer.sh">Download Linux installer <span aria-hidden="true">&darr;</span></a><a class="button secondary" href="/sponsor">Manage sponsored accounts</a><a class="quiet-link" href="https://discord.gg/bannerlordcoop">Join the Discord</a></div>`, "landing-page");
}

const GATEWAY_CSS = `
:root{--background:#070806;--surface:#0c0d0b;--surface-raised:#11120f;--foreground:#e8e4da;--muted:#96938b;--dim:#67665f;--crimson:#8f1d23;--crimson-hover:#a4232a;--gold:#aa9760;--border:rgba(232,228,218,.12);--border-gold:rgba(170,151,96,.25)}
*{box-sizing:border-box}html{min-height:100%;background:var(--background)}body{min-height:100vh;margin:0;color:var(--foreground);background:var(--background);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;overflow-x:hidden}::selection{background:var(--crimson);color:#fff}.backdrop{position:fixed;inset:0;z-index:0;background-image:linear-gradient(90deg,rgba(7,8,6,.98) 0%,rgba(7,8,6,.91) 42%,rgba(7,8,6,.55) 100%),linear-gradient(0deg,#070806 0%,transparent 44%,rgba(7,8,6,.5) 100%),radial-gradient(circle at 23% 55%,rgba(143,29,35,.22),transparent 35%),var(--hero);background-size:cover;background-position:62% center}.backdrop:after{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px);background-size:100% 4px;opacity:.45;mask-image:linear-gradient(to bottom,transparent,#000 20%,#000 80%,transparent)}
.site-header{position:relative;z-index:2;width:min(calc(100% - 3rem),1280px);height:76px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(232,228,218,.1)}.brand{display:flex;align-items:center;gap:12px;color:var(--foreground);text-decoration:none;font-family:Georgia,"Times New Roman",serif;font-size:17px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}.brand-mark{position:relative;width:25px;height:25px;display:inline-block}.brand-mark i,.brand-mark b{position:absolute;left:11px;top:1px;width:3px;height:24px;background:var(--gold);transform:rotate(45deg);transform-origin:center}.brand-mark b{transform:rotate(-45deg)}.brand-mark i:after,.brand-mark b:after{content:"";position:absolute;width:9px;height:2px;background:var(--gold);left:-3px;top:16px}.product-label{font-size:11px;font-weight:650;letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
.shell{position:relative;z-index:1;width:min(calc(100% - 3rem),1280px);margin:auto;display:grid;grid-template-columns:repeat(12,1fr);padding:64px 0}.card{position:relative;grid-column:2/span 7;max-width:760px;padding:48px 52px 50px;background:linear-gradient(145deg,rgba(17,18,15,.96),rgba(10,11,9,.92));border:1px solid var(--border);box-shadow:0 28px 90px rgba(0,0,0,.38)}.card:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 0 0,rgba(170,151,96,.1),transparent 42%)}.card-accent{position:absolute;top:-1px;left:52px;width:80px;height:2px;background:var(--gold);box-shadow:0 0 18px rgba(170,151,96,.35)}.card>*:not(.card-accent){position:relative}.eyebrow{margin:0 0 17px;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:var(--gold)}h1{max-width:680px;margin:0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(43px,5vw,70px);font-weight:500;line-height:.92;letter-spacing:-.035em;text-wrap:balance}h1 span{color:var(--crimson)}.lede{max-width:650px;margin:25px 0 0;color:var(--muted);font-size:16px;line-height:1.75;text-wrap:pretty}.actions{display:flex;align-items:center;flex-wrap:wrap;gap:22px;margin-top:32px}.button,button.button{min-height:50px;display:inline-flex;align-items:center;justify-content:center;gap:16px;padding:14px 22px;border:1px solid var(--crimson);border-radius:2px;background:var(--crimson);color:#fff;text-decoration:none;font:700 12px/1.2 Inter,ui-sans-serif,system-ui,sans-serif;letter-spacing:.13em;text-transform:uppercase;cursor:pointer;transition:background .2s,border-color .2s,color .2s}.button:hover,button.button:hover{background:var(--crimson-hover);border-color:var(--crimson-hover)}.button:focus-visible,button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:3px}.button.secondary{background:transparent;border-color:rgba(232,228,218,.2);color:var(--foreground)}.button.secondary:hover{border-color:var(--gold);color:var(--gold);background:rgba(170,151,96,.06)}.quiet-link{color:var(--muted);font-size:12px;font-weight:650;letter-spacing:.12em;text-transform:uppercase;text-underline-offset:5px}.quiet-link:hover{color:var(--gold)}.fine-print{max-width:560px;margin:28px 0 0;padding-top:20px;border-top:1px solid var(--border);color:var(--dim);font-size:12px;line-height:1.65}
.account-chip{display:inline-flex;align-items:center;gap:7px;margin:0 0 24px;padding:7px 10px 7px 8px;background:rgba(232,228,218,.055);border:1px solid var(--border);color:var(--muted);font-size:12px}.account-chip>span{width:7px;height:7px;background:#5f9565;border-radius:50%;box-shadow:0 0 9px rgba(95,149,101,.55)}.account-chip strong{color:var(--foreground);font-weight:650}.divider{display:flex;align-items:center;gap:14px;margin:30px 0 20px;color:var(--gold);font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase}.divider:after{content:"";height:1px;flex:1;background:var(--border-gold)}.claim-form{margin:0}.claim-form label{display:block;margin-bottom:9px;color:var(--foreground);font:650 12px/1.4 Inter,ui-sans-serif,system-ui,sans-serif}.field-row{display:flex;gap:10px}.field-row input{min-width:0;flex:1;height:50px;padding:0 16px;border:1px solid rgba(232,228,218,.18);border-radius:2px;background:rgba(3,4,3,.72);color:var(--foreground);font:600 16px/1 ui-monospace,"SFMono-Regular",Consolas,monospace;letter-spacing:.08em;text-transform:uppercase}.field-row input::placeholder{color:#585a54}.field-row input:hover{border-color:rgba(170,151,96,.42)}.field-help{margin:10px 0 0;color:var(--dim);font-size:11px;line-height:1.6}.support-note{display:grid;grid-template-columns:minmax(130px,.55fr) 1fr;gap:20px;margin-top:30px;padding:19px 20px;border-left:2px solid var(--gold);background:rgba(170,151,96,.055);font-size:12px;line-height:1.55}.support-note strong{color:var(--gold);font-size:10px;letter-spacing:.12em;text-transform:uppercase}.support-note span{color:var(--muted)}.support-note a{color:var(--foreground);text-underline-offset:3px}.support-note a:hover{color:var(--gold)}
.status-page .card{grid-column:3/span 6;max-width:680px}.status-icon{width:46px;height:46px;margin:0 0 25px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border-gold);color:var(--gold);font:500 24px/1 Georgia,serif;transform:rotate(45deg)}.status-icon>span{transform:rotate(-45deg)}.status-icon.success{border-color:rgba(95,149,101,.55);color:#88b28b}.status-icon.error{border-color:rgba(143,29,35,.65);color:#cf555c}.code-block{margin-top:28px;padding:20px 22px;border:1px solid var(--border-gold);background:rgba(3,4,3,.7)}.code-block>span{color:var(--gold);font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}.code{margin:9px 0 0;color:var(--foreground);font:600 clamp(20px,4vw,30px)/1.2 ui-monospace,"SFMono-Regular",Consolas,monospace;letter-spacing:.1em}.status-page .code-block+.actions+.fine-print{display:none}
.redeem-note{display:flex;align-items:center;justify-content:space-between;gap:22px;margin-top:30px;padding:20px;border:1px solid var(--border-gold);background:rgba(170,151,96,.055)}.redeem-note>div{min-width:0}.redeem-note strong{display:block;color:var(--gold);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.redeem-note p{max-width:380px;margin:8px 0 0;color:var(--muted);font-size:12px;line-height:1.6}.redeem-note a{color:var(--foreground);text-underline-offset:3px}.redeem-note a:hover{color:var(--gold)}.redeem-note .button{min-height:44px;flex:0 0 auto;padding:12px 16px;font-size:10px;letter-spacing:.1em}
.access-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;margin-top:32px;background:var(--border)}.access-grid>div{padding:20px;background:rgba(7,8,6,.88)}.step-number{display:block;margin-bottom:12px;color:var(--crimson);font:700 11px/1 Inter,sans-serif;letter-spacing:.15em}.access-grid strong{font-family:Georgia,"Times New Roman",serif;font-size:18px;font-weight:600}.access-grid p{margin:7px 0 0;color:var(--muted);font-size:12px;line-height:1.55}
.portal-wide .card{grid-column:2/span 10;max-width:none}.portal-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:42px}.portal-heading .lede{max-width:630px}.seat-count{flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:12px 15px;border:1px solid var(--border-gold);background:rgba(170,151,96,.04)}.seat-count strong{color:var(--gold);font:500 32px/1 Georgia,serif}.seat-count span{color:var(--dim);font-size:9px;line-height:1.4;letter-spacing:.12em;text-transform:uppercase}.code-action{display:flex;align-items:center;gap:20px;margin-top:32px}.code-action p{max-width:420px;margin:0;color:var(--dim);font-size:11px;line-height:1.55}.seat-section{margin-top:38px}.section-heading{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--border-gold)}.section-heading h2{margin:0;font:600 12px/1.4 Inter,sans-serif;letter-spacing:.17em;text-transform:uppercase}.section-heading>span{color:var(--gold);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.seat-list{margin:0;padding:0;list-style:none}.seat{display:grid;grid-template-columns:48px 1fr auto;align-items:center;gap:14px;min-height:70px;border-bottom:1px solid var(--border)}.seat-number{color:var(--dim);font:500 12px/1 ui-monospace,monospace}.seat-account{display:flex;flex-direction:column;gap:4px}.seat-label{color:var(--dim);font-size:9px;letter-spacing:.13em;text-transform:uppercase}.seat code{color:var(--foreground);font:500 13px/1.4 ui-monospace,monospace}.seat form{margin:0}.text-button{padding:8px 0;border:0;background:transparent;color:var(--muted);font:650 10px/1 Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}.text-button:hover{color:#cf555c}.empty-state{display:flex;flex-direction:column;gap:7px;padding:26px 0;color:var(--foreground);font:600 14px/1.4 Georgia,serif}.empty-state span{color:var(--dim);font:400 12px/1.5 Inter,sans-serif}
footer{position:relative;z-index:2;width:min(calc(100% - 3rem),1280px);min-height:54px;margin:0 auto;display:flex;align-items:center;gap:13px;color:var(--dim);font-size:9px;font-weight:650;letter-spacing:.17em;text-transform:uppercase}footer>span:first-child{color:var(--muted)}.footer-rule{width:28px;height:1px;background:var(--crimson)}
@media(max-width:900px){.shell{display:block;width:min(calc(100% - 2rem),720px);padding:42px 0}.card,.status-page .card,.portal-wide .card{max-width:none;padding:39px 34px}.site-header,footer{width:calc(100% - 2rem)}.portal-heading{align-items:flex-start}.backdrop{background-position:68% center}}
@media(max-width:600px){.site-header{height:66px}.brand{font-size:13px;letter-spacing:.08em}.brand-mark{transform:scale(.82)}.product-label{display:none}.shell{padding:24px 0}.card,.status-page .card,.portal-wide .card{padding:31px 22px 30px}.card-accent{left:22px;width:58px}h1{font-size:39px}.lede{font-size:14px;line-height:1.65}.field-row{display:block}.field-row .button{width:100%;margin-top:10px}.support-note{grid-template-columns:1fr;gap:7px}.redeem-note{display:block}.redeem-note .button{width:100%;margin-top:16px}.access-grid{grid-template-columns:minmax(0,1fr)}.portal-heading{display:block}.seat-count{display:inline-flex;margin-top:24px}.code-action{display:block}.code-action .button{width:100%}.code-action p{margin-top:12px}.seat{grid-template-columns:32px minmax(0,1fr);gap:9px;padding:12px 0}.seat form{grid-column:2}.seat code{overflow-wrap:anywhere}.text-button{padding:0 0 5px}.actions{align-items:stretch;flex-direction:column}.actions .button,.code-action .button{width:100%;max-width:100%;padding-inline:14px;text-align:center;font-size:10px;letter-spacing:.08em;white-space:normal}.quiet-link{text-align:center}.backdrop{opacity:.72;background-position:72% center}footer{justify-content:center}.footer-rule,footer span:last-child{display:none}.status-icon{transform:none}.status-icon>span{transform:none}}
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
