// Wire formats from docs/nightly-backend-contract.md, shared by the client decoders, cookie readers and route guards.

/** Contract secrets are 32 random bytes, base64url-encoded (43 characters). */
const SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/** The sponsor-portal session token carried in the `nightly_sponsor` cookie. */
export const SESSION_TOKEN_PATTERN = SECRET_TOKEN_PATTERN;
/** The OAuth `state` Discord echoes back to `/nightly/callback`. */
export const OAUTH_STATE_PATTERN = SECRET_TOKEN_PATTERN;
/** The installer's `XXXX-XXXX` user code from `A-Z2-9`. */
export const USER_CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/u;
/** A Discord user id (snowflake). */
export const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/u;
/** The opaque device id carried from `needs-sponsor` to the claim. */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
/** A sponsor code as the Edge Function issues it. */
export const SPONSOR_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u;
/** The `{error}` code of a failed Edge Function call. */
export const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
/** Longest Discord username the website carries or renders. */
export const MAXIMUM_USERNAME_LENGTH = 100;

/** Whether a value is a non-empty username within the carried bound. */
export function isValidUsername(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= MAXIMUM_USERNAME_LENGTH;
}
