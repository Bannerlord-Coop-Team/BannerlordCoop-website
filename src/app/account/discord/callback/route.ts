import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { currentDiscord, sha256 } from "../../../../../supabase/functions/_shared/membership";
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
            // Missing existing server configuration fails before consuming PKCE.
            const admin = getSupabaseAdminClient();
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            const returned = await supabase.auth.getUser();
            const discord = returned.data.user ? currentDiscord(returned.data.user) : null;
            if (!error && returned.data.user?.id === user.id && discord !== null) {
                // Only this server-only seam attests successful same-account PKCE.
                // A lost response is resolved from the durable intent, never Auth linkage.
                const stamped = await admin.rpc("membership_discord_callback", { p_account_id: user.id, p_token_hash: await sha256(token), p_discord_user_id: discord });
                if (!stamped.error && stamped.data?.verified === true) result = "confirm";
            }
        } catch { /* Never substitute sign-in or expose provider errors. */ }
    }
    const response = NextResponse.redirect(new URL(`/account?discord=${result}`, request.url), 303);
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return response;
}
