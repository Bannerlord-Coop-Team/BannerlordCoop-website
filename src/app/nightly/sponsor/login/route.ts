import { planSponsorLogin, redirectResponse } from "@/app/lib/nightly/routes";
import { getNightlyClient } from "@/app/lib/nightly/server";

export const dynamic = "force-dynamic";

/** `GET /nightly/sponsor/login`: starts Discord sign-in for the sponsor portal (302). */
export async function GET(request: Request) {
    return redirectResponse(await planSponsorLogin(getNightlyClient()), request.url);
}
