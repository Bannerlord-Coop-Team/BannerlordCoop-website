import { artifactKeyFromUrl, isAllowedArtifactKey } from "./core";
import { GATEWAY_ORIGINS } from "./origins";

// Validates the v2 nightly publication and its pointer, the legacy v1 client and release manifests,
// and rewrites a validated manifest's artifact URLs onto the gateway's authenticated download path.

export type JsonObject = { [key: string]: JsonValue };
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

const NIGHTLY_PUBLICATION_COMMIT = /^[a-f0-9]{40}$/;
const NIGHTLY_PUBLICATION_SHA256 = /^[a-f0-9]{64}$/;
const NIGHTLY_PUBLICATION_DIGEST = /^sha256:[a-f0-9]{64}$/;
const NIGHTLY_PUBLICATION_RUN_ID = /^[1-9][0-9]{0,19}$/;
const NIGHTLY_PUBLICATION_FILE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}\.7z$/;
const NIGHTLY_PUBLICATION_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/;
const NIGHTLY_PUBLICATION_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NIGHTLY_PUBLICATION_REPOSITORY = "ghcr.io/bannerlord-coop-team/bannerlord-coop-dedicated-server";

export type NightlyPublicationPointer = {
    version: 1;
    kind: "bannerlordcoop-nightly-pointer";
    manifest: { key: string; sha256: string };
    container: { repository: string; manifestDigest: string; digestReference: string };
};

/** The public selection record contains hashes and a private metadata pointer only. */
export function validateNightlyPublicationPointer(input: unknown): NightlyPublicationPointer {
    if (!isRecord(input) || !exactKeys(input, ["version", "kind", "manifest", "container"])
        || input.version !== 1 || input.kind !== "bannerlordcoop-nightly-pointer") {
        throw new Error("invalid_nightly_pointer");
    }
    const manifest = recordField(input, "manifest");
    const container = recordField(input, "container");
    const sha256 = stringField(manifest, "sha256", NIGHTLY_PUBLICATION_SHA256);
    const digest = stringField(container, "manifestDigest", NIGHTLY_PUBLICATION_DIGEST);
    if (!exactKeys(manifest, ["key", "sha256"])
        || !exactKeys(container, ["repository", "manifestDigest", "digestReference"])
        || manifest.key !== `nightly/publications/${sha256}/release.json`
        || container.repository !== NIGHTLY_PUBLICATION_REPOSITORY
        || container.digestReference !== `${NIGHTLY_PUBLICATION_REPOSITORY}@${digest}`) {
        throw new Error("invalid_nightly_pointer");
    }
    return input as unknown as NightlyPublicationPointer;
}

// Tells whether an object has exactly the given keys and no others.
function exactKeys(value: JsonObject, keys: string[]): boolean {
    return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Validates the final marker before returning any nightly manifest projection. */
export function validateNightlyPublicationManifest(input: unknown, legacyOrigin: string): JsonObject {
    if (!isRecord(input)) throw new Error("invalid_nightly_publication");
    const value = structuredClone(input) as JsonObject;
    if (value.version !== 2 || value.kind !== "bannerlordcoop-nightly-publication"
        || typeof value.releaseDate !== "string" || !NIGHTLY_PUBLICATION_DATE.test(value.releaseDate)
        || typeof value.builtAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value.builtAt)
        || typeof value.headSha !== "string" || !NIGHTLY_PUBLICATION_COMMIT.test(value.headSha)
        || typeof value.serverSha !== "string" || !NIGHTLY_PUBLICATION_COMMIT.test(value.serverSha)
        || typeof value.clientRunId !== "string" || !NIGHTLY_PUBLICATION_RUN_ID.test(value.clientRunId)
        || typeof value.serverRunId !== "string" || !NIGHTLY_PUBLICATION_RUN_ID.test(value.serverRunId)) {
        throw new Error("invalid_nightly_publication");
    }
    const client = recordField(value, "client");
    const clientSha = stringField(client, "sha256", NIGHTLY_PUBLICATION_SHA256);
    validateArtifact(client, legacyOrigin, `nightly/clients/${value.headSha}/${clientSha}/Coop.7z`, NIGHTLY_PUBLICATION_FILE);
    const server = recordField(value, "server");
    const serverSha = stringField(value, "serverSha", NIGHTLY_PUBLICATION_COMMIT);
    const serverSha256 = stringField(server, "sha256", NIGHTLY_PUBLICATION_SHA256);
    const serverKey = `nightly/windows/full/${value.headSha}/${serverSha}/${serverSha256}/BannerlordCoop-DedicatedServer-Win64.7z`;
    validateArtifact(server, legacyOrigin, serverKey, /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$/, 8 * 1024 * 1024 * 1024);
    const incremental = recordField(server, "incremental");
    if (incremental.version !== 1 || incremental.layout !== "base-overlay-v1"
        || typeof incremental.baseFingerprint !== "string"
        || !NIGHTLY_PUBLICATION_SHA256.test(incremental.baseFingerprint)
        || !Array.isArray(incremental.compatibleBaseFingerprints)
        || incremental.compatibleBaseFingerprints.length > 16
        || incremental.compatibleBaseFingerprints.some((fingerprint) => typeof fingerprint !== "string" || !NIGHTLY_PUBLICATION_SHA256.test(fingerprint))) {
        throw new Error("invalid_nightly_publication_incremental");
    }
    const base = recordField(incremental, "base");
    const update = recordField(incremental, "update");
    const baseSha = stringField(base, "sha256", NIGHTLY_PUBLICATION_SHA256);
    const updateSha = stringField(update, "sha256", NIGHTLY_PUBLICATION_SHA256);
    validateArtifact(base, legacyOrigin, `windows/base/v1/${incremental.baseFingerprint}/${baseSha}/server-base.7z`, /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$/, 8 * 1024 * 1024 * 1024);
    validateArtifact(update, legacyOrigin, `nightly/windows/updates/${value.headSha}/${serverSha}/${updateSha}/server-update.7z`, /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$/, 512 * 1024 * 1024);
    const container = recordField(value, "container");
    const digest = stringField(container, "manifestDigest", NIGHTLY_PUBLICATION_DIGEST);
    const expectedImmutable = `${NIGHTLY_PUBLICATION_REPOSITORY}:nightly-${value.serverSha.slice(0, 12)}-${value.headSha.slice(0, 12)}-${digest.slice(7)}`;
    if (container.repository !== NIGHTLY_PUBLICATION_REPOSITORY
        || container.digestReference !== `${NIGHTLY_PUBLICATION_REPOSITORY}@${digest}`
        || container.immutableReference !== expectedImmutable) {
        throw new Error("invalid_nightly_publication_container");
    }
    return value;
}

/** Validates the bounded v1 client manifest retained as a compatibility fallback. */
export function validateLegacyNightlyClientManifest(
    input: unknown,
    legacyOrigin: string,
): JsonObject {
    if (!isRecord(input) || input.version !== 1 || typeof input.releaseDate !== "string"
        || !NIGHTLY_PUBLICATION_DATE.test(input.releaseDate)
        || typeof input.headSha !== "string" || !NIGHTLY_PUBLICATION_COMMIT.test(input.headSha)
        || (input.baseSha !== null && (typeof input.baseSha !== "string" || !NIGHTLY_PUBLICATION_COMMIT.test(input.baseSha)))
        || (input.workflowRunId !== undefined && (typeof input.workflowRunId !== "number"
            || !Number.isSafeInteger(input.workflowRunId) || input.workflowRunId <= 0))
        || typeof input.builtAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(input.builtAt)) {
        throw new Error("invalid_legacy_nightly_client_manifest");
    }
    const client = recordField(input, "client");
    if (!exactKeys(client, ["fileName", "key", "bytes", "sha256", "publicUrl"])
        || typeof client.fileName !== "string" || !NIGHTLY_PUBLICATION_FILE.test(client.fileName)
        || typeof client.key !== "string" || client.key !== `nightly/clients/${input.headSha}/${client.sha256}/Coop.7z`
        || !isAllowedArtifactKey(client.key) || typeof client.bytes !== "number"
        || !Number.isSafeInteger(client.bytes) || client.bytes <= 0
        || typeof client.sha256 !== "string" || !NIGHTLY_PUBLICATION_SHA256.test(client.sha256)
        || typeof client.publicUrl !== "string") {
        throw new Error("invalid_legacy_nightly_client_manifest");
    }
    const parsed = new URL(client.publicUrl);
    const legacyPath = `/${client.key}`;
    const gatewayPath = `/v1/artifacts/${client.key}`;
    const onGateway = GATEWAY_ORIGINS.includes(parsed.origin);
    if (parsed.search || parsed.hash
        || (parsed.origin === legacyOrigin && parsed.pathname !== legacyPath)
        || (onGateway && parsed.pathname !== gatewayPath)
        || (parsed.origin !== legacyOrigin && !onGateway)) {
        throw new Error("invalid_legacy_nightly_client_manifest");
    }
    return input;
}

/** Validates the bounded v1 release pair retained for a safe Server/Both fallback. */
export function validateLegacyNightlyReleaseManifest(
    input: unknown,
    legacyOrigin: string,
): JsonObject {
    if (!isRecord(input) || !exactKeys(input, ["version", "releaseDate", "headSha", "builtAt", "client", "server"])
        || input.version !== 1 || typeof input.releaseDate !== "string"
        || !NIGHTLY_PUBLICATION_DATE.test(input.releaseDate)
        || typeof input.headSha !== "string" || !NIGHTLY_PUBLICATION_COMMIT.test(input.headSha)
        || typeof input.builtAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(input.builtAt)) {
        throw new Error("invalid_legacy_nightly_release_manifest");
    }
    validateLegacyReleaseArtifact(
        recordField(input, "client"),
        legacyOrigin,
        `nightly/clients/${input.headSha}/${stringField(recordField(input, "client"), "sha256", NIGHTLY_PUBLICATION_SHA256)}/Coop.7z`,
        NIGHTLY_PUBLICATION_FILE,
        undefined,
        true,
    );
    const server = recordField(input, "server");
    if (!exactKeys(server, ["fileName", "bytes", "sha256", "publicUrl", "incremental"])) {
        throw new Error("invalid_legacy_nightly_release_manifest");
    }
    const serverArtifact = { ...server };
    delete serverArtifact.incremental;
    validateLegacyReleaseArtifact(
        serverArtifact,
        legacyOrigin,
        "nightly/BannerlordCoop-DedicatedServer-Win64.7z",
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$/,
        8 * 1024 * 1024 * 1024,
    );
    const incremental = recordField(server, "incremental");
    if (!exactKeys(incremental, ["version", "layout", "baseFingerprint", "compatibleBaseFingerprints", "base", "update"])
        || incremental.version !== 1 || incremental.layout !== "base-overlay-v1"
        || typeof incremental.baseFingerprint !== "string"
        || !NIGHTLY_PUBLICATION_SHA256.test(incremental.baseFingerprint)
        || !Array.isArray(incremental.compatibleBaseFingerprints)
        || incremental.compatibleBaseFingerprints.length > 16
        || incremental.compatibleBaseFingerprints.some((fingerprint) => typeof fingerprint !== "string" || !NIGHTLY_PUBLICATION_SHA256.test(fingerprint))) {
        throw new Error("invalid_legacy_nightly_release_incremental");
    }
    const base = recordField(incremental, "base");
    const baseSha = stringField(base, "sha256", NIGHTLY_PUBLICATION_SHA256);
    validateLegacyReleaseArtifact(
        base,
        legacyOrigin,
        `windows/base/v1/${incremental.baseFingerprint}/${baseSha}/server-base.7z`,
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$/,
        8 * 1024 * 1024 * 1024,
        true,
    );
    const update = recordField(incremental, "update");
    const updateSha = stringField(update, "sha256", NIGHTLY_PUBLICATION_SHA256);
    if (typeof update.publicUrl !== "string") throw new Error("invalid_legacy_nightly_release_artifact");
    let updateKey: string;
    try {
        const parsed = new URL(update.publicUrl);
        updateKey = decodeURIComponent(parsed.pathname.slice(1));
    } catch {
        throw new Error("invalid_legacy_nightly_release_artifact");
    }
    if (!new RegExp(`^nightly/windows/updates/${input.headSha}/[a-f0-9]{40}/${updateSha}/server-update\\.7z$`).test(updateKey)) {
        throw new Error("invalid_legacy_nightly_release_artifact");
    }
    validateLegacyReleaseArtifact(
        update,
        legacyOrigin,
        updateKey,
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$/,
        512 * 1024 * 1024,
        true,
    );
    return input;
}

// Checks one legacy release artifact's shape and that its URL names the key on R2 or on an allowlisted gateway host.
function validateLegacyReleaseArtifact(
    value: JsonObject,
    legacyOrigin: string,
    key: string,
    filePattern: RegExp,
    maximumBytes: number | undefined,
    allowKey = false,
): void {
    if (!exactKeys(value, allowKey ? ["fileName", "key", "bytes", "sha256", "publicUrl"] : ["fileName", "bytes", "sha256", "publicUrl"])
        || typeof value.fileName !== "string" || !filePattern.test(value.fileName)
        || (allowKey && value.key !== key)
        || typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes)
        || value.bytes <= 0 || (maximumBytes !== undefined && value.bytes > maximumBytes)
        || typeof value.sha256 !== "string" || !NIGHTLY_PUBLICATION_SHA256.test(value.sha256)
        || typeof value.publicUrl !== "string") {
        throw new Error("invalid_legacy_nightly_release_artifact");
    }
    const parsed = new URL(value.publicUrl);
    const onGateway = GATEWAY_ORIGINS.includes(parsed.origin);
    if (parsed.search || parsed.hash
        || (parsed.origin === legacyOrigin && parsed.pathname !== `/${key}`)
        || (onGateway && parsed.pathname !== `/v1/artifacts/${key}`)
        || (parsed.origin !== legacyOrigin && !onGateway)
        || !isAllowedArtifactKey(key)) {
        throw new Error("invalid_legacy_nightly_release_artifact");
    }
}

// Reads a required nested object field or throws a publication field error.
function recordField(value: JsonObject, field: string): JsonObject {
    const result = value[field];
    if (!isRecord(result)) throw new Error("invalid_nightly_publication_field");
    return result;
}

// Reads a required string field matching the pattern or throws a publication field error.
function stringField(value: JsonObject, field: string, pattern: RegExp): string {
    const result = value[field];
    if (typeof result !== "string" || !pattern.test(result)) throw new Error("invalid_nightly_publication_field");
    return result;
}

// Checks one v2 publication artifact's shape, size, digest, and fixed R2 URL.
function validateArtifact(
    value: JsonObject,
    legacyOrigin: string,
    key: string,
    filePattern: RegExp,
    maximumBytes?: number,
): void {
    if (typeof value.fileName !== "string" || !filePattern.test(value.fileName)
        || value.key !== key || typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes)
        || value.bytes <= 0 || (maximumBytes !== undefined && value.bytes > maximumBytes)
        || typeof value.sha256 !== "string" || !NIGHTLY_PUBLICATION_SHA256.test(value.sha256)
        || typeof value.publicUrl !== "string" || value.publicUrl !== `${legacyOrigin}/${key}`
        || !NIGHTLY_PUBLICATION_KEY.test(key)) {
        throw new Error("invalid_nightly_publication_artifact");
    }
}

// Copies a manifest with every artifact URL pointed at the gateway's authenticated download path.
export function rewriteManifestArtifactUrls(
    input: unknown,
    gatewayOrigin: string,
    legacyOrigin: string,
): JsonObject {
    if (!isRecord(input)) throw new Error("invalid_manifest");
    const output = structuredClone(input) as JsonObject;
    rewriteRecord(output, gatewayOrigin, legacyOrigin);
    return output;
}

// Rewrites artifact URLs in one manifest object and its nested objects, in place.
function rewriteRecord(record: JsonObject, gatewayOrigin: string, legacyOrigin: string): void {
    for (const value of Object.values(record)) {
        if (isRecord(value)) rewriteRecord(value, gatewayOrigin, legacyOrigin);
        if (Array.isArray(value)) {
            for (const item of value) if (isRecord(item)) rewriteRecord(item, gatewayOrigin, legacyOrigin);
        }
    }
    if (!("publicUrl" in record)) return;
    const key = typeof record.key === "string"
        ? record.key
        : artifactKeyFromUrl(record.publicUrl, legacyOrigin);
    if (!isAllowedArtifactKey(key)) throw new Error("invalid_manifest_artifact");
    record.publicUrl = `${gatewayOrigin}/v1/artifacts/${key.split("/").map(encodeURIComponent).join("/")}`;
}

// Tells whether a value is a plain JSON object.
function isRecord(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
