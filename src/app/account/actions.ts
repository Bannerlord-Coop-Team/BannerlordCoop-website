"use server";

import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { accountLinkOrigin, accountReturn, LINK_COOKIE, LINK_COOKIE_OPTIONS, PATREON_COOKIE } from "@/app/lib/auth/account-link";
import { parseLinkRecovery, parseLinkResolution, type LinkProvider } from "@/app/lib/auth/link-recovery";
import { boundedJson, currentDiscord, record } from "../../../supabase/functions/_shared/membership";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

function rateLimited(error: unknown): boolean {
    return typeof error === "object" && error !== null && "context" in error && error.context instanceof Response && error.context.status === 429;
}
async function contention(error: unknown): Promise<boolean> {
    if (typeof error !== "object" || error === null || !("context" in error) || !(error.context instanceof Response) || error.context.status !== 503) return false;
    try { const value = await boundedJson(error.context.clone(),4096); return record(value) && Object.keys(value).length===1 && value.error === "membership_retry"; } catch { return false; }
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
        if (await contention(error)) destination = "/account?patreon=retry";
        if (!error && typeof data?.url === "string") {
            const url = new URL(data.url);
            const expected = new URL("/functions/v1/patreon-callback", process.env.NEXT_PUBLIC_SUPABASE_URL);
            if (url.origin === expected.origin && url.pathname === expected.pathname && url.protocol === "https:" && !url.username && !url.password) destination = url.href;
        }
    } catch { /* No provider bodies or credentials in errors. */ }
    redirect(destination);
}
export async function completePatreonAccount() {
    return finishPatreonAccount();
}

export async function automaticallyCompletePatreonAccount(accountId: string, operationId: string) {
    return finishPatreonAccount({ accountId, operationId });
}

async function finishPatreonAccount(expected?: { accountId: string; operationId: string }) {
    const jar = await cookies(); const token = jar.get(PATREON_COOKIE)?.value;
    let destination = "/account?patreon=error";
    try {
        if (!token || !/^[a-f0-9]{64}$/u.test(token)) throw new Error("Missing completion");
        const { supabase, user, session } = await authenticated();
        if (expected) {
            if (user.id !== expected.accountId) throw new Error("Account changed");
            const pending = await supabase.functions.invoke("website-account", {
                headers: { Authorization: `Bearer ${session.access_token}` },
                body: { operation: "recovery-status", provider: "patreon", token },
            });
            const recovery = !pending.error ? parseLinkRecovery(pending.data, user.id, "patreon") : null;
            if (!recovery || recovery.state !== "live" || !recovery.confirmable || recovery.operationId !== expected.operationId) {
                throw new Error("Completion authority changed");
            }
        }
        const { data, error } = await supabase.functions.invoke("patreon-complete", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { token } });
        if (!error && data?.linked === true && ["/account", "/servers"].includes(data.returnPath)) {
            destination = `${data.returnPath}?patreon=linked`;
        } else destination = await contention(error) ? "/account?patreon=retry" : rateLimited(error) ? "/account?patreon=rate_limited" : "/account?patreon=confirm_error";
    } catch { destination = "/account?patreon=confirm_error"; }
    // Never delete shared authority on completion: a delayed response could erase
    // another tab's newer cookie. Tokens expire and SQL fences consumed authority.
    redirect(destination);
}
export async function resolveAccountLink(form: FormData) {
    let destination = "/account?recovery=unavailable";
    try {
        const provider = form.get("provider"); const operationId = form.get("operationId");
        if (!["discord", "patreon"].includes(provider as string) || typeof operationId !== "string" || !/^[0-9a-f-]{36}$/iu.test(operationId)) throw new Error("Invalid recovery");
        const { supabase, user, session } = await authenticated();
        const { data, error } = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { operation: "recovery-resolve", provider, operationId } });
        if (await contention(error)) destination = "/account?recovery=retry";
        const resolved = !error ? parseLinkResolution(data, user.id, provider as LinkProvider, operationId) : null;
        if (resolved) {
            // Every terminal response can arrive after another tab starts a new operation.
            // Leave shared cookies untouched; request-snapshot comparisons cannot
            // protect against reordered Set-Cookie responses.
            destination = resolved.state === "committed" ? `${resolved.returnPath}?${provider}=recovered` : `/account?${provider}=${resolved.state}`;
        }
    } catch { /* Unknown outcomes retain both durable intent and cookie. */ }
    redirect(destination);
}
export async function disconnectDiscordAccount(accountId: string, identityId: string) {
    let destination = "/account?discord=disconnect_error";
    try {
        const { supabase, user } = await authenticated();
        if (user.id !== accountId) throw new Error("Account changed");
        const identity = user.identities?.find(value => value.provider === "discord" && value.identity_id === identityId);
        if (!identity) throw new Error("Identity changed");
        if (!user.identities?.some(value => value.provider !== "discord")) {
            destination = "/account?discord=last_identity";
        } else {
            // Supabase Auth also enforces its last-identity protection at unlink time.
            const { error } = await supabase.auth.unlinkIdentity(identity);
            if (!error) destination = "/account?discord=disconnected";
        }
    } catch { /* Do not expose Auth responses or identity details. */ }
    redirect(destination);
}

export async function disconnectPatreonAccount(accountId: string) {
    return unlinkPatreonAccountFor(accountId);
}

export async function unlinkPatreonAccount() {
    return unlinkPatreonAccountFor();
}

async function unlinkPatreonAccountFor(accountId?: string) {
    let destination = "/account?patreon=disconnect_error";
    try {
        const { supabase, user, session } = await authenticated();
        if (accountId && user.id !== accountId) throw new Error("Account changed");
        const { data, error } = await supabase.functions.invoke("website-account", { headers: { Authorization: `Bearer ${session.access_token}` }, body: { operation: "unlink" } });
        if (await contention(error)) destination = "/account?patreon=retry";
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
        if (await contention(error)) destination = "/account?discord=retry";
        if (error || data?.accountId !== user.id || typeof data.token !== "string" || !/^[a-f0-9]{64}$/u.test(data.token)) throw new Error("Link unavailable");
        (await cookies()).set(LINK_COOKIE, data.token, LINK_COOKIE_OPTIONS);
        // Supabase owns OAuth state + PKCE. Our cookie refers only to server-held app authority.
        const linked = await supabase.auth.linkIdentity({ provider: "discord", options: { redirectTo: `${origin}/account/discord/callback` } });
        if (linked.error || !linked.data.url) throw new Error("Manual linking disabled or conflict");
        const url = new URL(linked.data.url);
        if (url.origin !== "https://discord.com" || !["/oauth2/authorize", "/api/oauth2/authorize"].includes(url.pathname) || url.username || url.password) throw new Error("Unexpected link destination");
        destination = url.href;
    } catch { /* Preserve uncertain initiation; authenticated status resolves it. */ }
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
        if (await contention(error)) destination = "/account?discord=retry";
        if (!error && data?.confirmed === true && ["/servers", "/account"].includes(data.returnPath)) { destination = data.returnPath; }
        // As with Patreon completion, let authority expire rather than deleting
        // a shared cookie that may already belong to a newer operation.
    } catch { /* Account switches never fall back to sign-in or email merging. */ }
    redirect(destination);
}
