// The query flags nightly redirects set and nightly pages read back: one owner for each path and its reader.

/** A page's resolved search params, as Next.js passes them. */
export type PageSearchParams = Readonly<Record<string, string | string[] | undefined>>;

const SESSION_FLAG = "session";
const SESSION_EXPIRED_VALUE = "expired";
const VIA_FLAG = "via";
const VIA_SPONSOR_VALUE = "sponsor";

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
