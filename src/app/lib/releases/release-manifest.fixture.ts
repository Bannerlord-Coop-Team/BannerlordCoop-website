// Real release manifest data shared by the release download tests.

/** Bucket prefix the v0.1.8 archives were published under. */
export const RELEASE_BUCKET_PREFIX = "https://pub-c80efa34191141fd803f8508e025f726.r2.dev/release/v0.1.8";

/** The v0.1.8 release's published manifest.json, as downloaded on 2026-11-24. */
export const V018_MANIFEST = {
    tag: "v0.1.8",
    client_sha: "ff01e7c6705f0c716633d3d4d839f94f3c0ccae9",
    server_sha: "d4f212472a6a9da9fe0aa7347170acbe8f184d53",
    windows: {
        name: "BannerlordCoop-DedicatedServer-Win64-v0.1.8.7z",
        bytes: 2640033244,
        sha256: "2a001ef0bf8ded39a7deb9f315fd7a8f7deccefb588f12feba0c1182eb5421ca",
        url: `${RELEASE_BUCKET_PREFIX}/BannerlordCoop-DedicatedServer-Win64-v0.1.8.7z`,
    },
    client: {
        name: "BannerlordCoop-v0.1.8.zip",
        bytes: 13351745,
        sha256: "e04fa86aeb1f485fbaaf29f2d3263d9df22c2a857c49eceda38ddd92ced7bae8",
        url: `${RELEASE_BUCKET_PREFIX}/BannerlordCoop-v0.1.8.zip`,
    },
};
