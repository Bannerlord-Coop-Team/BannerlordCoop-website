import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Provider verification only issues authority. The currently authenticated website
// account must match its owner at the Edge/SQL commit point; no browser confirmation.
export async function GET(request: NextRequest) {
    let destination = "/account?patreon=error";
    const token = request.nextUrl.searchParams.get("token");
    try {
        if (!token || !/^[a-f0-9]{64}$/u.test(token)) throw new Error("Missing completion");
        const supabase = await getSupabaseServerClient();
        const { data: { user } } = await supabase.auth.getUser();
        const { data: { session } } = await supabase.auth.getSession();
        if (!user || !session || session.user.id !== user.id) throw new Error("Account changed");
        const { data, error } = await supabase.functions.invoke("patreon-complete", {
            headers: { Authorization: `Bearer ${session.access_token}` }, body: { token }, timeout: 10_000,
        });
        if (!error && data?.linked === true && ["/account", "/servers"].includes(data.returnPath)) {
            destination = data.returnPath;
        }
    } catch { /* Never expose authority, provider responses or account identifiers. */ }
    // The page reads current status, not historical receipt/query success flags.
    const response = NextResponse.redirect(new URL(destination, request.url), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
}
