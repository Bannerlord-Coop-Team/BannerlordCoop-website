import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    SPONSORED_ACCOUNT_LIMIT,
    artifactKeyFromUrl,
    createBuildPinInstallUrl,
    createBuildPinToken,
    createSponsorFormToken,
    hasNightlyAccessRole,
    isAllowedSponsorClaimRequest,
    isAllowedArtifactKey,
    isAllowedManualServerKey,
    isAllowedPinClientKey,
    isEligibleNightlySponsor,
    mintSecretsEqual,
    pinClientObjectKey,
    rewriteManifestArtifactUrls,
    verifySponsorFormToken,
} from "./core";
import { completeOAuth, nightlyAccessPage, page } from "./index";

const legacy = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";

type TestDatabaseOptions = { portalLogin?: boolean; existingSponsorId?: string };

function testEnvironment(options: TestDatabaseOptions = {}): { env: Env; statements: string[] } {
    const statements: string[] = [];
    const database = {
        prepare(sql: string) {
            const statement = {
                bind() { return statement; },
                async first<T>() {
                    if (sql.includes("FROM oauth_states")) {
                        return (options.portalLogin ? { state_hash: "state" } : null) as T | null;
                    }
                    if (sql.includes("FROM device_sessions WHERE oauth_state_hash")) {
                        return { id: "device-id", status: "pending", expires_at: Math.floor(Date.now() / 1000) + 60 } as T;
                    }
                    if (sql.includes("FROM sponsorships WHERE sponsored_discord_user_id")) {
                        return (options.existingSponsorId
                            ? { supporter_discord_user_id: options.existingSponsorId }
                            : null) as T | null;
                    }
                    throw new Error(`Unexpected test query: ${sql}`);
                },
                async run() {
                    statements.push(sql);
                    return { success: true };
                },
            };
            return statement;
        },
        async batch(entries: Array<{ run(): Promise<{ success: boolean }> }>) {
            const results = [];
            for (const entry of entries) results.push(await entry.run());
            return results;
        },
    };
    return {
        env: {
            DB: database,
            DISCORD_BOT_TOKEN: "B".repeat(59),
            DISCORD_CLIENT_ID: "1537575576745803799",
            DISCORD_CLIENT_SECRET: "test-secret",
            PUBLIC_ORIGIN: gateway,
        } as unknown as Env,
        statements,
    };
}

function installerOAuthFetch(sponsorMember: { roles: string[] } | null = null) {
    return (input: string | URL | Request) => discordOAuthFetch(input, sponsorMember);
}

function discordOAuthFetch(
    input: string | URL | Request,
    sponsorMember: { roles: string[] } | null = null,
): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/oauth2/token")) {
        return Promise.resolve(Response.json({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            scope: "identify guilds.members.read",
            token_type: "Bearer",
        }));
    }
    if (url.endsWith("/users/@me")) {
        return Promise.resolve(Response.json({ id: "123456789012345678", username: "Sponsored Friend" }));
    }
    if (url.includes("/users/@me/guilds/") && url.endsWith("/member")) {
        return Promise.resolve(Response.json({ message: "Unknown Member", code: 10007 }, { status: 404 }));
    }
    if (/\/guilds\/\d+\/members\/\d+$/.test(url)) {
        if (sponsorMember === null) {
            return Promise.resolve(Response.json({ message: "Unknown Member", code: 10007 }, { status: 404 }));
        }
        return Promise.resolve(Response.json(sponsorMember));
    }
    throw new Error(`Unexpected test request: ${url}`);
}

function discordOAuthFetchWithoutRoles(input: string | URL | Request): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/users/@me/guilds/") && url.endsWith("/member")) {
        return Promise.resolve(Response.json({ roles: [] }));
    }
    return discordOAuthFetch(input);
}

test("Discord server membership is optional when claiming a sponsored seat", async () => {
    const originalFetch = globalThis.fetch;
    const { env, statements } = testEnvironment();
    globalThis.fetch = installerOAuthFetch() as typeof fetch;
    try {
        const state = "A".repeat(43);
        const response = await completeOAuth(new URL(`${gateway}/oauth/callback?code=test-code&state=${state}`), env);
        const markup = await response.text();
        assert.equal(response.status, 200);
        assert.match(markup, /Enter your friend&rsquo;s sponsor code/);
        assert.doesNotMatch(markup, /Previous sponsor access ended/);
        assert.ok(statements.some((sql) => sql.includes("status = 'awaiting-sponsor'")));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("Discord server membership remains required to manage sponsor seats", async () => {
    const originalFetch = globalThis.fetch;
    const { env } = testEnvironment({ portalLogin: true });
    globalThis.fetch = installerOAuthFetch() as typeof fetch;
    try {
        const state = "B".repeat(43);
        await assert.rejects(
            completeOAuth(new URL(`${gateway}/oauth/callback?code=test-code&state=${state}`), env),
            /discord_membership_required/,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("sponsored installs stay approved while the sponsor still has a qualifying role", async () => {
    const originalFetch = globalThis.fetch;
    const { env, statements } = testEnvironment({ existingSponsorId: "987654321098765432" });
    globalThis.fetch = installerOAuthFetch({ roles: ["1532151760012050452"] }) as typeof fetch;
    try {
        const state = "D".repeat(43);
        const response = await completeOAuth(new URL(`${gateway}/oauth/callback?code=test-code&state=${state}`), env);
        const markup = await response.text();
        assert.equal(response.status, 200);
        assert.match(markup, /Sponsored access approved/);
        assert.doesNotMatch(markup, /Enter your friend&rsquo;s sponsor code/);
        assert.ok(statements.some((sql) => sql.includes("status = 'approved'")));
        assert.ok(!statements.some((sql) => sql.includes("DELETE FROM supporter_grants")));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("a sponsor who stays in Discord but loses the role has sponsored seats revoked", async () => {
    const originalFetch = globalThis.fetch;
    const { env, statements } = testEnvironment({ existingSponsorId: "987654321098765432" });
    globalThis.fetch = installerOAuthFetch({ roles: [] }) as typeof fetch;
    try {
        const state = "F".repeat(43);
        const response = await completeOAuth(new URL(`${gateway}/oauth/callback?code=test-code&state=${state}`), env);
        const markup = await response.text();
        assert.equal(response.status, 200);
        assert.match(markup, /Enter your friend&rsquo;s sponsor code/);
        assert.ok(statements.some((sql) => sql.includes("DELETE FROM supporter_grants")));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("losing a sponsor role cuts sponsored access and shows the installer code form", async () => {
    const originalFetch = globalThis.fetch;
    const { env, statements } = testEnvironment({ existingSponsorId: "987654321098765432" });
    globalThis.fetch = installerOAuthFetch() as typeof fetch;
    try {
        const state = "E".repeat(43);
        const response = await completeOAuth(new URL(`${gateway}/oauth/callback?code=test-code&state=${state}`), env);
        const markup = await response.text();
        assert.equal(response.status, 200);
        assert.match(markup, /Enter your friend&rsquo;s sponsor code/);
        assert.match(markup, /Previous sponsor access ended/);
        assert.doesNotMatch(markup, /supporter_reauthorization_required/);
        assert.ok(statements.some((sql) => sql.includes("DELETE FROM supporter_grants")));
        assert.ok(statements.some((sql) => sql.includes("DELETE FROM download_sessions")));
        assert.ok(statements.some((sql) => sql.includes("status = 'awaiting-sponsor'")));
        assert.ok(!statements.some((sql) => sql.includes("status = 'approved'")));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("the sponsor portal directs code recipients to the installer redemption flow", async () => {
    const originalFetch = globalThis.fetch;
    const { env } = testEnvironment({ portalLogin: true });
    globalThis.fetch = discordOAuthFetchWithoutRoles as typeof fetch;
    try {
        const state = "C".repeat(43);
        const response = await completeOAuth(new URL(`${gateway}/oauth/callback?code=test-code&state=${state}`), env);
        const markup = await response.text();
        assert.equal(response.status, 403);
        assert.match(markup, /Have a sponsor code\?/);
        assert.match(markup, /Codes are redeemed through the installer/);
        assert.match(markup, /href="\/install\.cmd"/);
        assert.match(markup, /download="BannerlordCoop-Nightly-Installer\.cmd"/);
        assert.match(markup, /href="https:\/\/discord\.gg\/bannerlordcoop">Ask in the Bannerlord Coop Discord<\/a>/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("supporters, Testers, and Staff get nightly access and share the same seat limit", () => {
    assert.equal(hasNightlyAccessRole(["1532151760012050452"]), true);
    assert.equal(hasNightlyAccessRole(["1532744756151455834"]), true);
    assert.equal(hasNightlyAccessRole(["1533090199104524338"]), true);
    assert.equal(hasNightlyAccessRole(["710222948375593010"]), true);
    assert.equal(hasNightlyAccessRole(["730945590011232296"]), true);
    assert.equal(hasNightlyAccessRole(["711610715152056331"]), true);
    assert.equal(hasNightlyAccessRole(["750401609045115114"]), true);
    assert.equal(hasNightlyAccessRole(["709516608741048390"]), true);
    assert.equal(hasNightlyAccessRole(["730631536122003548"]), true);
    assert.equal(hasNightlyAccessRole(["730631233524072588"]), true);
    assert.equal(hasNightlyAccessRole(["709516043332354119"]), false);
    assert.equal(isEligibleNightlySponsor({ roles: ["1532151760012050452"] }), true);
    assert.equal(isEligibleNightlySponsor({ roles: [] }), false);
    assert.equal(isEligibleNightlySponsor(null), false);
    assert.equal(SPONSORED_ACCOUNT_LIMIT, 10);
});

test("sponsor form tokens are bound to the authenticated browser session", async () => {
    const session = "A".repeat(43);
    const otherSession = "B".repeat(43);
    const proof = await createSponsorFormToken(session);
    assert.match(proof, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(await verifySponsorFormToken(session, proof), true);
    assert.equal(await verifySponsorFormToken(otherSession, proof), false);
    assert.equal(await verifySponsorFormToken(session, "invalid"), false);
});

test("sponsor claims tolerate omitted or opaque Origin headers without allowing cross-site forms", () => {
    assert.equal(isAllowedSponsorClaimRequest(gateway, "same-origin", gateway), true);
    assert.equal(isAllowedSponsorClaimRequest(null, "same-origin", gateway), true);
    assert.equal(isAllowedSponsorClaimRequest(null, null, gateway), true);
    assert.equal(isAllowedSponsorClaimRequest("null", "same-origin", gateway), true);
    assert.equal(isAllowedSponsorClaimRequest("null", null, gateway), true);
    assert.equal(isAllowedSponsorClaimRequest("https://attacker.invalid", "same-origin", gateway), false);
    assert.equal(isAllowedSponsorClaimRequest(gateway, "cross-site", gateway), false);
    assert.equal(isAllowedSponsorClaimRequest(null, "cross-site", gateway), false);
    assert.equal(isAllowedSponsorClaimRequest("null", "cross-site", gateway), false);
});

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
            publicUrl: `${legacy}/nightly/BannerlordCoop-DedicatedServer-Win64.7z`,
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

test("gateway pages use the site brand without weakening page security", () => {
    const markup = page(
        `Nightly <access>`,
        `Supporter "builds"`,
        `<h1>Known-safe content</h1>`,
        `claim-page`,
    );

    assert.match(markup, /Bannerlord Coop/);
    assert.match(markup, /Nightly Access/);
    assert.match(markup, /--crimson:#8f1d23/);
    assert.match(markup, /singleleader\.png/);
    assert.match(markup, /<title>Nightly &lt;access&gt; \| Bannerlord Coop<\/title>/);
    assert.match(markup, /Supporter &quot;builds&quot;/);
    assert.match(markup, /class="shell claim-page"/);
    assert.doesNotMatch(markup, /<script/i);
});

test("gateway eligibility copy names every supported membership platform", () => {
    const markup = nightlyAccessPage();
    assert.match(markup, /available to Staff, Testers, and Patreon, Boosty, and Afdian supporters, plus their sponsored friends/);
    assert.match(markup, /client, Windows dedicated server, or both/);
    assert.match(markup, /Select the client, dedicated server, or both/);
    assert.match(markup, /Staff, Supporter &amp; Tester builds/);
    assert.match(markup, /href="\/install\.cmd" download="BannerlordCoop-Nightly-Installer\.cmd"/);
    assert.match(markup, /href="\/install\.sh" download="BannerlordCoop-Nightly-Installer\.sh"/);
    assert.doesNotMatch(markup, /Raw PowerShell script|href="\/install\.ps1"|href="\/install-linux\.sh"/);
    assert.doesNotMatch(markup, /&amp;amp;/);
    assert.doesNotMatch(markup, /community supporters/i);
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
        "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/install.ps1",
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
        "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev/install-linux.sh",
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

test("Discord approval sends users back to the installer window", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

    assert.match(source, /Return to the installer window\. It will continue automatically\./);
    assert.match(source, /Previous sponsor access ended/);
    assert.match(source, /Bot \$\{env.DISCORD_BOT_TOKEN\}/);
    assert.match(source, /prefersHtmlError/);
    assert.doesNotMatch(source, /supporter_reauthorization_required/);
    assert.doesNotMatch(source, /Return to PowerShell/);
});
