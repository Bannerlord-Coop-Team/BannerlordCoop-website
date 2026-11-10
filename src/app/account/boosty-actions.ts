"use server";

import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { BOOSTY_CODE_COOKIE, BOOSTY_CODE_COOKIE_OPTIONS } from "@/app/lib/hosting/boosty-link";
import { LINK_CODE } from "../../../supabase/functions/_shared/boosty-link-code";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/** Reads the fresh authenticated user and matching session, or refuses. */
async function authenticated() {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data: { session } } = await supabase.auth.getSession();
    if (!user || !session || session.user.id !== user.id) throw new Error("Sign in again");
    return { supabase, user, session };
}

/** Maps a functions error to the account page's closed Boosty result codes. */
function failure(error: unknown): "rate_limited" | "error" {
    const status = typeof error === "object" && error !== null && "context" in error && error.context instanceof Response ? error.context.status : 0;
    return status === 429 ? "rate_limited" : "error";
}

/** Issues a new DM link code and keeps it in an httpOnly cookie so the account page can show it. */
export async function startBoostyLink() {
    let destination = "/account?boosty=error";
    try {
        const { supabase, session } = await authenticated();
        const { data, error } = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { operation: "boosty-start" } });
        if (error) destination = `/account?boosty=${failure(error)}`;
        else if (typeof data?.code === "string" && LINK_CODE.test(data.code)) {
            (await cookies()).set(BOOSTY_CODE_COOKIE, data.code, BOOSTY_CODE_COOKIE_OPTIONS);
            destination = "/account?boosty=code";
        }
    } catch { /* No provider bodies or credentials in errors. */ }
    redirect(destination);
}

/** Unlinks Boosty for the account the page was rendered for, then forgets any shown code. */
export async function unlinkBoostyAccount(accountId: string) {
    let destination = "/account?boosty=disconnect_error";
    try {
        const { supabase, user, session } = await authenticated();
        if (user.id !== accountId) throw new Error("Account changed");
        const { data, error } = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { operation: "boosty-unlink" } });
        if (!error && data?.unlinked === true) {
            (await cookies()).delete(BOOSTY_CODE_COOKIE);
            destination = "/account?boosty=unlinked";
        }
    } catch { /* Preserve management access regardless of link status. */ }
    redirect(destination);
}
