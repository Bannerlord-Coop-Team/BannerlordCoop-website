// The query flags nightly redirects set and nightly pages read back: one owner for each path and its reader.
import { NIGHTLY_ERROR_CONTEXTS, type NightlyErrorContext } from "./messages";

/** A page's resolved search params, as Next.js passes them. */
export type PageSearchParams = Readonly<Record<string, string | string[] | undefined>>;

const SESSION_FLAG = "session";
const SESSION_EXPIRED_VALUE = "expired";
const VIA_FLAG = "via";
const VIA_SPONSOR_VALUE = "sponsor";
const ERROR_PAGE_PATH = "/nightly/error";
const CONTEXT_PARAM = "context";
const CODE_PARAM = "code";

/** The error page's query once narrowed: a known context (null when unknown) and a single code (empty when not). */
export type ErrorQuery = { context: NightlyErrorContext | null; code: string };

/** Where a sponsor action sends the browser after it dropped an expired session. */
export const SESSION_EXPIRED_PATH = `/nightly/sponsor?${SESSION_FLAG}=${SESSION_EXPIRED_VALUE}`;
/** Where a sponsor-code claim, or a sponsored login, lands once the device is approved. */
export const SPONSORED_APPROVED_PATH = `/nightly/approved?${VIA_FLAG}=${VIA_SPONSOR_VALUE}`;

/** Whether the sponsor page was reached through `SESSION_EXPIRED_PATH`. */
export function isSessionExpiredNotice(params: PageSearchParams): boolean {
    return params[SESSION_FLAG] === SESSION_EXPIRED_VALUE;
}

/** Whether the approved page was reached through `SPONSORED_APPROVED_PATH`. */
export function isSponsoredApproval(params: PageSearchParams): boolean {
    return params[VIA_FLAG] === VIA_SPONSOR_VALUE;
}

/** Builds the error-page path for one context and sanitized code. */
export function errorPath(context: NightlyErrorContext, code: string): string {
    return `${ERROR_PAGE_PATH}?${new URLSearchParams({ [CONTEXT_PARAM]: context, [CODE_PARAM]: code })}`;
}

/** Reads the query `errorPath` wrote; a repeated or missing value narrows to no context or an empty code. */
export function readErrorQuery(params: PageSearchParams): ErrorQuery {
    const code = params[CODE_PARAM];
    return { context: parseErrorContext(params[CONTEXT_PARAM]), code: typeof code === "string" ? code : "" };
}

/** Narrows an untrusted query value to a known error context. */
function parseErrorContext(value: string | string[] | undefined): NightlyErrorContext | null {
    return NIGHTLY_ERROR_CONTEXTS.find((context) => context === value) ?? null;
}
