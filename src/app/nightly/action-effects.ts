import "server-only";
import { sameOriginSubmission, servedHost } from "@/app/lib/auth/same-origin";
import { nightlyCookieOptions } from "@/app/lib/nightly/cookies";
import type { ActionResult } from "@/app/lib/nightly/flows";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

/** Whether the current server-action post came from this site, judged on the host it was served on. */
export async function submittedFromThisSite(): Promise<boolean> {
    const requestHeaders = await headers();
    return sameOriginSubmission(requestHeaders, servedHost(requestHeaders));
}

/** Carries out a flow's decision: returns the form state, or clears the named cookie and redirects. */
export async function carryOut<State>(result: ActionResult<State>): Promise<State> {
    if ("state" in result) return result.state;
    if (result.clearCookie !== null) (await cookies()).set(result.clearCookie, "", nightlyCookieOptions(0));
    redirect(result.redirectTo);
}
