export const DISCORD_GUILD_ID = "709516043332354119";
export const SUPPORTER_ROLE_IDS = Object.freeze([
    "1532151760012050452", // Patreon supporter
    "1532744756151455834", // Boosty supporter
    "1533090199104524338", // Afdian supporter
]);
export const STAFF_ROLE_IDS = Object.freeze([
    "730945590011232296", // Helper
    "711610715152056331", // Mod Developer
    "750401609045115114", // Trial Dev
    "709516608741048390", // Administrator
    "730631536122003548", // Community Manager
    "730631233524072588", // Project Lead
]);
export const TESTER_ROLE_ID = "710222948375593010";
export const NIGHTLY_ACCESS_ROLE_IDS = Object.freeze([
    ...SUPPORTER_ROLE_IDS,
    ...STAFF_ROLE_IDS,
    TESTER_ROLE_ID,
]);
export const SPONSORED_ACCOUNT_LIMIT = 10;
export const DEVICE_SESSION_SECONDS = 10 * 60;
export const DOWNLOAD_SESSION_SECONDS = 60 * 60;
export const CREATE_BUILD_PIN_LIFETIME_SECONDS = 24 * 60 * 60;
export const CREATE_BUILD_PIN_KIND = "create-build-pin";
export const DISCORD_OAUTH_SCOPES = "identify guilds.members.read";

const SNOWFLAKE = /^\d{17,20}$/;
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const OBJECT_KEY = /^(?:(?:nightly|release)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,1022}|windows\/base\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/server-base\.7z)$/;
const PIN_CLIENT_KEY = /^pins\/\d{17,20}\/Coop\.7z$/;
const MANUAL_SERVER_KEY = /^manual\/\d{17,20}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.7z$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const PIN_MINT_MESSAGE = new TextEncoder().encode("bannerlordcoop-create-build-pin-v1");
const SPONSOR_FORM_MESSAGE = new TextEncoder().encode("bannerlordcoop-sponsor-form-v1");

export function hasNightlyAccessRole(roleIds: readonly string[]): boolean {
    return roleIds.some((roleId) => NIGHTLY_ACCESS_ROLE_IDS.includes(roleId));
}

export function isEligibleNightlySponsor(member: { roles?: unknown } | null): boolean {
    return member !== null && Array.isArray(member.roles) && hasNightlyAccessRole(
        member.roles.filter((roleId): roleId is string => typeof roleId === "string"),
    );
}

export function isDiscordSnowflake(value: unknown): value is string {
    return typeof value === "string" && SNOWFLAKE.test(value);
}

export function isAllowedSponsorClaimRequest(
    origin: string | null,
    fetchSite: string | null,
    publicOrigin: string,
): boolean {
    if (fetchSite === "cross-site") return false;
    return origin === null || origin === "null" || origin === publicOrigin;
}

export async function createSponsorFormToken(sessionToken: string): Promise<string> {
    if (!SESSION_TOKEN.test(sessionToken)) throw new Error("invalid_sponsor_session");
    const key = await crypto.subtle.importKey(
        "raw",
        exactArrayBuffer(fromBase64url(sessionToken)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, SPONSOR_FORM_MESSAGE)));
}

export async function verifySponsorFormToken(sessionToken: string, proof: unknown): Promise<boolean> {
    if (!SESSION_TOKEN.test(sessionToken) || typeof proof !== "string" || !SESSION_TOKEN.test(proof)) return false;
    const key = await crypto.subtle.importKey(
        "raw",
        exactArrayBuffer(fromBase64url(sessionToken)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
    );
    return crypto.subtle.verify(
        "HMAC",
        key,
        exactArrayBuffer(fromBase64url(proof)),
        SPONSOR_FORM_MESSAGE,
    );
}

export function isAllowedArtifactKey(value: unknown): value is string {
    return typeof value === "string"
        && value.length <= 1024
        && OBJECT_KEY.test(value)
        && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function isCreateBuildPinToken(value: unknown): value is string {
    return typeof value === "string" && SESSION_TOKEN.test(value);
}

export function isAllowedPinClientKey(value: unknown, buildId: string): value is string {
    return typeof value === "string"
        && isDiscordSnowflake(buildId)
        && value === `pins/${buildId}/Coop.7z`
        && PIN_CLIENT_KEY.test(value);
}

export function isAllowedManualServerKey(value: unknown, buildId: string): value is string {
    return typeof value === "string"
        && isDiscordSnowflake(buildId)
        && value.startsWith(`manual/${buildId}/`)
        && MANUAL_SERVER_KEY.test(value)
        && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function pinClientObjectKey(buildId: string): string {
    if (!isDiscordSnowflake(buildId)) throw new Error("invalid_build_id");
    return `pins/${buildId}/Coop.7z`;
}

export function createBuildPinInstallUrl(origin: string, token: string): string {
    if (!isCreateBuildPinToken(token)) throw new Error("invalid_pin_token");
    return `${origin}/install?pin=${token}`;
}

export function isCreateBuildPinCommitSha(value: unknown): value is string {
    return typeof value === "string" && COMMIT_SHA.test(value);
}

export function isSha256Hex(value: unknown): value is string {
    return typeof value === "string" && SHA256_HEX.test(value);
}

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

export function timingSafeEqual(left: string, right: string): boolean {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
        difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return difference === 0;
}

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

export function artifactKeyFromUrl(value: unknown, legacyOrigin: string): string | null {
    if (typeof value !== "string") return null;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return null;
    }
    if (parsed.origin !== legacyOrigin || parsed.search || parsed.hash) return null;
    const key = decodeURIComponent(parsed.pathname.slice(1));
    return isAllowedArtifactKey(key) ? key : null;
}

type JsonObject = { [key: string]: JsonValue };
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

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

function isRecord(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value: string): Uint8Array {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}
