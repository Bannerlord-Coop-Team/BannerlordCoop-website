import { planSponsorLogout, redirectResponse } from "@/app/lib/nightly/routes";

export const dynamic = "force-dynamic";

/** `GET /nightly/sponsor/logout`: clears an expired sponsor session cookie and returns to the login prompt. */
export function GET(request: Request) {
    return redirectResponse(planSponsorLogout(), request.url);
}
