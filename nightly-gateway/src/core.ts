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
export const DISCORD_OAUTH_SCOPES = "identify guilds.members.read";

const SNOWFLAKE = /^\d{17,20}$/;
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const OBJECT_KEY = /^(?:(?:nightly|release)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,1022}|windows\/base\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/server-base\.7z)$/;
const SPONSOR_FORM_MESSAGE = new TextEncoder().encode("bannerlordcoop-sponsor-form-v1");

export function hasNightlyAccessRole(roleIds: readonly string[]): boolean {
    return roleIds.some((roleId) => NIGHTLY_ACCESS_ROLE_IDS.includes(roleId));
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
    return origin === null || origin === publicOrigin;
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
