"use server";

import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { accountLinkOrigin, accountReturn, LINK_COOKIE, LINK_COOKIE_OPTIONS, PATREON_COOKIE } from "@/app/lib/auth/account-link";
import { currentDiscord } from "../../../supabase/functions/_shared/membership";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

function rateLimited(error: unknown): boolean {
    return typeof error === "object" && error !== null && "context" in error && error.context instanceof Response && error.context.status === 429;
}
async function authenticated() {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data: { session } } = await supabase.auth.getSession();
    if (!user || !session || session.user.id !== user.id) throw new Error("Sign in again");
    return { supabase, user, session };
}
export async function linkPatreonAccount(form: FormData) {
    let destination = "/account?patreon=error";
    try {
        const { supabase, session } = await authenticated();
        const { data, error } = await supabase.functions.invoke("patreon-start", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { returnPath: accountReturn(form.get("returnPath")) } });
        if (rateLimited(error)) destination = "/account?patreon=rate_limited";
        if (!error && typeof data?.url === "string") {
            const url = new URL(data.url);
            const expected = new URL("/functions/v1/patreon-callback", process.env.NEXT_PUBLIC_SUPABASE_URL);
            if (url.origin === expected.origin && url.pathname === expected.pathname && url.protocol === "https:" && !url.username && !url.password) destination = url.href;
        }
    } catch { /* No provider bodies or credentials in errors. */ }
    redirect(destination);
}
export async function completePatreonAccount() {
    const jar = await cookies(); const token = jar.get(PATREON_COOKIE)?.value;
    let destination = "/account?patreon=error";
    try {
        if (!token || !/^[a-f0-9]{64}$/u.test(token)) throw new Error("Missing completion");
        const { supabase, session } = await authenticated();
        const { data, error } = await supabase.functions.invoke("patreon-complete", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { token } });
        if (!error && data?.linked === true && ["/account", "/servers"].includes(data.returnPath)) {
            destination = `${data.returnPath}?patreon=linked`; jar.delete(PATREON_COOKIE);
        } else destination = rateLimited(error) ? "/account?patreon=rate_limited" : "/account?patreon=confirm_error";
    } catch { destination = "/account?patreon=confirm_error"; }
    // Retain the same token on an unknown outcome; SQL returns its committed receipt.
    redirect(destination);
}
export async function cancelPatreonCompletion() { (await cookies()).delete(PATREON_COOKIE); redirect("/account?patreon=cancelled"); }
export async function unlinkPatreonAccount() {
    let destination = "/account?patreon=error";
    try {
        const { supabase, session } = await authenticated();
        const { data, error } = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { operation: "unlink" } });
        if (!error && data?.unlinked === true) destination = "/account?patreon=unlinked";
    } catch { /* Preserve management access regardless of link status. */ }
    redirect(destination);
}
export async function linkDiscordAccount(form: FormData) {
    let destination = "/account?discord=repair";
    try {
        const { supabase, user, session } = await authenticated();
        if (currentDiscord(user) !== null) throw new Error("Already linked");
        const origin = accountLinkOrigin(process.env.ACCOUNT_LINK_SITE_URL);
        const { data, error } = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { operation: "discord-start", returnPath: accountReturn(form.get("returnPath")) } });
        if (rateLimited(error)) destination = "/account?discord=rate_limited";
        if (error || data?.accountId !== user.id || typeof data.token !== "string" || !/^[a-f0-9]{64}$/u.test(data.token)) throw new Error("Link unavailable");
        (await cookies()).set(LINK_COOKIE, data.token, LINK_COOKIE_OPTIONS);
        // Supabase owns OAuth state + PKCE. Our cookie refers only to server-held app authority.
        const linked = await supabase.auth.linkIdentity({ provider: "discord", options: { redirectTo: `${origin}/account/discord/callback` } });
        if (linked.error || !linked.data.url) throw new Error("Manual linking disabled or conflict");
        const url = new URL(linked.data.url);
        if (url.origin !== "https://discord.com" || !["/oauth2/authorize", "/api/oauth2/authorize"].includes(url.pathname) || url.username || url.password) throw new Error("Unexpected link destination");
        destination = url.href;
    } catch { if (destination !== "/account?discord=rate_limited") (await cookies()).delete(LINK_COOKIE); }
    redirect(destination);
}
export async function confirmDiscordAccount() {
    const jar = await cookies(); const token = jar.get(LINK_COOKIE)?.value;
    let destination = "/account?discord=repair";
    try {
        if (!token || !/^[a-f0-9]{64}$/u.test(token)) throw new Error("Missing link request");
        const { supabase, session } = await authenticated();
        const { data, error } = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { operation: "discord-confirm", token } });
        if (rateLimited(error)) destination = "/account?discord=rate_limited";
        if (!error && data?.confirmed === true && ["/servers", "/account"].includes(data.returnPath)) { destination = data.returnPath; jar.delete(LINK_COOKIE); }
    } catch { /* Account switches never fall back to sign-in or email merging. */ }
    redirect(destination);
}
