import type { NightlyClient, SponsorPortalData } from "./client";
import { CLAIM_COOKIE, SPONSOR_COOKIE, type ClaimContext } from "./cookies";
import { DISCORD_SNOWFLAKE_PATTERN } from "./formats";
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

export type ClaimOutcome = { kind: "approved" } | { kind: "error"; message: string };

export type SponsorActionOutcome =
    | { kind: "code"; code: string }
    | { kind: "removed" }
    | { kind: "session-expired" }
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

const MAXIMUM_SPONSOR_CODE_LENGTH = 128;
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

/** Claims a sponsored seat for the pending device using a friend's sponsor code. */
export async function submitClaim(
    client: NightlyClient,
    claim: ClaimContext | null,
    sponsorCode: unknown,
): Promise<ClaimOutcome> {
    if (claim === null) return { kind: "error", message: INSTALLER_AUTHORIZATION_EXPIRED_MESSAGE };
    const code = typeof sponsorCode === "string" ? sponsorCode.trim().toUpperCase() : "";
    if (code.length === 0 || code.length > MAXIMUM_SPONSOR_CODE_LENGTH) {
        return { kind: "error", message: nightlyErrorMessage("claim", "invalid_sponsor_code") };
    }
    const result = await client.claimSponsorship(claim.deviceId, code);
    if (!result.ok) return { kind: "error", message: nightlyErrorMessage("claim", result.code) };
    return { kind: "approved" };
}

/** Rotates the sponsor code; the new code is returned once for display. */
export async function submitCreateCode(client: NightlyClient, session: string | null): Promise<SponsorActionOutcome> {
    if (session === null) return { kind: "session-expired" };
    const result = await client.createSponsorCode(session);
    if (result.ok) return { kind: "code", code: result.value };
    if (result.status === 401) return { kind: "session-expired" };
    return { kind: "error", message: nightlyErrorMessage("sponsor-code", result.code) };
}

/** Removes one sponsored Discord account from the sponsor's seats. */
export async function submitRemoveSeat(
    client: NightlyClient,
    session: string | null,
    discordUserId: unknown,
): Promise<SponsorActionOutcome> {
    if (session === null) return { kind: "session-expired" };
    if (typeof discordUserId !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(discordUserId)) {
        return { kind: "error", message: nightlyErrorMessage("sponsor-remove", "invalid_request") };
    }
    const result = await client.removeSponsoredAccount(session, discordUserId);
    if (result.ok) return { kind: "removed" };
    if (result.status === 401) return { kind: "session-expired" };
    return { kind: "error", message: nightlyErrorMessage("sponsor-remove", result.code) };
}

/** `POST /nightly/claim`: refuses cross-origin posts, otherwise claims the seat and clears the claim cookie on success. */
export async function claimActionResult(
    client: NightlyClient,
    request: ClaimActionRequest,
    sponsorCode: unknown,
): Promise<ActionResult<ClaimFormState>> {
    if (!request.sameOrigin) return { state: { error: GENERIC_ERROR_MESSAGE } };
    const outcome = await submitClaim(client, request.claim, sponsorCode);
    if (outcome.kind === "error") return { state: { error: outcome.message } };
    return { clearCookie: CLAIM_COOKIE, redirectTo: "/nightly/approved?via=sponsor" };
}

/** `POST /nightly/sponsor` (create code): refuses cross-origin posts, returns the new code once or leaves an expired session. */
export async function createCodeActionResult(
    client: NightlyClient,
    request: SponsorActionRequest,
): Promise<ActionResult<CreateCodeState>> {
    if (!request.sameOrigin) return { state: { code: null, error: GENERIC_ERROR_MESSAGE } };
    const outcome = await submitCreateCode(client, request.session);
    if (outcome.kind === "session-expired") return SESSION_EXPIRED_RESULT;
    if (outcome.kind === "code") return { state: { code: outcome.code, error: null } };
    return { state: { code: null, error: outcomeError(outcome) } };
}

/** `POST /nightly/sponsor` (remove seat): refuses cross-origin posts, reloads the seats on success or leaves an expired session. */
export async function removeSeatActionResult(
    client: NightlyClient,
    request: SponsorActionRequest,
    discordUserId: unknown,
): Promise<ActionResult<RemoveSeatState>> {
    if (!request.sameOrigin) return { state: { error: GENERIC_ERROR_MESSAGE } };
    const outcome = await submitRemoveSeat(client, request.session, discordUserId);
    if (outcome.kind === "session-expired") return SESSION_EXPIRED_RESULT;
    if (outcome.kind === "removed") return { clearCookie: null, redirectTo: "/nightly/sponsor" };
    return { state: { error: outcomeError(outcome) } };
}

/** The message to show for an outcome that neither succeeded nor expired the session. */
function outcomeError(outcome: SponsorActionOutcome): string {
    if (outcome.kind === "error") return outcome.message;
    return GENERIC_ERROR_MESSAGE;
}
