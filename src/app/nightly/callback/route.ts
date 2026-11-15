import { planCallback, redirectResponse } from "@/app/lib/nightly/routes";
import { getNightlyClient } from "@/app/lib/nightly/server";

export const dynamic = "force-dynamic";

/** `GET /nightly/callback`: the registered Discord redirect; completes OAuth and forwards to the outcome page. */
export async function GET(request: Request) {
    const plan = await planCallback(new URL(request.url).searchParams, getNightlyClient());
    return redirectResponse(plan, request.url);
}
