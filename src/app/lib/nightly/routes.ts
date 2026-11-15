import { NextResponse } from "next/server";
import {
    MAXIMUM_OAUTH_CODE_LENGTH,
    normalizeUserCode,
    USER_CODE_PATTERN,
} from "../../../../supabase/functions/_shared/nightly/formats";
import type { NightlyClient, NightlyResult, OAuthOutcome } from "./client";
import { OAUTH_STATE_PATTERN } from "./formats";
import type { NightlyErrorContext } from "./messages";
import { errorPath, SPONSORED_APPROVED_PATH } from "./query-flags";
import { applyPlanCookies, claimCookie, redirectPlan, sponsorSessionCookie, type RedirectPlan } from "./redirect-plan";

/** Handles `GET /nightly/activate?code=`: starts device OAuth or explains why the code cannot be used. */
export async function planActivate(params: URLSearchParams, client: NightlyClient): Promise<RedirectPlan> {
    const userCode = normalizeUserCode(params.get("code") ?? "");
    if (!USER_CODE_PATTERN.test(userCode)) return redirectPlan(errorPath("activate", "invalid_code"));
    return planAuthorize(await client.startDeviceOAuth(userCode), "activate");
}

/** Handles `GET /nightly/sponsor/login`: starts sponsor-portal OAuth. */
export async function planSponsorLogin(client: NightlyClient): Promise<RedirectPlan> {
    return planAuthorize(await client.startSponsorOAuth(), "sponsor-login");
}

/** Handles `GET /nightly/callback`: completes OAuth once, then redirects so a refresh never replays the code. */
export async function planCallback(params: URLSearchParams, client: NightlyClient): Promise<RedirectPlan> {
    const code = params.get("code") ?? "";
    const state = params.get("state") ?? "";
    if (!isWellFormedCallback(code, state)) return redirectPlan(errorPath("callback", "invalid_request"));
    const result = await client.completeOAuth(code, state);
    if (!result.ok) return redirectPlan(errorPath("callback", result.code));
    return planOutcome(result.value);
}

/** Maps each `/oauth/complete` outcome to its page and cookies; the sponsor cookie lives as long as the Edge Function says. */
export function planOutcome(outcome: OAuthOutcome): RedirectPlan {
    switch (outcome.outcome) {
        case "approved":
            return redirectPlan("/nightly/approved");
        case "sponsored-approved":
            return redirectPlan(SPONSORED_APPROVED_PATH);
        case "portal":
            return redirectPlan("/nightly/sponsor", sponsorSessionCookie(outcome.session, outcome.expiresIn));
        case "needs-sponsor":
            return redirectPlan("/nightly/claim", claimCookie(outcome.claim));
    }
}

/** Converts a plan into a no-store 302 on the request's origin, setting each cookie with the shared nightly attributes. */
export function redirectResponse(redirect: RedirectPlan, requestUrl: string): NextResponse {
    const response = NextResponse.redirect(new URL(redirect.location, requestUrl), 302);
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    applyPlanCookies(response.cookies, redirect.cookies);
    return response;
}

/** Whether Discord's callback carries a non-empty, bounded OAuth code and a well-formed state. */
function isWellFormedCallback(code: string, state: string): boolean {
    if (code.length === 0 || code.length > MAXIMUM_OAUTH_CODE_LENGTH) return false;
    return OAUTH_STATE_PATTERN.test(state);
}

/** Redirects to Discord on success, otherwise to the matching error page. */
function planAuthorize(result: NightlyResult<string>, context: NightlyErrorContext): RedirectPlan {
    if (!result.ok) return redirectPlan(errorPath(context, result.code));
    return redirectPlan(result.value);
}
