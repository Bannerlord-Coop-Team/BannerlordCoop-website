import {
    isDiscordSnowflake,
    MAXIMUM_SPONSOR_CODE_LENGTH,
    normalizeSponsorCode,
} from "../../../../supabase/functions/_shared/nightly/formats";
import type { NightlyClient, PendingClaim, SponsorPortalData } from "./client";
import { CLAIM_COOKIE, SPONSOR_COOKIE } from "./cookies";
import {
    GENERIC_ERROR_MESSAGE,
    INSTALLER_AUTHORIZATION_EXPIRED_MESSAGE,
    nightlyErrorMessage,
    ROLE_REQUIRED_MESSAGE,
} from "./messages";
import { SESSION_EXPIRED_PATH, SPONSORED_APPROVED_PATH } from "./query-flags";
import type { NightlyCookie, RedirectPlan } from "./routes";

/** What `GET /nightly/sponsor` renders for the current cookie and portal response. */
export type PortalView =
    | { kind: "login"; expired: boolean }
    | { kind: "seats"; data: SponsorPortalData }
    | { kind: "ineligible"; message: string }
    | { kind: "error"; message: string };

/** Form state of the sponsor-code claim form. */
export type ClaimFormState = { error: string | null };
/** Form state of the create-code form; the code is shown once. */
export type CreateCodeState = { code: string | null; error: string | null };
/** Form state of a remove-seat form. */
export type RemoveSeatState = { error: string | null };

/** A server action's redirect: set the plan's cookies, then send the browser to its location. */
export type ActionRedirect = { redirect: RedirectPlan };
/** What a server action carries out: re-render its form with a state, or follow a redirect plan. */
export type ActionResult<State> = { state: State } | ActionRedirect;

/** What the claim action read from Next before deciding: the origin verdict and the decoded claim cookie. */
export type ClaimActionRequest = { sameOrigin: boolean; claim: PendingClaim | null };
/** What a sponsor action read from Next before deciding: the origin verdict and the sponsor session cookie. */
export type SponsorActionRequest = { sameOrigin: boolean; session: string | null };

// Server actions can write cookies, so an expired session is dropped here and the login prompt says why.
const SESSION_EXPIRED_RESULT = redirectTo(SESSION_EXPIRED_PATH, clearedCookie(SPONSOR_COOKIE));

/**
 * Loads the sponsor portal: no session shows login (with the notice an action that dropped the session asked for),
 * 401 shows login with the expired notice, 403 explains lost eligibility.
 */
export async function loadPortalView(client: NightlyClient, session: string | null, expiredNotice: boolean): Promise<PortalView> {
    if (session === null) return { kind: "login", expired: expiredNotice };
    const result = await client.sponsorPortal(session);
    if (result.ok) return { kind: "seats", data: result.value };
    // Pages cannot write cookies; the stale HttpOnly session is overwritten at the next portal login.
    if (result.status === 401) return { kind: "login", expired: true };
    if (result.status === 403) return { kind: "ineligible", message: ROLE_REQUIRED_MESSAGE };
    return { kind: "error", message: nightlyErrorMessage("sponsor-login", result.code) };
}

/** `POST /nightly/claim`: claims a seat for the cookie's device with a friend's code, clearing the claim cookie on success. */
export async function claimActionResult(
    client: NightlyClient,
    request: ClaimActionRequest,
    sponsorCode: unknown,
): Promise<ActionResult<ClaimFormState>> {
    if (!request.sameOrigin) return { state: { error: GENERIC_ERROR_MESSAGE } };
    if (request.claim === null) return { state: { error: INSTALLER_AUTHORIZATION_EXPIRED_MESSAGE } };
    const code = usableSponsorCode(sponsorCode);
    if (code === null) return { state: { error: nightlyErrorMessage("claim", "invalid_sponsor_code") } };
    const result = await client.claimSponsorship(request.claim.deviceId, code);
    if (!result.ok) return { state: { error: nightlyErrorMessage("claim", result.code) } };
    return redirectTo(SPONSORED_APPROVED_PATH, clearedCookie(CLAIM_COOKIE));
}

/** `POST /nightly/sponsor` (create code): rotates the sponsor code and returns it once, or leaves an expired session. */
export async function createCodeActionResult(
    client: NightlyClient,
    request: SponsorActionRequest,
): Promise<ActionResult<CreateCodeState>> {
    if (!request.sameOrigin) return { state: { code: null, error: GENERIC_ERROR_MESSAGE } };
    if (request.session === null) return SESSION_EXPIRED_RESULT;
    const result = await client.createSponsorCode(request.session);
    if (result.ok) return { state: { code: result.value, error: null } };
    if (result.status === 401) return SESSION_EXPIRED_RESULT;
    return { state: { code: null, error: nightlyErrorMessage("sponsor-code", result.code) } };
}

/** `POST /nightly/sponsor` (remove seat): removes one sponsored account and reloads the seats, or leaves an expired session. */
export async function removeSeatActionResult(
    client: NightlyClient,
    request: SponsorActionRequest,
    discordUserId: unknown,
): Promise<ActionResult<RemoveSeatState>> {
    if (!request.sameOrigin) return { state: { error: GENERIC_ERROR_MESSAGE } };
    if (request.session === null) return SESSION_EXPIRED_RESULT;
    if (!isDiscordSnowflake(discordUserId)) {
        return { state: { error: nightlyErrorMessage("sponsor-remove", "invalid_request") } };
    }
    const result = await client.removeSponsoredAccount(request.session, discordUserId);
    if (result.ok) return redirectTo("/nightly/sponsor");
    if (result.status === 401) return SESSION_EXPIRED_RESULT;
    return { state: { error: nightlyErrorMessage("sponsor-remove", result.code) } };
}

/** Normalizes a submitted sponsor code with the Edge Function's bounds; null when it is missing, blank or too long. */
function usableSponsorCode(value: unknown): string | null {
    if (typeof value !== "string" || value.length > MAXIMUM_SPONSOR_CODE_LENGTH) return null;
    const code = normalizeSponsorCode(value);
    if (code.length === 0) return null;
    return code;
}

/** Builds an action redirect that sets the given cookies on the way. */
function redirectTo(location: string, ...cookies: NightlyCookie[]): ActionRedirect {
    return { redirect: { location, cookies } };
}

/** A cookie write that expires the named nightly cookie. */
function clearedCookie(name: string): NightlyCookie {
    return { name, value: "", maxAge: 0 };
}
