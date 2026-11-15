"use server";

import { readSponsorSession, SPONSOR_COOKIE } from "@/app/lib/nightly/cookies";
import {
    createCodeActionResult,
    removeSeatActionResult,
    type CreateCodeState,
    type RemoveSeatState,
    type SponsorActionRequest,
} from "@/app/lib/nightly/flows";
import { SEAT_USER_FIELD } from "@/app/lib/nightly/form-fields";
import { getNightlyClient } from "@/app/lib/nightly/server";
import { cookies } from "next/headers";
import { carryOut, submittedFromThisSite } from "../action-effects";

/** `POST /nightly/sponsor` (create code): rotates the sponsor code and returns it for one-time display. */
export async function createSponsorCode(): Promise<CreateCodeState> {
    return carryOut(await createCodeActionResult(getNightlyClient(), await sponsorRequest()));
}

/** `POST /nightly/sponsor` (remove seat): removes one sponsored account, then reloads the seat list. */
export async function removeSponsoredSeat(_state: RemoveSeatState, form: FormData): Promise<RemoveSeatState> {
    return carryOut(await removeSeatActionResult(getNightlyClient(), await sponsorRequest(), form.get(SEAT_USER_FIELD)));
}

/** Reads the origin verdict and the sponsor session cookie, rejecting malformed session values. */
async function sponsorRequest(): Promise<SponsorActionRequest> {
    return {
        sameOrigin: await submittedFromThisSite(),
        session: readSponsorSession((await cookies()).get(SPONSOR_COOKIE)?.value),
    };
}
