import assert from "node:assert/strict";
import test from "node:test";
import {
    createBuildPinInstallUrl,
    createBuildPinToken,
    isAllowedManualServerKey,
    isAllowedPinClientKey,
    mintSecretsEqual,
    pinClientObjectKey,
} from "./pin-rules";

const gateway = "https://nightly.bannerlordcoop.com";

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
