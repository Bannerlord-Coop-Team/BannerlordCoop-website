import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    let linked = false;
    const token = request.nextUrl.searchParams.get("token");
    try {
        if (token && /^[a-f0-9]{64}$/.test(token)) {
            const supabase = await getSupabaseServerClient();
            const { data: { user } } = await supabase.auth.getUser();
            const { data: { session } } = await supabase.auth.getSession();
            if (user && session) {
                const { data, error } = await supabase.functions.invoke("patreon-complete", {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                    body: { token },
                });
                linked = !error && data?.linked === true;
            }
        }
    } catch {
        // Do not expose OAuth or database details in the browser.
    }
    const response = NextResponse.redirect(new URL(`/account?patreon=${linked ? "linked" : "error"}`, request.url), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
}
