import type { PendingClaim } from "./client";
import {
    CLAIM_COOKIE,
    CLAIM_COOKIE_SECONDS,
    encodeClaimContext,
    nightlyCookieOptions,
    SPONSOR_COOKIE,
    type CookieOptions,
} from "./cookies";

/** One nightly cookie a redirect sets; a zero lifetime clears it. */
export type NightlyCookie = { name: string; value: string; maxAge: number };
/** Where a nightly route handler or server action sends the browser, plus any cookies it sets on the way. */
export type RedirectPlan = { location: string; cookies: NightlyCookie[] };
/** Any cookie store a plan's cookies can be written to: a route response's cookies or a server action's jar. */
export type CookieJar = { set(name: string, value: string, options: CookieOptions): unknown };

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

/** Writes each plan cookie to the jar with the shared nightly attributes; the one place plan cookies are set. */
export function applyPlanCookies(jar: CookieJar, cookies: readonly NightlyCookie[]): void {
    for (const cookie of cookies) jar.set(cookie.name, cookie.value, nightlyCookieOptions(cookie.maxAge));
}
