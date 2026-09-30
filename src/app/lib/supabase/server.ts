import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IMPERSONATION_COOKIE, READ_ONLY_MESSAGE } from "../auth/impersonation-cookie";

export async function getSupabaseServerClient(options: { impersonation?: "deny" | "actor" } = {}): Promise<SupabaseClient> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !publishableKey) {
        throw new Error("Supabase authentication is not configured.");
    }

    const cookieStore = await cookies();
    const impersonation = cookieStore.get(IMPERSONATION_COOKIE);
    if (impersonation && options.impersonation === "deny") throw new Error(READ_ONLY_MESSAGE);

    const client = createServerClient(url, publishableKey, {
        cookies: {
            getAll() {
                return cookieStore.getAll();
            },
            setAll(cookiesToSet) {
                try {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        cookieStore.set(name, value, options);
                    });
                } catch {
                    // Server Components cannot write cookies. Route handlers and
                    // Server Actions can, so session updates still persist there.
                }
            },
        },
    });
    if (impersonation && options.impersonation !== "actor") {
        const { impersonatedClient } = await import("../auth/impersonation");
        try { return await impersonatedClient(client, impersonation.value); }
        catch {
            // An uncaught page error can replace the layout and its Exit button.
            // Keep recovery in the real administrator's picker without restoring
            // writable authority or treating the target as the signed-in actor.
            redirect("/admin?error=Impersonation+expired+or+is+unavailable.+Exit+or+select+a+user+again.");
        }
    }
    return client;
}
