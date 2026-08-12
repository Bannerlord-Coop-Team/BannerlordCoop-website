import { getSafeDestination } from "@/app/lib/auth/redirect";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const code = searchParams.get("code");
    const destination = getSafeDestination(
        searchParams.get("next"),
        request.nextUrl.origin,
    );

    if (code) {
        try {
            const supabase = await getSupabaseServerClient();
            const { error } = await supabase.auth.exchangeCodeForSession(code);

            if (!error) {
                return NextResponse.redirect(destination);
            }
        } catch {
            // The login page below gives the user a useful configuration error.
        }
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
        "error",
        searchParams.get("error_description") ??
            "We could not complete your sign-in. Please try again.",
    );

    const destinationPath = `${destination.pathname}${destination.search}${destination.hash}`;
    if (destinationPath !== "/") {
        loginUrl.searchParams.set("next", destinationPath);
    }

    return NextResponse.redirect(loginUrl);
}
