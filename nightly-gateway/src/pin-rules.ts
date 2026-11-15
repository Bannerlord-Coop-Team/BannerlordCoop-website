import { isDiscordSnowflake, isSha256Hex } from "./core";
import { base64url, exactArrayBuffer, isBearerToken } from "./primitives";

// Create-build pin rules: lifetimes, R2 keys, install links, deterministic tokens, and the mint-secret check.

export const DOWNLOAD_SESSION_SECONDS = 60 * 60;
export const CREATE_BUILD_PIN_LIFETIME_SECONDS = 24 * 60 * 60;
export const CREATE_BUILD_PIN_KIND = "create-build-pin";

const PIN_CLIENT_KEY = /^pins\/\d{17,20}\/Coop\.7z$/;
const MANUAL_SERVER_KEY = /^manual\/\d{17,20}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const PIN_MINT_MESSAGE = new TextEncoder().encode("bannerlordcoop-create-build-pin-v1");

// Tells whether a key is the one client archive stored for this create-build pin.
export function isAllowedPinClientKey(value: unknown, buildId: string): value is string {
    return typeof value === "string"
        && isDiscordSnowflake(buildId)
        && value === `pins/${buildId}/Coop.7z`
        && PIN_CLIENT_KEY.test(value);
}

// Tells whether a key is a manually uploaded server archive under this build's prefix.
export function isAllowedManualServerKey(value: unknown, buildId: string): value is string {
    return typeof value === "string"
        && isDiscordSnowflake(buildId)
        && value.startsWith(`manual/${buildId}/`)
        && MANUAL_SERVER_KEY.test(value)
        && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

// Names the R2 key that holds a create-build pin's client archive.
export function pinClientObjectKey(buildId: string): string {
    if (!isDiscordSnowflake(buildId)) throw new Error("invalid_build_id");
    return `pins/${buildId}/Coop.7z`;
}

// Builds the browser install link for a create-build pin on the given gateway origin.
export function createBuildPinInstallUrl(origin: string, token: string): string {
    if (!isBearerToken(token)) throw new Error("invalid_pin_token");
    return `${origin}/install?pin=${token}`;
}

// Tells whether a value is a full lowercase git commit SHA.
export function isCreateBuildPinCommitSha(value: unknown): value is string {
    return typeof value === "string" && COMMIT_SHA.test(value);
}

// Derives the deterministic pin token for one build identity from the mint secret.
export async function createBuildPinToken(
    secret: string,
    buildId: string,
    clientSha256: string,
    serverSha256: string,
): Promise<string> {
    if (secret.length < 32 || !isDiscordSnowflake(buildId) || !isSha256Hex(clientSha256) || !isSha256Hex(serverSha256)) {
        throw new Error("invalid_pin_identity");
    }
    const key = await crypto.subtle.importKey(
        "raw",
        exactArrayBuffer(new TextEncoder().encode(secret)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const message = new TextEncoder().encode(`create-build-pin-v1\0${buildId}\0${clientSha256}\0${serverSha256}`);
    return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, message)));
}

// Compares the configured and presented mint secrets without leaking timing.
export async function mintSecretsEqual(expected: string, provided: string): Promise<boolean> {
    if (expected.length < 32 || provided.length < 32 || expected.length !== provided.length) return false;
    const key = await crypto.subtle.importKey(
        "raw",
        exactArrayBuffer(new TextEncoder().encode(expected)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const providedKey = await crypto.subtle.importKey(
        "raw",
        exactArrayBuffer(new TextEncoder().encode(provided)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const expectedProof = new Uint8Array(await crypto.subtle.sign("HMAC", key, PIN_MINT_MESSAGE));
    const providedProof = new Uint8Array(await crypto.subtle.sign("HMAC", providedKey, PIN_MINT_MESSAGE));
    if (expectedProof.byteLength !== providedProof.byteLength) return false;
    let difference = 0;
    for (let index = 0; index < expectedProof.byteLength; index += 1) {
        difference |= expectedProof[index]! ^ providedProof[index]!;
    }
    return difference === 0;
}
