// Wire formats of the nightly gateway contract (docs/nightly-backend-contract.md), shared by the Edge Function
// and the website. Dependency-free on purpose so Next.js can import it without Deno or Node built-ins.

/** Contract secrets (device code, access token, OAuth state, sponsor session): 32 random bytes, base64url (43 chars). */
export const SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
/** The installer's `XXXX-XXXX` user code from the unambiguous `A-Z2-9` alphabet. */
export const USER_CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/u;
/** A sponsor code as issued: three groups of four from the same alphabet. */
export const SPONSOR_CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/u;
/** Longest Discord OAuth authorization code accepted on the callback. */
export const MAXIMUM_OAUTH_CODE_LENGTH = 512;
/** Longest sponsor code text accepted from a form before normalization. */
export const MAXIMUM_SPONSOR_CODE_LENGTH = 128;
/** Device session ids are lowercase RFC 4122 UUIDs. */
export const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** A Discord user id (snowflake). */
export const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/u;
/** Header carrying the shared secret on every website-to-Edge-Function request. */
export const WEBSITE_KEY_HEADER = "x-nightly-website-key";

/** Whether a value is a Discord snowflake ID string. */
export function isDiscordSnowflake(value: unknown): value is string {
    return typeof value === "string" && DISCORD_SNOWFLAKE_PATTERN.test(value);
}

/** Normalizes a typed installer user code before validation, so case and padding do not matter. */
export function normalizeUserCode(value: string): string {
    return value.trim().toUpperCase();
}

/** Normalizes a typed sponsor code before validation and hashing, so case and padding do not matter. */
export function normalizeSponsorCode(value: string): string {
    return value.trim().toUpperCase();
}
