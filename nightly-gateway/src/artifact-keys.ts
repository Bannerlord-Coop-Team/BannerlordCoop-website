// R2 artifact-key and identifier rules shared by the manifest, pin, and artifact modules.

const SNOWFLAKE = /^\d{17,20}$/;
const OBJECT_KEY = /^(?:(?:nightly|release)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,1022}|windows\/base\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/server-base\.7z)$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

// Tells whether a value is a Discord snowflake id string.
export function isDiscordSnowflake(value: unknown): value is string {
    return typeof value === "string" && SNOWFLAKE.test(value);
}

// Tells whether a value is a lowercase hex SHA-256 digest.
export function isSha256Hex(value: unknown): value is string {
    return typeof value === "string" && SHA256_HEX.test(value);
}

// Tells whether an R2 key sits in a downloadable release namespace with no empty or dot segments.
export function isAllowedArtifactKey(value: unknown): value is string {
    return typeof value === "string"
        && value.length <= 1024
        && OBJECT_KEY.test(value)
        && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

// Extracts the artifact key from a public R2 URL, or null when the URL is off-origin or not allowlisted.
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
