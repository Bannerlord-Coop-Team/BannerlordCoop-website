"use server";

import type { ClaimFormState } from "@/app/components/nightly/SponsorClaimForm";
import { CLAIM_COOKIE, decodeClaimContext, nightlyCookieOptions } from "@/app/lib/nightly/cookies";
import { submitClaim } from "@/app/lib/nightly/flows";
import { GENERIC_ERROR_MESSAGE } from "@/app/lib/nightly/messages";
import { isSameOriginSubmission } from "@/app/lib/nightly/same-origin";
import { getNightlyClient } from "@/app/lib/nightly/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

/** `POST /nightly/claim`: claims a sponsored seat for the device held in the claim cookie. */
export async function claimSponsorSeat(_state: ClaimFormState, form: FormData): Promise<ClaimFormState> {
    if (!isSameOriginSubmission(await headers())) return { error: GENERIC_ERROR_MESSAGE };
    const jar = await cookies();
    const claim = decodeClaimContext(jar.get(CLAIM_COOKIE)?.value);
    const outcome = await submitClaim(getNightlyClient(), claim, form.get("sponsor_code"));
    if (outcome.kind === "error") return { error: outcome.message };
    jar.set(CLAIM_COOKIE, "", nightlyCookieOptions(0));
    redirect("/nightly/approved?via=sponsor");
}
