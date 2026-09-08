import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { LINK_COOKIE } from "@/app/lib/auth/account-link";
import { NextRequest, NextResponse } from "next/server";
export async function GET(request: NextRequest) {
    let result = "repair";
    const token = request.cookies.get(LINK_COOKIE)?.value;
    const code = request.nextUrl.searchParams.get("code");
    if (token && /^[a-f0-9]{64}$/u.test(token) && code && code.length <= 4096 && !request.nextUrl.searchParams.has("error")) {
        try {
            const supabase = await getSupabaseServerClient();
            const { data: { user } } = await supabase.auth.getUser();
            const { data: { session } } = await supabase.auth.getSession();
            if (!user || !session || user.id !== session.user.id) throw new Error("Session changed");
            const check = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { operation: "discord-check", token } });
            if (check.error || check.data?.valid !== true) throw new Error("Initiating account changed");
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            const returned = await supabase.auth.getUser();
            if (!error && returned.data.user?.id === user.id) result = "confirm";
        } catch { /* Never substitute sign-in or expose provider errors. */ }
    }
    const response = NextResponse.redirect(new URL(`/account?discord=${result}`, request.url), 303);
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return response;
}
