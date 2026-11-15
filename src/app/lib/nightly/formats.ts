// Website-only formats. Contract wire formats live in supabase/functions/_shared/nightly/formats.ts.
import { SECRET_TOKEN_PATTERN } from "../../../../supabase/functions/_shared/nightly/formats";

/** The sponsor-portal session token carried in the `nightly_sponsor` cookie. */
export const SESSION_TOKEN_PATTERN = SECRET_TOKEN_PATTERN;
/** The `{error}` code of a failed Edge Function call. */
export const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
/** Longest Discord username the website carries or renders. */
const MAXIMUM_USERNAME_LENGTH = 100;

/** Whether a value is a non-empty username within the carried bound. */
export function isValidUsername(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= MAXIMUM_USERNAME_LENGTH;
}
