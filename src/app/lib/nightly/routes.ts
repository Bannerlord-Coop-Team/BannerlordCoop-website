import { NextResponse } from "next/server";
import { USER_CODE_PATTERN } from "../../../../supabase/functions/_shared/nightly/formats";
import type { NightlyClient, NightlyResult, OAuthOutcome } from "./client";
import {
    CLAIM_COOKIE,
    CLAIM_COOKIE_SECONDS,
    encodeClaimContext,
    nightlyCookieOptions,
    SPONSOR_COOKIE,
} from "./cookies";
import { OAUTH_STATE_PATTERN } from "./formats";
import type { NightlyErrorContext } from "./messages";

/** One nightly cookie a redirect sets; a zero lifetime clears it. */
export type NightlyCookie = { name: string; value: string; maxAge: number };
/** Where a nightly GET route sends the browser, plus any cookies it sets on the way. */
export type RedirectPlan = { location: string; cookies: NightlyCookie[] };

const MAXIMUM_OAUTH_CODE_LENGTH = 512;

/** Builds the error-page path for one context and sanitized code. */
export function errorPath(context: NightlyErrorContext, code: string): string {
    return `/nightly/error?${new URLSearchParams({ context, code })}`;
}

/** Handles `GET /nightly/activate?code=`: starts device OAuth or explains why the code cannot be used. */
export async function planActivate(params: URLSearchParams, client: NightlyClient): Promise<RedirectPlan> {
    const userCode = params.get("code")?.trim().toUpperCase();
    if (!userCode || !USER_CODE_PATTERN.test(userCode)) return plan(errorPath("activate", "invalid_code"));
    return planAuthorize(await client.startDeviceOAuth(userCode), "activate");
}

/** Handles `GET /nightly/sponsor/login`: starts sponsor-portal OAuth. */
export async function planSponsorLogin(client: NightlyClient): Promise<RedirectPlan> {
    return planAuthorize(await client.startSponsorOAuth(), "sponsor-login");
}

/** Handles `GET /nightly/callback`: completes OAuth once, then redirects so a refresh never replays the code. */
export async function planCallback(params: URLSearchParams, client: NightlyClient): Promise<RedirectPlan> {
    const code = params.get("code");
    const state = params.get("state");
    if (!code || code.length > MAXIMUM_OAUTH_CODE_LENGTH || !state || !OAUTH_STATE_PATTERN.test(state)) {
        return plan(errorPath("callback", "invalid_request"));
    }
    const result = await client.completeOAuth(code, state);
    if (!result.ok) return plan(errorPath("callback", result.code));
    return planOutcome(result.value);
}

/** Maps each `/oauth/complete` outcome to its page and cookies; the sponsor cookie lives as long as the Edge Function says. */
export function planOutcome(outcome: OAuthOutcome): RedirectPlan {
    if (outcome.outcome === "approved") return plan("/nightly/approved");
    if (outcome.outcome === "sponsored-approved") return plan("/nightly/approved?via=sponsor");
    if (outcome.outcome === "portal") {
        return plan("/nightly/sponsor", [{ name: SPONSOR_COOKIE, value: outcome.session, maxAge: outcome.expires_in }]);
    }
    const claim = encodeClaimContext(outcome.claim);
    return plan("/nightly/claim", [{ name: CLAIM_COOKIE, value: claim, maxAge: CLAIM_COOKIE_SECONDS }]);
}

/** Handles `GET /nightly/sponsor/logout`: drops an expired sponsor session and returns to the login prompt. */
export function planSponsorLogout(): RedirectPlan {
    return plan("/nightly/sponsor?session=expired", [{ name: SPONSOR_COOKIE, value: "", maxAge: 0 }]);
}

/** Converts a plan into a no-store 302 on the request's origin, setting each cookie with the shared nightly attributes. */
export function redirectResponse(redirect: RedirectPlan, requestUrl: string): NextResponse {
    const response = NextResponse.redirect(new URL(redirect.location, requestUrl), 302);
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    for (const cookie of redirect.cookies) {
        response.cookies.set(cookie.name, cookie.value, nightlyCookieOptions(cookie.maxAge));
    }
    return response;
}

/** Redirects to Discord on success, otherwise to the matching error page. */
function planAuthorize(result: NightlyResult<string>, context: NightlyErrorContext): RedirectPlan {
    if (!result.ok) return plan(errorPath(context, result.code));
    return plan(result.value);
}

/** Creates a redirect plan. */
function plan(location: string, cookies: NightlyCookie[] = []): RedirectPlan {
    return { location, cookies };
}
