"use server";

import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { redirect } from "next/navigation";

export async function linkPatreonAccount() {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login?next=/account");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) redirect("/login?next=/account");

    let destination: string | undefined;
    try {
        const { data, error } = await supabase.functions.invoke("patreon-start", {
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: {},
        });
        if (!error && typeof data?.url === "string") {
            const url = new URL(data.url);
            const expected = new URL("/functions/v1/patreon-callback", process.env.NEXT_PUBLIC_SUPABASE_URL);
            if (url.origin === expected.origin && url.pathname === expected.pathname && url.protocol === "https:") {
                destination = url.href;
            }
        }
    } catch {
        // Surface a safe message on the account page, never raw provider errors.
    }
    redirect(destination ?? "/account?patreon=error");
}
