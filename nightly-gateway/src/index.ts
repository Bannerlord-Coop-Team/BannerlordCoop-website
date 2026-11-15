import {
    CREATE_BUILD_PIN_KIND,
    CREATE_BUILD_PIN_LIFETIME_SECONDS,
    DOWNLOAD_SESSION_SECONDS,
    GATEWAY_ORIGINS,
    createBuildPinInstallUrl,
    createBuildPinToken,
    isAllowedArtifactKey,
    isAllowedManualServerKey,
    isAllowedPinClientKey,
    isCreateBuildPinCommitSha,
    isCreateBuildPinToken,
    isDiscordSnowflake,
    isSha256Hex,
    mintSecretsEqual,
    pinClientObjectKey,
    resolveGatewayOrigin,
    rewriteManifestArtifactUrls,
    type JsonObject,
    validateLegacyNightlyClientManifest,
    validateLegacyNightlyReleaseManifest,
} from "./core";
import { databaseForRequest } from "./database";
import { FORWARDED_DEVICE_PATHS, deviceFunctionUrl, forwardDeviceRequest, type UpstreamFetch } from "./forwarding";
import { GatewayError, decodeUtf8, json, readBoundedBytes } from "./http";
import { NightlyPublicationReadError, readNightlyPublication } from "./publication";
import { websiteRedirectFor } from "./redirects";

const NIGHTLY_PUBLICATION_VERSION_HEADER = "x-bannerlord-coop-nightly-version";
const DEVICE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAXIMUM_PIN_SERVER_BYTES = 6 * 1024 * 1024 * 1024;
const MANUAL_SERVER_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$/;
const PUBLIC_MANUAL_SERVER_ORIGIN = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
const SITE_HERO_IMAGE = "https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop-website/07491ba62e3b038b16458402b4cc92dccf71b985/public/images/singleleader.png";

/** Outside services the gateway calls; injected so tests can stand in for the Edge Function. */
export type GatewayDependencies = { fetch: UpstreamFetch };

/** The Worker entry point: one fetch handler bound to its dependencies. */
export type GatewayHandler = {
    fetch(request: Request, env: Env, context?: ExecutionContext): Promise<Response>;
};

// Builds the Worker fetch handler around its outbound dependencies.
// Errors become stable JSON codes, or the HTML error page for browsers.
export function createGateway(dependencies: GatewayDependencies): GatewayHandler {
    return {
        async fetch(request: Request, env: Env): Promise<Response> {
            try {
                return await route(request, env, dependencies);
            } catch (error) {
                console.error(JSON.stringify({
                    event: "nightly_gateway_request_failed",
                    path: new URL(request.url).pathname,
                    error: error instanceof GatewayError ? error.code : "internal_error",
                }));
                if (!(error instanceof GatewayError)) return json({ error: "internal_error" }, 500);
                if (prefersHtmlError(request)) return html(errorPage(gatewayErrorMessage(error.code)), error.status);
                return json({ error: error.code }, error.status);
            }
        },
    };
}

export default createGateway({ fetch: (url, init) => fetch(url, init) }) satisfies ExportedHandler<Env>;

// Routes one request: maintenance lock first, then routes that need no database, then R2 and Postgres routes.
async function route(request: Request, env: Env, dependencies: GatewayDependencies): Promise<Response> {
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
    const stateless = routeWithoutDatabase(request, url, env, dependencies);
    if (stateless !== null) return stateless;
    const database = await databaseForRequest(env);
    return routeWithDatabase(request, url, { ...env, DB: database });
}

// Answers the website redirects and the device-API forwarding, which never touch Postgres or R2.
function routeWithoutDatabase(
    request: Request,
    url: URL,
    env: Env,
    dependencies: GatewayDependencies,
): Promise<Response> | null {
    const redirect = websiteRedirectFor(request.method, url);
    if (redirect !== null) return Promise.resolve(redirectResponse(redirect.location, redirect.status));
    if (request.method !== "POST" || !FORWARDED_DEVICE_PATHS.includes(url.pathname)) return null;
    return forwardDeviceRequest(request, {
        url: deviceFunctionUrl(env.NIGHTLY_FUNCTION_URL, url.pathname),
        origin: resolveGatewayOrigin(url),
    }, dependencies.fetch);
}

// Serves the pin, manifest, artifact, and health routes that read download state from Postgres.
async function routeWithDatabase(request: Request, url: URL, env: Env): Promise<Response> {
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
        return serveManifest(request, env, true);
    }
    if (request.method === "GET" && url.pathname === "/v1/manifests/release") {
        return serveManifest(request, env, false);
    }
    if (request.method === "GET" && url.pathname.startsWith("/v1/artifacts/")) {
        return serveArtifact(request, env, url.pathname.slice("/v1/artifacts/".length));
    }
    if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true });
    }
    throw new GatewayError(404, "not_found");
}

// Sends a browser to a moved page without caching the redirect body.
function redirectResponse(location: string, status: number): Response {
    return new Response(null, { status, headers: { location, "cache-control": "no-store" } });
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

// Stores one staff-built client archive behind a one-time pin and returns its install link on the caller's gateway host.
export async function mintCreateBuildPin(request: Request, env: Env): Promise<Response> {
    await requirePinMintSecret(request, env);
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
        const declared = Number(contentLength);
        if (!Number.isSafeInteger(declared) || declared <= 0) {
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
    if (clientFile.size !== parsed.client.bytes) {
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
        installUrl: createBuildPinInstallUrl(resolveGatewayOrigin(request.url), token),
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

// Describes the pinned client/server pair, pointing the client download at the gateway host the installer used.
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
            publicUrl: `${resolveGatewayOrigin(request.url)}/v1/artifacts/${clientKey.split("/").map(encodeURIComponent).join("/")}`,
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

// Serves the one-time .cmd launcher for a still-valid create-build pin.
export async function serveCreateBuildPinLauncher(url: URL, env: Env): Promise<Response> {
    const pin = await loadVisibleCreateBuildPin(url, env);
    if (typeof pin === "string") return new Response(pin, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response(createBuildPinLauncher(pin.token, resolveGatewayOrigin(url)), {
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

// Writes the one-time Windows launcher that fetches the latest install.ps1 from the gateway host the user opened.
// The GitHub raw copy stays as the fallback when that host is unreachable.
function createBuildPinLauncher(token: string, origin: string): string {
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
        `set "INSTALLER_PRIMARY=${origin}/install.ps1"`,
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

// Serves the authorized nightly manifest with every artifact URL rewritten onto the gateway host the installer used.
// Stored manifests may name either gateway host; both validate before the rewrite.
async function serveManifest(request: Request, env: Env, clientOnly: boolean): Promise<Response> {
    await requireNightlyDownloadSession(request, env);
    const origin = resolveGatewayOrigin(request.url);
    const wantsV2 = request.headers.get(NIGHTLY_PUBLICATION_VERSION_HEADER)?.trim() === "2";
    if (clientOnly && !wantsV2) {
        try {
            return json(rewriteManifestArtifactUrls(
                await readHeaderlessNightlyClientManifest(env),
                origin,
                env.LEGACY_R2_ORIGIN,
            ));
        } catch (error) {
            console.error(JSON.stringify({
                event: "nightly_headerless_client_read_failed",
                error_code: error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
                    ? error.message : "manifest_unavailable",
            }));
            throw new GatewayError(503, "manifest_unavailable");
        }
    }
    if (!wantsV2) {
        try {
            return json(rewriteManifestArtifactUrls(
                await readLegacyNightlyManifest(env, clientOnly),
                origin,
                env.LEGACY_R2_ORIGIN,
            ));
        } catch (error) {
            console.error(JSON.stringify({
                event: "nightly_legacy_default_read_failed",
                route: clientOnly ? "client" : "release",
                error_code: error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
                    ? error.message : "legacy_manifest_unavailable",
            }));
            throw new GatewayError(503, "manifest_unavailable");
        }
    }
    let validated;
    try {
        validated = await readNightlyPublication(
            (key) => env.RELEASES.get(key),
            fetch,
            env.PUBLIC_RELEASES === undefined ? undefined : () => env.PUBLIC_RELEASES.get("nightly/release.json"),
        );
    } catch (error) {
        const errorCode = error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
            ? error.message : "publication_read_failed";
        const publicationError = error instanceof NightlyPublicationReadError ? error : null;
        console.error(JSON.stringify({
            event: "nightly_publication_read_failed",
            route: clientOnly ? "client" : "release",
            error_code: errorCode,
            stage: publicationError?.stage ?? "unknown",
            r2_status: publicationError?.status ?? null,
            exception_class: publicationError?.exceptionClass
                ?? (error instanceof Error && error.name.length > 0 ? error.name : "Error"),
            fallback: clientOnly,
        }));
        try {
            if (clientOnly) {
                const release = validateLegacyNightlyReleaseManifest(
                    await readLegacyJson(env, "nightly/release.json", 128 * 1024),
                    env.LEGACY_R2_ORIGIN,
                    GATEWAY_ORIGINS,
                );
                validated = projectLegacyReleaseClient(
                    release,
                    await tryReadLegacyNightlyClientManifest(env),
                    env.LEGACY_R2_ORIGIN,
                    GATEWAY_ORIGINS,
                );
            } else {
                validated = await readLegacyNightlyManifest(env, false);
            }
            if (clientOnly) {
                console.error(JSON.stringify({
                    event: "nightly_legacy_client_fallback_served",
                    route: "client",
                    head_sha: (validated.headSha as string).slice(0, 12),
                }));
            } else {
                console.error(JSON.stringify({
                    event: "nightly_legacy_release_fallback_served",
                    route: "release",
                    head_sha: (validated.headSha as string).slice(0, 12),
                }));
            }
        } catch (fallbackError) {
            console.error(JSON.stringify({
                event: clientOnly ? "nightly_legacy_client_fallback_failed" : "nightly_legacy_release_fallback_failed",
                error_code: fallbackError instanceof Error && /^[a-z0-9_]{1,64}$/.test(fallbackError.message)
                    ? fallbackError.message : clientOnly ? "legacy_client_unavailable" : "legacy_release_unavailable",
            }));
            throw new GatewayError(503, "manifest_unavailable");
        }
    }
    const rewritten = rewriteManifestArtifactUrls(validated, origin, env.LEGACY_R2_ORIGIN);
    return json(rewritten);
}

async function readHeaderlessNightlyClientManifest(env: Env): Promise<JsonObject> {
    let publication: JsonObject | null = null;
    try {
        publication = await readNightlyPublication(
            (key) => env.RELEASES.get(key),
            fetch,
            env.PUBLIC_RELEASES === undefined ? undefined : () => env.PUBLIC_RELEASES.get("nightly/release.json"),
        );
    } catch {
        // Fall through to the previous complete legacy pair below.
    }

    if (publication !== null) {
        const legacy = await tryReadLegacyNightlyClientManifest(env);
        if (legacy !== null && legacyClientMatchesPublication(legacy, publication)) return legacy;
        return projectPublicationClientAsLegacy(publication, env.LEGACY_R2_ORIGIN, GATEWAY_ORIGINS);
    }

    const legacyRelease = validateLegacyNightlyReleaseManifest(
        await readLegacyJson(env, "nightly/release.json", 128 * 1024),
        env.LEGACY_R2_ORIGIN,
        GATEWAY_ORIGINS,
    );
    return projectLegacyReleaseClient(
        legacyRelease,
        await tryReadLegacyNightlyClientManifest(env),
        env.LEGACY_R2_ORIGIN,
        GATEWAY_ORIGINS,
    );
}

async function tryReadLegacyNightlyClientManifest(env: Env): Promise<JsonObject | null> {
    try {
        return await readLegacyNightlyClientManifest(env);
    } catch {
        return null;
    }
}

function legacyClientMatchesPublication(legacy: JsonObject, publication: JsonObject): boolean {
    const legacyClient = legacy.client as Record<string, unknown>;
    const publicationClient = publication.client as Record<string, unknown>;
    return legacy.releaseDate === publication.releaseDate
        && legacy.headSha === publication.headSha
        && legacyClient.key === publicationClient.key
        && legacyClient.sha256 === publicationClient.sha256;
}

// Projects a v2 publication's client into the bounded v1 client manifest shape.
function projectPublicationClientAsLegacy(
    publication: JsonObject,
    legacyOrigin: string,
    gatewayOrigins: readonly string[],
): JsonObject {
    return validateLegacyNightlyClientManifest({
        version: 1,
        releaseDate: publication.releaseDate,
        headSha: publication.headSha,
        baseSha: null,
        workflowRunId: Number(publication.clientRunId),
        builtAt: publication.builtAt,
        client: publication.client,
    }, legacyOrigin, gatewayOrigins);
}

// Projects a legacy v1 release pair's client into the v1 client manifest shape.
function projectLegacyReleaseClient(
    release: JsonObject,
    metadata: JsonObject | null,
    legacyOrigin: string,
    gatewayOrigins: readonly string[],
): JsonObject {
    return validateLegacyNightlyClientManifest({
        version: 1,
        releaseDate: release.releaseDate,
        headSha: release.headSha,
        baseSha: null,
        ...(metadata?.headSha === release.headSha ? { workflowRunId: metadata.workflowRunId } : {}),
        builtAt: metadata?.headSha === release.headSha ? metadata.builtAt : release.builtAt,
        client: release.client,
    }, legacyOrigin, gatewayOrigins);
}

async function readLegacyNightlyClientManifest(env: Env): Promise<JsonObject> {
    return validateLegacyNightlyClientManifest(
        await readLegacyJson(env, "nightly/client.json", 32 * 1024),
        env.LEGACY_R2_ORIGIN,
        GATEWAY_ORIGINS,
    );
}

async function readLegacyNightlyManifest(env: Env, clientOnly: boolean): Promise<JsonObject> {
    if (clientOnly) {
        return readLegacyNightlyClientManifest(env);
    }
    const legacyRelease = validateLegacyNightlyReleaseManifest(
        await readLegacyJson(env, "nightly/release.json", 128 * 1024),
        env.LEGACY_R2_ORIGIN,
        GATEWAY_ORIGINS,
    );
    const legacyClient = validateLegacyNightlyClientManifest(
        await readLegacyJson(env, "nightly/client.json", 32 * 1024),
        env.LEGACY_R2_ORIGIN,
        GATEWAY_ORIGINS,
    );
    const releaseClient = legacyRelease.client as Record<string, unknown>;
    const client = legacyClient.client as Record<string, unknown>;
    if (legacyRelease.releaseDate !== legacyClient.releaseDate
        || legacyRelease.headSha !== legacyClient.headSha
        || releaseClient.key !== client.key
        || releaseClient.sha256 !== client.sha256) {
        throw new Error("legacy_release_client_mismatch");
    }
    return legacyRelease;
}

async function readLegacyJson(env: Env, key: string, maximumBytes: number): Promise<Record<string, unknown>> {
    const object = await env.RELEASES.get(key);
    if (object === null || object.size > maximumBytes) throw new Error("legacy_manifest_unavailable");
    const bytes = await object.arrayBuffer();
    return JSON.parse(decodeUtf8(bytes)) as Record<string, unknown>;
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

// Reads a small urlencoded form body, refusing anything over 4 KiB.
async function readForm(request: Request): Promise<URLSearchParams> {
    const bytes = await readBoundedBytes(request, 4096);
    if (bytes === null) throw new GatewayError(413, "request_too_large");
    return new URLSearchParams(decodeUtf8(bytes));
}

// Rejects a deploy whose fixed R2 origin was changed; the gateway origin now comes from each request.
function assertConfiguration(env: Env): void {
    if (env.LEGACY_R2_ORIGIN !== PUBLIC_MANUAL_SERVER_ORIGIN) {
        throw new Error("gateway_configuration_invalid");
    }
}

function html(body: string, status = 200): Response {
    return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "content-security-policy": `default-src 'none'; img-src ${SITE_HERO_IMAGE}; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` } });
}

export function page(title: string, eyebrow: string, content: string, pageClass = ""): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#070806"><title>${escapeHtml(title)} | Bannerlord Co-op</title><style>${GATEWAY_CSS}</style></head><body><div class="backdrop" style="--hero:url('${SITE_HERO_IMAGE}')" aria-hidden="true"></div><header class="site-header"><a class="brand" href="/" aria-label="Bannerlord Co-op Nightly Access home"><span class="brand-mark" aria-hidden="true"><i></i><b></b></span><span>Bannerlord Co-op</span></a><span class="product-label">Nightly Access</span></header><main class="shell ${escapeHtml(pageClass)}"><section class="card"><div class="card-accent" aria-hidden="true"></div><p class="eyebrow">${escapeHtml(eyebrow)}</p>${content}</section></main><footer><span>Bannerlord Co-op</span><span class="footer-rule"></span><span>Private nightly gateway</span></footer></body></html>`;
}

function errorPage(message: string): string {
    return page("Access unavailable", "Nightly access", `<div class="status-icon error" aria-hidden="true"><span>!</span></div><h1>Access <span>unavailable.</span></h1><p class="lede">${escapeHtml(message)}</p><div class="support-note"><strong>Need a hand?</strong><span><a href="https://discord.gg/bannerlordcoop">Ask in the Bannerlord Co-op Discord</a> and include the message shown above.</span></div>`, "status-page");
}

function prefersHtmlError(request: Request): boolean {
    return (request.headers.get("accept") ?? "").includes("text/html");
}

function gatewayErrorMessage(code: string): string {
    if (code === "migration_in_progress") {
        return "Nightly access is briefly paused while account data is moved. Try again in a few minutes.";
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
    return "Access could not be verified. Run the installer again or ask in the Bannerlord Co-op Discord.";
}

const GATEWAY_CSS = `
:root{--background:#070806;--foreground:#e8e4da;--muted:#96938b;--dim:#67665f;--crimson:#8f1d23;--crimson-hover:#a4232a;--gold:#aa9760;--border:rgba(232,228,218,.12);--border-gold:rgba(170,151,96,.25)}
*{box-sizing:border-box}html{min-height:100%;background:var(--background)}body{min-height:100vh;margin:0;color:var(--foreground);background:var(--background);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;overflow-x:hidden}::selection{background:var(--crimson);color:#fff}.backdrop{position:fixed;inset:0;z-index:0;background-image:linear-gradient(90deg,rgba(7,8,6,.98) 0%,rgba(7,8,6,.91) 42%,rgba(7,8,6,.55) 100%),linear-gradient(0deg,#070806 0%,transparent 44%,rgba(7,8,6,.5) 100%),radial-gradient(circle at 23% 55%,rgba(143,29,35,.22),transparent 35%),var(--hero);background-size:cover;background-position:62% center}.backdrop:after{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px);background-size:100% 4px;opacity:.45;mask-image:linear-gradient(to bottom,transparent,#000 20%,#000 80%,transparent)}
.site-header{position:relative;z-index:2;width:min(calc(100% - 3rem),1280px);height:76px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(232,228,218,.1)}.brand{display:flex;align-items:center;gap:12px;color:var(--foreground);text-decoration:none;font-family:Georgia,"Times New Roman",serif;font-size:17px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}.brand-mark{position:relative;width:25px;height:25px;display:inline-block}.brand-mark i,.brand-mark b{position:absolute;left:11px;top:1px;width:3px;height:24px;background:var(--gold);transform:rotate(45deg);transform-origin:center}.brand-mark b{transform:rotate(-45deg)}.brand-mark i:after,.brand-mark b:after{content:"";position:absolute;width:9px;height:2px;background:var(--gold);left:-3px;top:16px}.product-label{font-size:11px;font-weight:650;letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
.shell{position:relative;z-index:1;width:min(calc(100% - 3rem),1280px);margin:auto;display:grid;grid-template-columns:repeat(12,1fr);padding:64px 0}.card{position:relative;grid-column:2/span 7;max-width:760px;padding:48px 52px 50px;background:linear-gradient(145deg,rgba(17,18,15,.96),rgba(10,11,9,.92));border:1px solid var(--border);box-shadow:0 28px 90px rgba(0,0,0,.38)}.card:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 0 0,rgba(170,151,96,.1),transparent 42%)}.card-accent{position:absolute;top:-1px;left:52px;width:80px;height:2px;background:var(--gold);box-shadow:0 0 18px rgba(170,151,96,.35)}.card>*:not(.card-accent){position:relative}.eyebrow{margin:0 0 17px;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:var(--gold)}h1{max-width:680px;margin:0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(43px,5vw,70px);font-weight:500;line-height:.92;letter-spacing:-.035em;text-wrap:balance}h1 span{color:var(--crimson)}.lede{max-width:650px;margin:25px 0 0;color:var(--muted);font-size:16px;line-height:1.75;text-wrap:pretty}.actions{display:flex;align-items:center;flex-wrap:wrap;gap:22px;margin-top:32px}.button{min-height:50px;display:inline-flex;align-items:center;justify-content:center;gap:16px;padding:14px 22px;border:1px solid var(--crimson);border-radius:2px;background:var(--crimson);color:#fff;text-decoration:none;font:700 12px/1.2 Inter,ui-sans-serif,system-ui,sans-serif;letter-spacing:.13em;text-transform:uppercase;cursor:pointer;transition:background .2s,border-color .2s,color .2s}.button:hover{background:var(--crimson-hover);border-color:var(--crimson-hover)}.button:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:3px}.fine-print{max-width:560px;margin:28px 0 0;padding-top:20px;border-top:1px solid var(--border);color:var(--dim);font-size:12px;line-height:1.65}
.support-note{display:grid;grid-template-columns:minmax(130px,.55fr) 1fr;gap:20px;margin-top:30px;padding:19px 20px;border-left:2px solid var(--gold);background:rgba(170,151,96,.055);font-size:12px;line-height:1.55}.support-note strong{color:var(--gold);font-size:10px;letter-spacing:.12em;text-transform:uppercase}.support-note span{color:var(--muted)}.support-note a{color:var(--foreground);text-underline-offset:3px}.support-note a:hover{color:var(--gold)}
.status-page .card{grid-column:3/span 6;max-width:680px}.status-icon{width:46px;height:46px;margin:0 0 25px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border-gold);color:var(--gold);font:500 24px/1 Georgia,serif;transform:rotate(45deg)}.status-icon>span{transform:rotate(-45deg)}.status-icon.error{border-color:rgba(143,29,35,.65);color:#cf555c}
footer{position:relative;z-index:2;width:min(calc(100% - 3rem),1280px);min-height:54px;margin:0 auto;display:flex;align-items:center;gap:13px;color:var(--dim);font-size:9px;font-weight:650;letter-spacing:.17em;text-transform:uppercase}footer>span:first-child{color:var(--muted)}.footer-rule{width:28px;height:1px;background:var(--crimson)}
@media(max-width:900px){.shell{display:block;width:min(calc(100% - 2rem),720px);padding:42px 0}.card,.status-page .card{max-width:none;padding:39px 34px}.site-header,footer{width:calc(100% - 2rem)}.backdrop{background-position:68% center}}
@media(max-width:600px){.site-header{height:66px}.brand{font-size:13px;letter-spacing:.08em}.brand-mark{transform:scale(.82)}.product-label{display:none}.shell{padding:24px 0}.card,.status-page .card{padding:31px 22px 30px}.card-accent{left:22px;width:58px}h1{font-size:39px}.lede{font-size:14px;line-height:1.65}.support-note{grid-template-columns:1fr;gap:7px}.actions{align-items:stretch;flex-direction:column}.actions .button{width:100%;max-width:100%;padding-inline:14px;text-align:center;font-size:10px;letter-spacing:.08em;white-space:normal}.backdrop{opacity:.72;background-position:72% center}footer{justify-content:center}.footer-rule,footer span:last-child{display:none}.status-icon{transform:none}.status-icon>span{transform:none}}
@media(prefers-reduced-motion:no-preference){.card{animation:arrive .45s ease-out both}@keyframes arrive{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}}
`;

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function nowSeconds(): number { return Math.floor(Date.now() / 1000); }

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

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}
