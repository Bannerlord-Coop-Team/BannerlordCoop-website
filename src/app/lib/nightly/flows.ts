import {
    DISCORD_SNOWFLAKE_PATTERN,
    MAXIMUM_SPONSOR_CODE_LENGTH,
    normalizeSponsorCode,
} from "../../../../supabase/functions/_shared/nightly/formats";
import type { NightlyClient, SponsorPortalData } from "./client";
import { CLAIM_COOKIE, SPONSOR_COOKIE, type ClaimContext } from "./cookies";
import {
    GENERIC_ERROR_MESSAGE,
    INSTALLER_AUTHORIZATION_EXPIRED_MESSAGE,
    nightlyErrorMessage,
    ROLE_REQUIRED_MESSAGE,
} from "./messages";

/** What `GET /nightly/sponsor` renders for the current cookie and portal response. */
export type PortalView =
    | { kind: "login"; expired: boolean }
    | { kind: "seats"; data: SponsorPortalData }
    | { kind: "clear-session" }
    | { kind: "ineligible"; message: string }
    | { kind: "error"; message: string };

/** Form state of the sponsor-code claim form. */
export type ClaimFormState = { error: string | null };
/** Form state of the create-code form; the code is shown once. */
export type CreateCodeState = { code: string | null; error: string | null };
/** Form state of a remove-seat form. */
export type RemoveSeatState = { error: string | null };

/** What a server action carries out: re-render its form with a state, or clear a cookie (if any) and redirect. */
export type ActionResult<State> = { state: State } | { clearCookie: string | null; redirectTo: string };

/** What the claim action read from Next before deciding: the origin verdict and the decoded claim cookie. */
export type ClaimActionRequest = { sameOrigin: boolean; claim: ClaimContext | null };
/** What a sponsor action read from Next before deciding: the origin verdict and the sponsor session cookie. */
export type SponsorActionRequest = { sameOrigin: boolean; session: string | null };

const SESSION_EXPIRED_RESULT = { clearCookie: SPONSOR_COOKIE, redirectTo: "/nightly/sponsor?session=expired" } as const;

/** Loads the sponsor portal: no session shows login, 401 clears the session once, 403 explains lost eligibility. */
export async function loadPortalView(
    client: NightlyClient,
    session: string | null,
    alreadyCleared: boolean,
): Promise<PortalView> {
    if (session === null) return { kind: "login", expired: alreadyCleared };
    const result = await client.sponsorPortal(session);
    if (result.ok) return { kind: "seats", data: result.value };
    // A second 401 right after clearing means the cookie could not be removed; show login instead of looping.
    if (result.status === 401) return alreadyCleared ? { kind: "login", expired: true } : { kind: "clear-session" };
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
    return { clearCookie: CLAIM_COOKIE, redirectTo: "/nightly/approved?via=sponsor" };
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
    if (typeof discordUserId !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(discordUserId)) {
        return { state: { error: nightlyErrorMessage("sponsor-remove", "invalid_request") } };
    }
    const result = await client.removeSponsoredAccount(request.session, discordUserId);
    if (result.ok) return { clearCookie: null, redirectTo: "/nightly/sponsor" };
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
