import { GITHUB_RELEASES_URL } from "./repository";

// Parses the `manifest.json` asset attached to each public BannerlordCoop GitHub release.

const RELEASE_TAG = /^v\d+\.\d+\.\d+$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
/** Public R2 bucket the release workflow uploads the client and dedicated server archives to. */
const RELEASE_BUCKET_ORIGIN = "https://pub-c80efa34191141fd803f8508e025f726.r2.dev";
const GITHUB_RELEASE_DOWNLOADS = `${GITHUB_RELEASES_URL}/download`;

/** One downloadable archive listed in a release manifest. */
export type ReleaseFile = { name: string; bytes: number; sha256: string; url: string };

/** The files a public release offers: the mod (client) and the Windows dedicated server. */
export type ReleaseManifest = { tag: string; mod: ReleaseFile; server: ReleaseFile };

/** Which release file a download link asks for. */
export type ReleaseFileKind = keyof Omit<ReleaseManifest, "tag">;

// Returns the validated manifest, or null when any field is missing, malformed or points somewhere unexpected.
export function parseReleaseManifest(value: unknown): ReleaseManifest | null {
    if (!isRecord(value) || typeof value.tag !== "string" || !RELEASE_TAG.test(value.tag)) return null;
    const tag = value.tag;
    const mod = parseReleaseFile(value.client, tag, `BannerlordCoop-${tag}.zip`);
    const server = parseReleaseFile(value.windows, tag, `BannerlordCoop-DedicatedServer-Win64-${tag}.7z`);
    if (mod === null || server === null) return null;
    return { tag, mod, server };
}

// Accepts one file entry only when its name, size, digest and URL all match what the release workflow publishes.
function parseReleaseFile(value: unknown, tag: string, expectedName: string): ReleaseFile | null {
    if (!isRecord(value) || value.name !== expectedName) return null;
    const { bytes, sha256, url } = value;
    if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) return null;
    if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) return null;
    if (typeof url !== "string" || !isPublishedUrl(url, tag, expectedName)) return null;
    return { name: expectedName, bytes, sha256, url };
}

// Allows only the exact release bucket key or GitHub release asset for this tag and file name.
function isPublishedUrl(url: string, tag: string, name: string): boolean {
    return url === `${RELEASE_BUCKET_ORIGIN}/release/${tag}/${name}` || url === `${GITHUB_RELEASE_DOWNLOADS}/${tag}/${name}`;
}

// Narrows an unknown JSON value to a plain object.
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
