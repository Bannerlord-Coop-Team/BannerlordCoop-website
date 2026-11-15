import "server-only";
import { sameOriginSubmission, servedHost } from "@/app/lib/auth/same-origin";
import type { ActionResult } from "@/app/lib/nightly/flows";
import { applyPlanCookies } from "@/app/lib/nightly/redirect-plan";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

/** Whether the current server-action post came from this site, judged on the host it was served on. */
export async function submittedFromThisSite(): Promise<boolean> {
    const requestHeaders = await headers();
    return sameOriginSubmission(requestHeaders, servedHost(requestHeaders));
}

/** Carries out a flow's decision: returns the form state, or sets the plan's cookies and redirects. */
export async function carryOut<State>(result: ActionResult<State>): Promise<State> {
    if ("state" in result) return result.state;
    const plan = result.redirect;
    applyPlanCookies(await cookies(), plan.cookies);
    redirect(plan.location);
}
