import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DISCORD_SUPPORT_URL } from "../../supabase/functions/_shared/discord-support";

test("the PowerShell installer is synchronized with the gateway copy", () => {
    const canonical = readFileSync(new URL("../../installer/install.ps1", import.meta.url), "utf8");
    const served = readFileSync(new URL("../public/install.ps1", import.meta.url), "utf8");
    assert.equal(served, canonical);
    assert.ok(served.includes("General Help support ticket in our Discord (" + DISCORD_SUPPORT_URL + ")"));
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
    assert.ok(served.includes("General Help support ticket in our Discord (" + DISCORD_SUPPORT_URL + ")"));
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
