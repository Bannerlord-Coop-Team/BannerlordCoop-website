import assert from "node:assert/strict";
import test from "node:test";
import { artifactKeyFromUrl, isAllowedArtifactKey } from "./core";

const legacy = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";

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

test("legacy artifact URLs must use the exact fixed origin", () => {
    assert.equal(artifactKeyFromUrl(`${legacy}/nightly/Coop.7z`, legacy), "nightly/Coop.7z");
    assert.equal(artifactKeyFromUrl("https://attacker.invalid/nightly/Coop.7z", legacy), null);
    assert.equal(artifactKeyFromUrl(`${legacy}/nightly/Coop.7z?token=x`, legacy), null);
});
