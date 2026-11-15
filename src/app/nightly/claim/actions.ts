"use server";

import { readClaimCookie } from "@/app/lib/nightly/cookies";
import { claimActionResult, type ClaimFormState } from "@/app/lib/nightly/flows";
import { SPONSOR_CODE_FIELD } from "@/app/lib/nightly/form-fields";
import { getNightlyClient } from "@/app/lib/nightly/server";
import { cookies } from "next/headers";
import { carryOut, submittedFromThisSite } from "../action-effects";

/** `POST /nightly/claim`: claims a sponsored seat for the device held in the claim cookie. */
export async function claimSponsorSeat(_state: ClaimFormState, form: FormData): Promise<ClaimFormState> {
    const request = {
        sameOrigin: await submittedFromThisSite(),
        claim: readClaimCookie(await cookies()),
    };
    return carryOut(await claimActionResult(getNightlyClient(), request, form.get(SPONSOR_CODE_FIELD)));
}
