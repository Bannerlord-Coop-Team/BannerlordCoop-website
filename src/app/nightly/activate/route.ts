import { planActivate, redirectResponse } from "@/app/lib/nightly/routes";
import { getNightlyClient } from "@/app/lib/nightly/server";

export const dynamic = "force-dynamic";

/** `GET /nightly/activate?code=`: starts Discord sign-in for an installer code (302), or shows why it cannot. */
export async function GET(request: Request) {
    const plan = await planActivate(new URL(request.url).searchParams, getNightlyClient());
    return redirectResponse(plan, request.url);
}
