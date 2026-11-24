import assert from "node:assert/strict";
import test from "node:test";
import { rewriteManifestArtifactUrls, validateNightlyPublicationManifest } from "./manifest-rules";

const legacy = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
const gateway = "https://nightly.bannerlordcoop.com";

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

test("nightly publication validation rejects client-only or malformed markers", () => {
    assert.throws(
        () => validateNightlyPublicationManifest({ version: 1, client: {} }, legacy),
        /invalid_nightly_publication/,
    );
});
