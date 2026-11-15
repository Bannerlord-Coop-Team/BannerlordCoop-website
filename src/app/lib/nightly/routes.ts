import type { NightlyClient, NightlyResult, OAuthOutcome } from "./client";
import {
    CLAIM_COOKIE,
    CLAIM_COOKIE_SECONDS,
    encodeClaimContext,
    serializeNightlyCookie,
    SPONSOR_COOKIE,
    SPONSOR_SESSION_SECONDS,
} from "./cookies";
import type { NightlyErrorContext } from "./messages";

/** Where a nightly GET route sends the browser, plus any cookies it sets on the way. */
export type RedirectPlan = { location: string; cookies: string[] };

const USER_CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/u;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
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
    if (!code || code.length > MAXIMUM_OAUTH_CODE_LENGTH || !state || !STATE_PATTERN.test(state)) {
        return plan(errorPath("callback", "invalid_request"));
    }
    const result = await client.completeOAuth(code, state);
    if (!result.ok) return plan(errorPath("callback", result.code));
    return planOutcome(result.value);
}

/** Maps each `/oauth/complete` outcome to its page and cookies. */
export function planOutcome(outcome: OAuthOutcome): RedirectPlan {
    if (outcome.outcome === "approved") return plan("/nightly/approved");
    if (outcome.outcome === "sponsored-approved") return plan("/nightly/approved?via=sponsor");
    if (outcome.outcome === "portal") {
        return plan("/nightly/sponsor", [serializeNightlyCookie(SPONSOR_COOKIE, outcome.session, SPONSOR_SESSION_SECONDS)]);
    }
    const claim = encodeClaimContext({
        deviceId: outcome.device_id,
        username: outcome.username,
        previousSponsorRevoked: outcome.previous_sponsor_revoked,
    });
    return plan("/nightly/claim", [serializeNightlyCookie(CLAIM_COOKIE, claim, CLAIM_COOKIE_SECONDS)]);
}

/** Handles `GET /nightly/sponsor/logout`: drops an expired sponsor session and returns to the login prompt. */
export function planSponsorLogout(): RedirectPlan {
    return plan("/nightly/sponsor?session=expired", [serializeNightlyCookie(SPONSOR_COOKIE, "", 0)]);
}

/** Converts a plan into a no-store 302 response on the request's origin. */
export function redirectResponse(redirect: RedirectPlan, requestUrl: string): Response {
    const headers = new Headers({
        location: new URL(redirect.location, requestUrl).href,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
    });
    for (const cookie of redirect.cookies) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
}

/** Redirects to Discord on success, otherwise to the matching error page. */
function planAuthorize(result: NightlyResult<string>, context: NightlyErrorContext): RedirectPlan {
    if (!result.ok) return plan(errorPath(context, result.code));
    return plan(result.value);
}

/** Creates a redirect plan. */
function plan(location: string, cookies: string[] = []): RedirectPlan {
    return { location, cookies };
}
