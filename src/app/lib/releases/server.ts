import "server-only";
import { createLatestReleaseReader, planReleaseDownload, type ReleaseFetch } from "./latest-release";
import type { ReleaseFileKind } from "./release-manifest";

// Wrapped rather than passed bare: Workers throw "Illegal invocation" when fetch is called with a foreign `this`.
const globalFetch: ReleaseFetch = (input, init) => fetch(input, init);
const readLatestRelease = createLatestReleaseReader(globalFetch, (message) => console.error(message));

// Composition root: builds the GET handler that redirects to the newest release's file of the given kind.
export function createReleaseDownloadHandler(kind: ReleaseFileKind): () => Promise<Response> {
    return async () => Response.redirect(await planReleaseDownload(readLatestRelease, kind), 302);
}
