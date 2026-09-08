import { PATREON_COOKIE, LINK_COOKIE_OPTIONS } from "@/app/lib/auth/account-link";
import { NextRequest, NextResponse } from "next/server";

// GET holds completion authority in an owner-only cookie; only an authenticated
// explicit Server Action can commit it. Query strings never indicate link status.
export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get("token");
    const valid = token !== null && /^[a-f0-9]{64}$/u.test(token);
    const response = NextResponse.redirect(new URL(`/account?patreon=${valid ? "confirm" : "error"}`, request.url), 303);
    if (valid) response.cookies.set(PATREON_COOKIE, token, LINK_COOKIE_OPTIONS);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
}
