import assert from "node:assert/strict";
import test from "node:test";
import { parseReleaseManifest } from "./release-manifest";
import { RELEASE_BUCKET_PREFIX as BUCKET, V018_MANIFEST } from "./release-manifest.fixture";

// Returns a copy of the fixture with one file entry's fields overridden.
function withFile(kind: "client" | "windows", fields: Record<string, unknown>) {
    return { ...V018_MANIFEST, [kind]: { ...V018_MANIFEST[kind], ...fields } };
}

test("parses the published v0.1.8 manifest into mod and server files", () => {
    assert.deepEqual(parseReleaseManifest(V018_MANIFEST), {
        tag: "v0.1.8",
        mod: V018_MANIFEST.client,
        server: V018_MANIFEST.windows,
    });
});

test("accepts the GitHub release asset as the mod URL", () => {
    const url = "https://github.com/Bannerlord-Coop-Team/BannerlordCoop/releases/download/v0.1.8/BannerlordCoop-v0.1.8.zip";
    assert.equal(parseReleaseManifest(withFile("client", { url }))?.mod.url, url);
});

test("rejects URLs outside the release bucket key or GitHub asset for that tag", () => {
    for (const url of [
        "https://evil.example/BannerlordCoop-v0.1.8.zip",
        `${BUCKET.replace("v0.1.8", "v0.1.7")}/BannerlordCoop-v0.1.8.zip`,
        `${BUCKET}/BannerlordCoop-v0.1.8.zip?x=1`,
        "http://pub-c80efa34191141fd803f8508e025f726.r2.dev/release/v0.1.8/BannerlordCoop-v0.1.8.zip",
    ]) {
        assert.equal(parseReleaseManifest(withFile("client", { url })), null, url);
    }
});

test("rejects malformed tags, names, sizes and digests", () => {
    assert.equal(parseReleaseManifest({ ...V018_MANIFEST, tag: "latest" }), null);
    assert.equal(parseReleaseManifest(withFile("client", { name: "BannerlordCoop.zip" })), null);
    assert.equal(parseReleaseManifest(withFile("windows", { bytes: 0 })), null);
    assert.equal(parseReleaseManifest(withFile("windows", { bytes: "2640033244" })), null);
    assert.equal(parseReleaseManifest(withFile("client", { sha256: "E04FA86A" })), null);
    assert.equal(parseReleaseManifest({ ...V018_MANIFEST, windows: undefined }), null);
    assert.equal(parseReleaseManifest(null), null);
    assert.equal(parseReleaseManifest([]), null);
});
