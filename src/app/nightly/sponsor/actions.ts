"use server";

import type { CreateCodeState, RemoveSeatState } from "@/app/components/nightly/SponsorPortalForms";
import { nightlyCookieOptions, readSponsorSession, SPONSOR_COOKIE } from "@/app/lib/nightly/cookies";
import { submitCreateCode, submitRemoveSeat, type SponsorActionOutcome } from "@/app/lib/nightly/flows";
import { GENERIC_ERROR_MESSAGE } from "@/app/lib/nightly/messages";
import { isSameOriginSubmission } from "@/app/lib/nightly/same-origin";
import { getNightlyClient } from "@/app/lib/nightly/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

/** `POST /nightly/sponsor` (create code): rotates the sponsor code and returns it for one-time display. */
export async function createSponsorCode(): Promise<CreateCodeState> {
    if (!isSameOriginSubmission(await headers())) return { code: null, error: GENERIC_ERROR_MESSAGE };
    const outcome = await submitCreateCode(getNightlyClient(), await currentSession());
    await leaveIfSessionExpired(outcome);
    if (outcome.kind === "code") return { code: outcome.code, error: null };
    return { code: null, error: outcome.kind === "error" ? outcome.message : GENERIC_ERROR_MESSAGE };
}

/** `POST /nightly/sponsor` (remove seat): removes one sponsored account, then reloads the seat list. */
export async function removeSponsoredSeat(_state: RemoveSeatState, form: FormData): Promise<RemoveSeatState> {
    if (!isSameOriginSubmission(await headers())) return { error: GENERIC_ERROR_MESSAGE };
    const outcome = await submitRemoveSeat(getNightlyClient(), await currentSession(), form.get("discord_user_id"));
    await leaveIfSessionExpired(outcome);
    if (outcome.kind === "removed") redirect("/nightly/sponsor");
    return { error: outcome.kind === "error" ? outcome.message : GENERIC_ERROR_MESSAGE };
}

/** Reads the sponsor session cookie, rejecting malformed values. */
async function currentSession(): Promise<string | null> {
    return readSponsorSession((await cookies()).get(SPONSOR_COOKIE)?.value);
}

/** On a 401 (or missing session) clears the cookie and sends the sponsor back to the login prompt. */
async function leaveIfSessionExpired(outcome: SponsorActionOutcome): Promise<void> {
    if (outcome.kind !== "session-expired") return;
    (await cookies()).set(SPONSOR_COOKIE, "", nightlyCookieOptions(0));
    redirect("/nightly/sponsor?session=expired");
}
