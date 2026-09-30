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

/** Fresh read-only viewer; never retained across requests or used in place of mutation authorization. */
export async function getSupabaseServerViewer() {
    const impersonating = Boolean((await cookies()).get(IMPERSONATION_COOKIE));
    // Preserve the full actor/target validation and redirect path for impersonation.
    const client = impersonating ? await getSupabaseServerClient() : await createSupabaseServerClient();
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) return { client, user: null, accessToken: null };

    const [{ data: { user }, error }] = await Promise.all([
        // An explicit token avoids holding the SDK session lock while fetching the user.
        client.auth.getUser(session.access_token),
        (async () => {
            if (impersonating) return;
            const { data, error } = await client.rpc("website_session_context", {
                p_action: "website.session", p_request_id: crypto.randomUUID(),
            }).setHeader("Authorization", `Bearer ${session.access_token}`);
            if (error || data?.impersonationId !== null) throw new Error("Session context unavailable.");
        })(),
    ]);
    return {
        client, user: error ? null : user,
        accessToken: !error && user && session.user.id === user.id ? session.access_token : null,
    };
}
