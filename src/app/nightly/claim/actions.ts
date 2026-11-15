"use server";

import { CLAIM_COOKIE, decodeClaimContext } from "@/app/lib/nightly/cookies";
import { claimActionResult, type ClaimFormState } from "@/app/lib/nightly/flows";
import { getNightlyClient } from "@/app/lib/nightly/server";
import { cookies } from "next/headers";
import { carryOut, submittedFromThisSite } from "../action-effects";

/** `POST /nightly/claim`: claims a sponsored seat for the device held in the claim cookie. */
export async function claimSponsorSeat(_state: ClaimFormState, form: FormData): Promise<ClaimFormState> {
    const request = {
        sameOrigin: await submittedFromThisSite(),
        claim: decodeClaimContext((await cookies()).get(CLAIM_COOKIE)?.value),
    };
    return carryOut(await claimActionResult(getNightlyClient(), request, form.get("sponsor_code")));
}
