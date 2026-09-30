import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_COOKIE_PREFIX, IMPERSONATION_COOKIE, IMPERSONATION_OPTIONS } from "../auth/impersonation-cookie";

/** The backup client has a separate HttpOnly cookie namespace, never browser auth storage. */
export async function createSupabaseServerClient(administratorBackup = false): Promise<SupabaseClient> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishableKey) throw new Error("Supabase authentication is not configured.");
    const cookieStore = await cookies();
    return createServerClient(url, publishableKey, {
        ...(administratorBackup ? { cookieOptions: { ...IMPERSONATION_OPTIONS, name: ADMIN_COOKIE_PREFIX } } : {}),
        cookies: {
            getAll() { return cookieStore.getAll(); },
            setAll(cookiesToSet) {
                try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
                catch { /* Server components cannot persist refreshed cookies; actions and routes can. */ }
            },
        },
    });
}

export async function getSupabaseServerClient(options: { impersonation?: "actor" } = {}): Promise<SupabaseClient> {
    const primary = await createSupabaseServerClient();
    const cookie = (await cookies()).get(IMPERSONATION_COOKIE);
    const actor = options.impersonation === "actor";
    const client = actor && cookie ? await createSupabaseServerClient(true) : primary;
    try {
        if (cookie && !actor) {
            const { resolveImpersonation } = await import("../auth/impersonation");
            await resolveImpersonation(await createSupabaseServerClient(true), client, cookie.value);
        } else {
            const { data: { session } } = await client.auth.getSession();
            if (session) {
                const { data, error } = await client.rpc("website_session_context", { p_action: "website.session", p_request_id: crypto.randomUUID() });
                if (error || data?.impersonationId !== null) throw new Error("Session context unavailable.");
            }
        }
    } catch (error) {
        if (!cookie || actor) throw error;
        redirect("/admin?error=Impersonation+expired+or+is+unavailable.+Exit+or+select+a+user+again.");
    }
    return client;
}
