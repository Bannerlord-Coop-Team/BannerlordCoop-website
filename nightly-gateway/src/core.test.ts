import assert from "node:assert/strict";
import test from "node:test";
import {
    SPONSORED_ACCOUNT_LIMIT,
    artifactKeyFromUrl,
    hasNightlyAccessRole,
    isAllowedArtifactKey,
    isSameOriginFormRequest,
    rewriteManifestArtifactUrls,
} from "./core";
import { nightlyAccessPage, page } from "./index";

const legacy = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
const gateway = "https://bannerlordcoop-nightly-gateway.garrett-luskey.workers.dev";

test("supporters and Testers get nightly access and share the same seat limit", () => {
    assert.equal(hasNightlyAccessRole(["1532151760012050452"]), true);
    assert.equal(hasNightlyAccessRole(["1532744756151455834"]), true);
    assert.equal(hasNightlyAccessRole(["1533090199104524338"]), true);
    assert.equal(hasNightlyAccessRole(["710222948375593010"]), true);
    assert.equal(hasNightlyAccessRole(["709516043332354119"]), false);
    assert.equal(SPONSORED_ACCOUNT_LIMIT, 10);
});

test("browser forms allow same-origin fetch metadata without allowing cross-site posts", () => {
    assert.equal(isSameOriginFormRequest(gateway, null, gateway), true);
    assert.equal(isSameOriginFormRequest(null, "same-origin", gateway), true);
    assert.equal(isSameOriginFormRequest(null, "cross-site", gateway), false);
    assert.equal(isSameOriginFormRequest("null", "same-origin", gateway), false);
    assert.equal(isSameOriginFormRequest("https://attacker.invalid", "same-origin", gateway), false);
});

test("artifact keys are limited to the two release namespaces", () => {
    assert.equal(isAllowedArtifactKey("nightly/Coop.7z"), true);
    assert.equal(isAllowedArtifactKey("release/123/client/a/Coop.7z"), true);
    assert.equal(isAllowedArtifactKey(`windows/base/v1/${"a".repeat(64)}/${"b".repeat(64)}/server-base.7z`), true);
    assert.equal(isAllowedArtifactKey("windows/other/file.7z"), false);
    assert.equal(isAllowedArtifactKey("managed-hosting/private/export"), false);
    assert.equal(isAllowedArtifactKey("nightly/../secret"), false);
    assert.equal(isAllowedArtifactKey("nightly//Coop.7z"), false);
});

test("legacy artifact URLs must use the exact fixed origin", () => {
    assert.equal(artifactKeyFromUrl(`${legacy}/nightly/Coop.7z`, legacy), "nightly/Coop.7z");
    assert.equal(artifactKeyFromUrl("https://attacker.invalid/nightly/Coop.7z", legacy), null);
    assert.equal(artifactKeyFromUrl(`${legacy}/nightly/Coop.7z?token=x`, legacy), null);
});

test("manifest URLs are rewritten to authenticated gateway paths", () => {
    const manifest = rewriteManifestArtifactUrls({
        version: 1,
        client: { publicUrl: `${legacy}/nightly/Coop.7z` },
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
        : null, `${gateway}/v1/artifacts/nightly/Coop.7z`);
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
    assert.match(markup, /for Patreon, Boosty, and Afdian supporters and Testers, plus their sponsored friends/);
    assert.match(markup, /Tester role/);
    assert.match(markup, /Supporter &amp; Tester builds/);
    assert.match(markup, /href="\/install\.ps1" download="BannerlordCoop-Nightly-Installer\.ps1"/);
    assert.doesNotMatch(markup, /&amp;amp;/);
    assert.doesNotMatch(markup, /community supporters/i);
});
