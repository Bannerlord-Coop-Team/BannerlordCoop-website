import type { PendingClaim } from "./client";
import { CLAIM_COOKIE, CLAIM_COOKIE_SECONDS, encodeClaimContext, SPONSOR_COOKIE } from "./cookies";

/** One nightly cookie a redirect sets; a zero lifetime clears it. */
export type NightlyCookie = { name: string; value: string; maxAge: number };
/** Where a nightly route handler or server action sends the browser, plus any cookies it sets on the way. */
export type RedirectPlan = { location: string; cookies: NightlyCookie[] };

/** Builds a redirect plan to a location that sets the given cookies on the way. */
export function redirectPlan(location: string, ...cookies: NightlyCookie[]): RedirectPlan {
    return { location, cookies };
}

/** A cookie write that expires the named nightly cookie. */
export function clearedCookie(name: string): NightlyCookie {
    return { name, value: "", maxAge: 0 };
}

/** The sponsor session cookie, living as long as the Edge Function said the session does. */
export function sponsorSessionCookie(session: string, lifetimeSeconds: number): NightlyCookie {
    return { name: SPONSOR_COOKIE, value: session, maxAge: lifetimeSeconds };
}

/** The claim cookie carrying a pending claim to the claim form for as long as the device session lasts. */
export function claimCookie(claim: PendingClaim): NightlyCookie {
    return { name: CLAIM_COOKIE, value: encodeClaimContext(claim), maxAge: CLAIM_COOKIE_SECONDS };
}
