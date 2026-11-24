import { GITHUB_RELEASES_URL } from "./repository";
import { parseReleaseManifest, type ReleaseFileKind, type ReleaseManifest } from "./release-manifest";

// Resolves the newest public release's files and turns them into download redirects.

/** GitHub redirects this fixed asset name to the newest non-prerelease release's copy. */
export const LATEST_MANIFEST_URL = `${GITHUB_RELEASES_URL}/latest/download/manifest.json`;
const MANIFEST_BYTE_LIMIT = 16 * 1024;
const MANIFEST_REVALIDATE_SECONDS = 600;

/** The fetch signature the reader needs, injected so tests and the runtime supply their own. */
export type ReleaseFetch = (input: string, init: RequestInit & { next?: { revalidate: number } }) => Promise<Response>;

/** Reads the newest release manifest, or null when it cannot be fetched or validated. */
export type LatestReleaseReader = () => Promise<ReleaseManifest | null>;

// Builds a reader that fetches the latest manifest through the given fetch, cached for ten minutes.
export function createLatestReleaseReader(fetchManifest: ReleaseFetch, log: (message: string) => void): LatestReleaseReader {
    return async () => {
        try {
            const response = await fetchManifest(LATEST_MANIFEST_URL, { redirect: "follow", next: { revalidate: MANIFEST_REVALIDATE_SECONDS } });
            if (!response.ok) {
                log(`Latest release manifest request failed with status ${response.status}.`);
                return null;
            }
            const text = await response.text();
            if (text.length > MANIFEST_BYTE_LIMIT) {
                log("Latest release manifest exceeded its size limit.");
                return null;
            }
            const manifest = parseReleaseManifest(JSON.parse(text));
            if (manifest === null) log("Latest release manifest failed validation.");
            return manifest;
        } catch (error) {
            log(`Latest release manifest could not be read (${error instanceof Error ? error.name : "unknown"}).`);
            return null;
        }
    };
}

// Picks the redirect target for one file, falling back to the GitHub releases page when no manifest is available.
export async function planReleaseDownload(readLatest: LatestReleaseReader, kind: ReleaseFileKind): Promise<string> {
    const manifest = await readLatest();
    if (manifest === null) return GITHUB_RELEASES_URL;
    return manifest[kind].url;
}
