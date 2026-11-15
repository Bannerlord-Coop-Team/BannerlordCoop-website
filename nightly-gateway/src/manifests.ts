import { requireNightlyDownloadSession } from "./downloads";
import { GatewayError, decodeUtf8, json, safeErrorCode, type GatewayLog, type UpstreamFetch } from "./http";
import {
    rewriteManifestArtifactUrls,
    type JsonObject,
    validateLegacyNightlyClientManifest,
    validateLegacyNightlyReleaseManifest,
} from "./manifest-rules";
import { resolveGatewayOrigin } from "./origins";
import { NightlyPublicationReadError, readNightlyPublication } from "./publication";

// Serves the nightly client and release manifests, falling back from the v2 publication to the legacy v1 pair.

const NIGHTLY_PUBLICATION_VERSION_HEADER = "x-bannerlord-coop-nightly-version";

/** What manifest serving needs from outside: the outbound fetch for the public pointer and the event log. */
export type ManifestDependencies = { fetch: UpstreamFetch; log: GatewayLog };

// Serves the authorized nightly manifest with every artifact URL rewritten onto the gateway host the installer used.
// Stored manifests may name either gateway host; both validate before the rewrite.
export async function serveManifest(
    request: Request,
    env: Env,
    clientOnly: boolean,
    { fetch: upstreamFetch, log }: ManifestDependencies,
): Promise<Response> {
    await requireNightlyDownloadSession(request, env);
    const origin = resolveGatewayOrigin(request.url);
    const wantsV2 = request.headers.get(NIGHTLY_PUBLICATION_VERSION_HEADER)?.trim() === "2";
    if (clientOnly && !wantsV2) {
        try {
            return json(rewriteManifestArtifactUrls(
                await readHeaderlessNightlyClientManifest(env, upstreamFetch),
                origin,
                env.LEGACY_R2_ORIGIN,
            ));
        } catch (error) {
            log({
                event: "nightly_headerless_client_read_failed",
                error_code: safeErrorCode(error) ?? "manifest_unavailable",
            });
            throw new GatewayError(503, "manifest_unavailable");
        }
    }
    if (!wantsV2) {
        try {
            return json(rewriteManifestArtifactUrls(
                await readLegacyNightlyManifest(env, clientOnly),
                origin,
                env.LEGACY_R2_ORIGIN,
            ));
        } catch (error) {
            log({
                event: "nightly_legacy_default_read_failed",
                route: clientOnly ? "client" : "release",
                error_code: safeErrorCode(error) ?? "legacy_manifest_unavailable",
            });
            throw new GatewayError(503, "manifest_unavailable");
        }
    }
    let validated;
    try {
        validated = await readPublication(env, upstreamFetch);
    } catch (error) {
        const errorCode = safeErrorCode(error) ?? "publication_read_failed";
        const publicationError = error instanceof NightlyPublicationReadError ? error : null;
        log({
            event: "nightly_publication_read_failed",
            route: clientOnly ? "client" : "release",
            error_code: errorCode,
            stage: publicationError?.stage ?? "unknown",
            r2_status: publicationError?.status ?? null,
            exception_class: publicationError?.exceptionClass
                ?? (error instanceof Error && error.name.length > 0 ? error.name : "Error"),
            fallback: clientOnly,
        });
        try {
            if (clientOnly) {
                const release = validateLegacyNightlyReleaseManifest(
                    await readLegacyJson(env, "nightly/release.json", 128 * 1024),
                    env.LEGACY_R2_ORIGIN,
                );
                validated = projectLegacyReleaseClient(
                    release,
                    await tryReadLegacyNightlyClientManifest(env),
                    env.LEGACY_R2_ORIGIN,
                );
            } else {
                validated = await readLegacyNightlyManifest(env, false);
            }
            if (clientOnly) {
                log({
                    event: "nightly_legacy_client_fallback_served",
                    route: "client",
                    head_sha: (validated.headSha as string).slice(0, 12),
                });
            } else {
                log({
                    event: "nightly_legacy_release_fallback_served",
                    route: "release",
                    head_sha: (validated.headSha as string).slice(0, 12),
                });
            }
        } catch (fallbackError) {
            log({
                event: clientOnly ? "nightly_legacy_client_fallback_failed" : "nightly_legacy_release_fallback_failed",
                error_code: safeErrorCode(fallbackError)
                    ?? (clientOnly ? "legacy_client_unavailable" : "legacy_release_unavailable"),
            });
            throw new GatewayError(503, "manifest_unavailable");
        }
    }
    const rewritten = rewriteManifestArtifactUrls(validated, origin, env.LEGACY_R2_ORIGIN);
    return json(rewritten);
}

// Picks the client manifest served to installers that send no version header: the publication's client, else the legacy pair's.
async function readHeaderlessNightlyClientManifest(env: Env, upstreamFetch: UpstreamFetch): Promise<JsonObject> {
    let publication: JsonObject | null = null;
    try {
        publication = await readPublication(env, upstreamFetch);
    } catch {
        // Fall through to the previous complete legacy pair below.
    }

    if (publication !== null) {
        const legacy = await tryReadLegacyNightlyClientManifest(env);
        if (legacy !== null && legacyClientMatchesPublication(legacy, publication)) return legacy;
        return projectPublicationClientAsLegacy(publication, env.LEGACY_R2_ORIGIN);
    }

    const legacyRelease = validateLegacyNightlyReleaseManifest(
        await readLegacyJson(env, "nightly/release.json", 128 * 1024),
        env.LEGACY_R2_ORIGIN,
    );
    return projectLegacyReleaseClient(
        legacyRelease,
        await tryReadLegacyNightlyClientManifest(env),
        env.LEGACY_R2_ORIGIN,
    );
}

// Reads the verified v2 publication, taking the pointer from the public R2 binding when bound, else over HTTP.
function readPublication(env: Env, upstreamFetch: UpstreamFetch): Promise<JsonObject> {
    return readNightlyPublication(
        (key) => env.RELEASES.get(key),
        upstreamFetch,
        env.PUBLIC_RELEASES === undefined ? undefined : () => env.PUBLIC_RELEASES.get("nightly/release.json"),
    );
}

// Reads the stored legacy client manifest, or null when it is missing or invalid.
async function tryReadLegacyNightlyClientManifest(env: Env): Promise<JsonObject | null> {
    try {
        return await readLegacyNightlyClientManifest(env);
    } catch {
        return null;
    }
}

// Tells whether the legacy client manifest describes the same client archive as the publication.
function legacyClientMatchesPublication(legacy: JsonObject, publication: JsonObject): boolean {
    const legacyClient = legacy.client as Record<string, unknown>;
    const publicationClient = publication.client as Record<string, unknown>;
    return legacy.releaseDate === publication.releaseDate
        && legacy.headSha === publication.headSha
        && legacyClient.key === publicationClient.key
        && legacyClient.sha256 === publicationClient.sha256;
}

// Projects a v2 publication's client into the bounded v1 client manifest shape.
function projectPublicationClientAsLegacy(
    publication: JsonObject,
    legacyOrigin: string,
): JsonObject {
    return validateLegacyNightlyClientManifest({
        version: 1,
        releaseDate: publication.releaseDate,
        headSha: publication.headSha,
        baseSha: null,
        workflowRunId: Number(publication.clientRunId),
        builtAt: publication.builtAt,
        client: publication.client,
    }, legacyOrigin);
}

// Projects a legacy v1 release pair's client into the v1 client manifest shape.
function projectLegacyReleaseClient(
    release: JsonObject,
    metadata: JsonObject | null,
    legacyOrigin: string,
): JsonObject {
    return validateLegacyNightlyClientManifest({
        version: 1,
        releaseDate: release.releaseDate,
        headSha: release.headSha,
        baseSha: null,
        ...(metadata?.headSha === release.headSha ? { workflowRunId: metadata.workflowRunId } : {}),
        builtAt: metadata?.headSha === release.headSha ? metadata.builtAt : release.builtAt,
        client: release.client,
    }, legacyOrigin);
}

// Reads and validates the stored legacy v1 client manifest.
async function readLegacyNightlyClientManifest(env: Env): Promise<JsonObject> {
    return validateLegacyNightlyClientManifest(
        await readLegacyJson(env, "nightly/client.json", 32 * 1024),
        env.LEGACY_R2_ORIGIN,
    );
}

// Reads the legacy client manifest, or the legacy release manifest after checking it pairs with the stored client.
async function readLegacyNightlyManifest(env: Env, clientOnly: boolean): Promise<JsonObject> {
    if (clientOnly) {
        return readLegacyNightlyClientManifest(env);
    }
    const legacyRelease = validateLegacyNightlyReleaseManifest(
        await readLegacyJson(env, "nightly/release.json", 128 * 1024),
        env.LEGACY_R2_ORIGIN,
    );
    const legacyClient = validateLegacyNightlyClientManifest(
        await readLegacyJson(env, "nightly/client.json", 32 * 1024),
        env.LEGACY_R2_ORIGIN,
    );
    const releaseClient = legacyRelease.client as Record<string, unknown>;
    const client = legacyClient.client as Record<string, unknown>;
    if (legacyRelease.releaseDate !== legacyClient.releaseDate
        || legacyRelease.headSha !== legacyClient.headSha
        || releaseClient.key !== client.key
        || releaseClient.sha256 !== client.sha256) {
        throw new Error("legacy_release_client_mismatch");
    }
    return legacyRelease;
}

// Reads one bounded legacy JSON object from the private release bucket.
async function readLegacyJson(env: Env, key: string, maximumBytes: number): Promise<Record<string, unknown>> {
    const object = await env.RELEASES.get(key);
    if (object === null || object.size > maximumBytes) throw new Error("legacy_manifest_unavailable");
    const bytes = await object.arrayBuffer();
    return JSON.parse(decodeUtf8(bytes)) as Record<string, unknown>;
}
