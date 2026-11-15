import { DISCORD_SNOWFLAKE_PATTERN, type NightlyClient, type SponsorPortalData } from "./client";
import type { ClaimContext } from "./cookies";
import { INSTALLER_AUTHORIZATION_EXPIRED_MESSAGE, nightlyErrorMessage, ROLE_REQUIRED_MESSAGE } from "./messages";

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

const MAXIMUM_SPONSOR_CODE_LENGTH = 128;

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
