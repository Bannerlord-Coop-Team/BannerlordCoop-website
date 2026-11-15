import { isDiscordSnowflake, isSha256Hex } from "./core";
import { PUBLIC_MANUAL_SERVER_ORIGIN, resolveGatewayOrigin } from "./origins";
import {
    CREATE_BUILD_PIN_KIND,
    CREATE_BUILD_PIN_LIFETIME_SECONDS,
    DOWNLOAD_SESSION_SECONDS,
    createBuildPinInstallUrl,
    createBuildPinToken,
    isAllowedManualServerKey,
    isCreateBuildPinCommitSha,
    mintSecretsEqual,
    pinClientObjectKey,
} from "./pin-rules";
import { requirePinDownloadSession } from "./downloads";
import { GatewayError, json, readForm } from "./http";
import { errorPage, escapeHtml, html, page } from "./pages";
import { isBearerToken, nowSeconds, randomToken, sha256, sha256Bytes } from "./primitives";

// Mints, redeems, and serves create-build pins: one-time install links for a staff-built client/server pair.

const MAXIMUM_PIN_SERVER_BYTES = 6 * 1024 * 1024 * 1024;
const MANUAL_SERVER_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$/;

/** What staff declare when minting a create-build pin: the build identity and both archives. */
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

/** One installer_pins row as the pin manifest reads it. */
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

// Consumes a one-time pin and opens a short download session bound to its build.
export async function redeemCreateBuildPin(request: Request, env: Env): Promise<Response> {
    const body = await readForm(request);
    const pin = body.get("pin");
    if (!isBearerToken(pin)) throw new GatewayError(400, "invalid_request");
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

// Shows the install page for a still-valid create-build pin, or the error page when it is not.
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

/** The pin fields the install page and launcher show. */
type VisibleCreateBuildPin = {
    token: string;
    client_sha: string;
    server_sha: string;
};

// Looks up an unused, unexpired pin from the query string, or returns the user-facing reason it cannot be shown.
async function loadVisibleCreateBuildPin(url: URL, env: Env): Promise<string | VisibleCreateBuildPin> {
    const token = url.searchParams.get("pin");
    if (!isBearerToken(token)) return "That create-build installer link is invalid.";
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

// Validates minted pin metadata against the fixed R2 origin, lifetime, and key rules, or throws 400.
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

// Requires the staff bearer secret before a pin can be minted.
async function requirePinMintSecret(request: Request, env: Env): Promise<void> {
    const expected = pinMintSecret(env);
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new GatewayError(401, "authorization_required");
    if (!await mintSecretsEqual(expected, authorization.slice(7))) {
        throw new GatewayError(401, "authorization_invalid");
    }
}

// Reads the configured mint secret, failing with 503 when it is missing or too short.
function pinMintSecret(env: Env): string {
    const value = env.PIN_MINT_SECRET;
    if (typeof value !== "string" || value.length < 32) throw new GatewayError(503, "pin_mint_unavailable");
    return value;
}

// Writes the one-time Windows launcher that fetches the latest install.ps1 from the gateway host the user opened.
// The GitHub raw copy stays as the fallback when that host is unreachable.
function createBuildPinLauncher(token: string, origin: string): string {
    if (!isBearerToken(token)) throw new GatewayError(400, "invalid_request");
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
