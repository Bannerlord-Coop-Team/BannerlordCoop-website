export const DISCORD_GUILD_ID = "709516043332354119";
export const SUPPORTER_ROLE_IDS = Object.freeze([
    "1532151760012050452", // Patreon supporter
    "1532744756151455834", // Boosty supporter
    "1533090199104524338", // Afdian supporter
]);
export const SPONSORED_ACCOUNT_LIMIT = 10;
export const DEVICE_SESSION_SECONDS = 10 * 60;
export const DOWNLOAD_SESSION_SECONDS = 60 * 60;
export const DISCORD_OAUTH_SCOPES = "identify guilds.members.read";

const SNOWFLAKE = /^\d{17,20}$/;
const OBJECT_KEY = /^(?:(?:nightly|release)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,1022}|windows\/base\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/server-base\.7z)$/;

export function hasSupporterRole(roleIds: readonly string[]): boolean {
    return roleIds.some((roleId) => SUPPORTER_ROLE_IDS.includes(roleId));
}

export function isDiscordSnowflake(value: unknown): value is string {
    return typeof value === "string" && SNOWFLAKE.test(value);
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
