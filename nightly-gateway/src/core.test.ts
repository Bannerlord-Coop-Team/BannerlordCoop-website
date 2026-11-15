import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    CANONICAL_GATEWAY_ORIGIN,
    GATEWAY_ORIGINS,
    LEGACY_GATEWAY_ORIGIN,
    artifactKeyFromUrl,
    createBuildPinInstallUrl,
    createBuildPinToken,
    isAllowedArtifactKey,
    isAllowedManualServerKey,
    isAllowedPinClientKey,
    mintSecretsEqual,
    pinClientObjectKey,
    resolveGatewayOrigin,
    rewriteManifestArtifactUrls,
    validateNightlyPublicationManifest,
} from "./core";
import { page } from "./index";

const legacy = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
const gateway = "https://nightly.bannerlordcoop.com";

test("artifact keys are limited to the two release namespaces", () => {
    assert.equal(isAllowedArtifactKey("nightly/Coop.7z"), true);
    assert.equal(isAllowedArtifactKey(`nightly/clients/${"a".repeat(40)}/${"b".repeat(64)}/Coop.7z`), true);
    assert.equal(isAllowedArtifactKey("release/123/client/a/Coop.7z"), true);
    assert.equal(isAllowedArtifactKey(`windows/base/v1/${"a".repeat(64)}/${"b".repeat(64)}/server-base.7z`), true);
    assert.equal(isAllowedArtifactKey("windows/other/file.7z"), false);
    assert.equal(isAllowedArtifactKey("managed-hosting/private/export"), false);
    assert.equal(isAllowedArtifactKey("nightly/../secret"), false);
    assert.equal(isAllowedArtifactKey("nightly//Coop.7z"), false);
    assert.equal(isAllowedArtifactKey("pins/1527333818711806084/Coop.7z"), false);
    assert.equal(isAllowedArtifactKey("manual/1527333818711806084/server.7z"), false);
});

test("create-build pin keys stay bound to one Discord interaction", () => {
    const buildId = "1527333818711806084";
    assert.equal(pinClientObjectKey(buildId), `pins/${buildId}/Coop.7z`);
    assert.equal(isAllowedPinClientKey(`pins/${buildId}/Coop.7z`, buildId), true);
    assert.equal(isAllowedPinClientKey(`pins/${buildId}/other.7z`, buildId), false);
    assert.equal(isAllowedPinClientKey("nightly/Coop.7z", buildId), false);
    assert.equal(isAllowedManualServerKey(`manual/${buildId}/BannerlordCoop-DedicatedServer-Win64.7z`, buildId), true);
    assert.equal(isAllowedManualServerKey(`manual/1527333818711806085/server.7z`, buildId), false);
    assert.equal(createBuildPinInstallUrl(gateway, "A".repeat(43)), `${gateway}/install?pin=${"A".repeat(43)}`);
});

test("create-build pin tokens are deterministic for one build identity", async () => {
    const secret = "pin-mint-secret-value-32-bytes-min";
    const buildId = "1527333818711806084";
    const clientSha256 = "a".repeat(64);
    const serverSha256 = "b".repeat(64);
    const token = await createBuildPinToken(secret, buildId, clientSha256, serverSha256);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(await createBuildPinToken(secret, buildId, clientSha256, serverSha256), token);
    assert.notEqual(await createBuildPinToken(secret, buildId, "c".repeat(64), serverSha256), token);
    assert.equal(await mintSecretsEqual(secret, secret), true);
    assert.equal(await mintSecretsEqual(secret, `x${secret.slice(1)}`), false);
});

test("legacy artifact URLs must use the exact fixed origin", () => {
    assert.equal(artifactKeyFromUrl(`${legacy}/nightly/Coop.7z`, legacy), "nightly/Coop.7z");
    assert.equal(artifactKeyFromUrl("https://attacker.invalid/nightly/Coop.7z", legacy), null);
    assert.equal(artifactKeyFromUrl(`${legacy}/nightly/Coop.7z?token=x`, legacy), null);
});

test("manifest URLs are rewritten to authenticated gateway paths", () => {
    const clientKey = `nightly/clients/${"a".repeat(40)}/${"b".repeat(64)}/Coop.7z`;
    const manifest = rewriteManifestArtifactUrls({
        version: 1,
        client: { key: clientKey, publicUrl: `${legacy}/${clientKey}` },
        server: {
            publicUrl: `${legacy}/nightly/windows/full/${"a".repeat(40)}/${"b".repeat(40)}/${"d".repeat(64)}/BannerlordCoop-DedicatedServer-Win64.7z`,
            incremental: {
                base: {
                    key: "nightly/windows/base/server-base.7z",
                    publicUrl: `${legacy}/nightly/windows/base/server-base.7z`,
                },
            },
        },
    }, gateway, legacy);
    assert.equal(manifest.client && typeof manifest.client === "object" && !Array.isArray(manifest.client)
        ? manifest.client.publicUrl
        : null, `${gateway}/v1/artifacts/${clientKey}`);
});

test("the gateway origin follows the allowlisted request host and falls back to the canonical host", () => {
    assert.equal(CANONICAL_GATEWAY_ORIGIN, "https://nightly.bannerlordcoop.com");
    assert.equal(LEGACY_GATEWAY_ORIGIN, "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev");
    assert.deepEqual(GATEWAY_ORIGINS, [CANONICAL_GATEWAY_ORIGIN, LEGACY_GATEWAY_ORIGIN]);
    assert.equal(resolveGatewayOrigin(`${CANONICAL_GATEWAY_ORIGIN}/v1/manifests/client`), CANONICAL_GATEWAY_ORIGIN);
    assert.equal(resolveGatewayOrigin(new URL(`${LEGACY_GATEWAY_ORIGIN}/v1/pins`)), LEGACY_GATEWAY_ORIGIN);
    assert.equal(resolveGatewayOrigin("https://attacker.invalid/v1/manifests/client"), CANONICAL_GATEWAY_ORIGIN);
    assert.equal(resolveGatewayOrigin("http://nightly.bannerlordcoop.com/health"), CANONICAL_GATEWAY_ORIGIN);
    assert.equal(resolveGatewayOrigin("https://nightly.bannerlordcoop.com:8443/health"), CANONICAL_GATEWAY_ORIGIN);
    assert.equal(resolveGatewayOrigin("https://preview.bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/"), CANONICAL_GATEWAY_ORIGIN);
});

test("manifest URLs are rewritten onto whichever gateway host the installer used", () => {
    const clientKey = `nightly/clients/${"a".repeat(40)}/${"b".repeat(64)}/Coop.7z`;
    for (const origin of GATEWAY_ORIGINS) {
        const manifest = rewriteManifestArtifactUrls({
            client: { key: clientKey, publicUrl: `${legacy}/${clientKey}` },
        }, origin, legacy) as { client: { publicUrl: string } };
        assert.equal(manifest.client.publicUrl, `${origin}/v1/artifacts/${clientKey}`);
    }
});

test("nightly publication validation rejects client-only or malformed markers", () => {
    assert.throws(
        () => validateNightlyPublicationManifest({ version: 1, client: {} }, legacy),
        /invalid_nightly_publication/,
    );
});

test("gateway pages use the site brand without weakening page security", () => {
    const markup = page(
        `Nightly <access>`,
        `Supporter "builds"`,
        `<h1>Known-safe content</h1>`,
        `claim-page`,
    );

    assert.match(markup, /Bannerlord Co-op/);
    assert.match(markup, /Nightly Access/);
    assert.match(markup, /--crimson:#8f1d23/);
    assert.match(markup, /singleleader\.png/);
    assert.match(markup, /<title>Nightly &lt;access&gt; \| Bannerlord Co-op<\/title>/);
    assert.match(markup, /Supporter &quot;builds&quot;/);
    assert.match(markup, /class="shell claim-page"/);
    assert.doesNotMatch(markup, /<script/i);
});

test("the Worker no longer talks to Discord or holds refresh-token secrets", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const secrets = readFileSync(new URL("../secrets.d.ts", import.meta.url), "utf8");

    for (const text of [source, wrangler, secrets]) {
        assert.doesNotMatch(text, /DISCORD_(?:BOT_TOKEN|CLIENT_ID|CLIENT_SECRET)|TOKEN_ENCRYPTION_KEY|PUBLIC_ORIGIN/);
    }
    assert.doesNotMatch(source, /discord\.com\/api|supporter_grants|sponsor_sessions|oauth_states|device_sessions/);
    assert.match(wrangler, /"NIGHTLY_FUNCTION_URL": "https:\/\/wfvqnijwuyqjibhlcrhz\.supabase\.co\/functions\/v1\/nightly-gateway"/);
});

test("the PowerShell installer is synchronized with the gateway copy", () => {
    const canonical = readFileSync(new URL("../../installer/install.ps1", import.meta.url), "utf8");
    const served = readFileSync(new URL("../public/install.ps1", import.meta.url), "utf8");
    assert.equal(served, canonical);
});

test("the Windows launcher is synchronized, falls back safely, and keeps failures visible", () => {
    const canonical = readFileSync(new URL("../../installer/install.cmd", import.meta.url), "utf8");
    const served = readFileSync(new URL("../public/install.cmd", import.meta.url), "utf8");

    assert.equal(served, canonical);
    assert.match(served, /client, Windows dedicated server, or both/);
    assert.match(served, /-ExecutionPolicy Bypass -File/);
    assert.match(served, /BANNERLORDCOOP_INSTALLER_LAUNCHER=1/);
    assert.match(served, /try \{[^\r\n]+Invoke-WebRequest[^\r\n]+\} catch \{ exit 1 \}/);
    assert.match(served, /%SystemRoot%\\System32\\curl\.exe/);
    assert.match(served, /%SystemRoot%\\System32\\findstr\.exe/);
    assert.match(served, /--fail --location --silent --show-error/);
    assert.match(served, /if %%~zI LSS 4096 exit \/b 1/);
    assert.match(served, /"%FINDSTR_EXE%" \/b \/l \/c:"\$ErrorActionPreference = 'Stop'"/);
    assert.match(served, /"%FINDSTR_EXE%" \/b \/l \/c:"if \(\$env:BANNERLORDCOOP_INSTALLER_TEST -ne '1'\) \{"/);
    assert.match(served, /Management\.Automation\.Language\.Parser/);
    const gatewayIndex = served.indexOf(
        "https://nightly.bannerlordcoop.com/install.ps1",
    );
    const mirrorIndex = served.indexOf(
        "https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop-website/main/installer/install.ps1",
    );
    assert.notEqual(gatewayIndex, -1);
    assert.ok(gatewayIndex < mirrorIndex);
    assert.match(served, /nightly gateway download failed\. Trying the GitHub mirror/);
    assert.match(served, /could not be downloaded from the nightly gateway or GitHub mirror/);
    assert.match(served, /The installer stopped with an error/);
    assert.equal(served.match(/^pause$/gim)?.length, 1);
    assert.doesNotMatch(served, /The installer finished successfully/);
});

test("the Linux launcher is synchronized, falls back safely, and fetches the latest installer", () => {
    const canonical = readFileSync(new URL("../../installer/install.sh", import.meta.url), "utf8");
    const served = readFileSync(new URL("../public/install.sh", import.meta.url), "utf8");

    assert.equal(served, canonical);
    assert.equal(served.includes("\r"), false);
    assert.match(served, /client, Windows dedicated server, or both/);
    assert.match(served, /BANNERLORDCOOP_INSTALLER_LAUNCHER=1/);
    assert.match(served, /for required in curl bash tr/);
    assert.match(served, /tr -d '\\r'/);
    assert.match(served, /\/install-linux\.sh/);
    const gatewayIndex = served.indexOf(
        "https://nightly.bannerlordcoop.com/install-linux.sh",
    );
    const mirrorIndex = served.indexOf(
        "https://raw.githubusercontent.com/Bannerlord-Coop-Team/BannerlordCoop-website/main/installer/install-linux.sh",
    );
    assert.notEqual(gatewayIndex, -1);
    assert.ok(gatewayIndex < mirrorIndex);
    assert.match(served, /nightly gateway download failed\. Trying the GitHub mirror/);
    assert.match(served, /could not be downloaded from the nightly gateway or GitHub mirror/);
    assert.match(served, /The installer stopped with an error/);
    assert.doesNotMatch(served, /nightly-token|reuse-base/);
});

test("the Linux installer matches Windows nightly policy and ships Windows artifacts", () => {
    const installer = readFileSync(new URL("../../installer/install-linux.sh", import.meta.url), "utf8");
    const served = readFileSync(new URL("../public/install-linux.sh", import.meta.url), "utf8");

    assert.equal(served, installer);
    assert.equal(installer.includes("\r"), false);
    assert.match(installer, /BannerlordCoop-DedicatedServer-Win64\.7z/);
    assert.match(installer, /Win64_Shipping_Client/);
    assert.match(installer, /DedicatedServer\.Windows/);
    assert.match(installer, /compatibleBaseFingerprints/);
    assert.match(installer, /Discord access was denied/);
    assert.match(installer, /\|######\|/);
    assert.match(installer, /Press Enter to close the installer\./);
    assert.doesNotMatch(installer, /nightly-token|TOKEN_FILE|reuse-base|REUSE_BASE/);
    assert.doesNotMatch(installer, /Linux64|DedicatedServer\.Linux/);
});

test("the installer owns the completion banner, locations, and close prompt", () => {
    const installer = readFileSync(new URL("../../installer/install.ps1", import.meta.url), "utf8");

    assert.match(installer, /function Show-InstallationComplete/);
    assert.doesNotMatch(installer, /PARTY READY|party is ready/i);
    assert.match(installer, /\|######\|/);
    assert.match(installer, /Installation locations:/);
    assert.match(installer, /Client: \$ClientPath/);
    assert.match(installer, /Dedicated server: \$ServerPath/);
    assert.match(installer, /Press Enter to close the installer\./);
    assert.match(installer, /if \(-not \$NoWait\) \{ \[void\]\(Read-Host\) \}/);
});

test("the installer explains a locked CrashReporter or Bannerlord client file", () => {
    const installer = readFileSync(new URL("../../installer/install.ps1", import.meta.url), "utf8");

    assert.match(installer, /function Get-LockedClientProcesses/);
    assert.match(installer, /function Remove-OldClient/);
    assert.match(installer, /\$\(\$running\[0\]\) is still running/);
    assert.match(installer, /access to '\$FailedPath' was denied/);
    assert.match(installer, /Close Bannerlord and Coop\.CrashReporter\.exe/);
    assert.doesNotMatch(installer, /\$fromClientFolder -or \(\$name -ieq 'Bannerlord'\) -or \(\$name -ieq 'Coop\.CrashReporter'\)/);
});

test("the installer fetches a pinned 7-Zip extractor from the gateway before 7-zip.org", () => {
    const installer = readFileSync(new URL("../../installer/install.ps1", import.meta.url), "utf8");
    const extractor = readFileSync(new URL("../public/7zr.exe", import.meta.url));
    const hash = createHash("sha256").update(extractor).digest("hex");

    assert.equal(hash, "56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72");
    assert.match(installer, /\$script:SevenZipSha256 = '56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72'/);
    const gatewayIndex = installer.indexOf("$($script:NightlyGatewayUri)/7zr.exe");
    const officialIndex = installer.indexOf("https://www.7-zip.org/a/7zr.exe");
    const githubIndex = installer.indexOf("https://github.com/ip7z/7zip/releases/download/26.02/7zr.exe");
    assert.notEqual(gatewayIndex, -1);
    assert.ok(gatewayIndex < officialIndex);
    assert.ok(officialIndex < githubIndex);
    assert.match(installer, /function Install-StandaloneSevenZip/);
    assert.doesNotMatch(installer, /\$script:SevenZipUri = 'https:\/\/www\.7-zip\.org\/a\/7zr\.exe'/);
});

test("the installer can pin one create-build pair without falling back to the latest nightly", () => {
    const installer = readFileSync(new URL("../../installer/install.ps1", import.meta.url), "utf8");

    assert.equal(installer.startsWith("$ErrorActionPreference = 'Stop'\n") || installer.startsWith("$ErrorActionPreference = 'Stop'\r\n"), true);
    assert.match(installer, /\$env:BANNERLORDCOOP_INSTALLER_PIN/);
    assert.match(installer, /function Get-InstallerPin/);
    assert.match(installer, /function Get-CreateBuildPinAccessToken/);
    assert.match(installer, /function Get-PinManifest/);
    assert.match(installer, /v1\/pins\/token/);
    assert.match(installer, /v1\/manifests\/pin/);
    assert.match(installer, /create-build-pin/);
    assert.match(installer, /Pinned create-build:/);
    assert.match(installer, /function Get-ArchiveAuthorization/);
    assert.match(installer, /if \(\$installerPin\) \{[\s\S]*Get-CreateBuildPinAccessToken[\s\S]*Get-PinManifest[\s\S]*\} else \{[\s\S]*Get-NightlyAccessToken/);
});

test("the installer keeps long download, verification, and extraction progress visible", () => {
    const installer = readFileSync(new URL("../../installer/install.ps1", import.meta.url), "utf8");

    assert.match(installer, /Write-Progress -Id 1 -Activity "Downloading \$Label"/);
    assert.match(installer, /Write-Progress -Id 2 -Activity "Verifying \$Label"/);
    assert.match(installer, /-bsp1/);
    assert.doesNotMatch(installer, /-bsp0/);
    assert.match(installer, /Expand-SevenZipArchive \$SevenZip \$archive \$stage 'Coop client'/);
    assert.match(installer, /Expand-SevenZipArchive \$SevenZip \$archive \$stage 'dedicated server'/);
});
