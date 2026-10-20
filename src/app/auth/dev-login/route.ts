import { getDevAuthEmail } from "@/app/lib/auth/dev-auth";
import { getSafeDestination } from "@/app/lib/auth/redirect";
import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Signs in as DEV_AUTH_EMAIL with a real Supabase session during local `next dev`; 404 everywhere else.
export async function GET(request: NextRequest) {
    const email = getDevAuthEmail(process.env, request.nextUrl.hostname);
    if (email === null) return new NextResponse(null, { status: 404 });

    const { data, error: linkError } = await getSupabaseAdminClient().auth.admin.generateLink({ type: "magiclink", email });
    if (linkError) return NextResponse.json({ error: `Debug sign-in link failed: ${linkError.message}` }, { status: 500 });

    const supabase = await getSupabaseServerClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({ type: "email", token_hash: data.properties.hashed_token });
    if (verifyError) return NextResponse.json({ error: `Debug sign-in failed: ${verifyError.message}` }, { status: 500 });

    return NextResponse.redirect(getSafeDestination(request.nextUrl.searchParams.get("next"), request.nextUrl.origin));
}
