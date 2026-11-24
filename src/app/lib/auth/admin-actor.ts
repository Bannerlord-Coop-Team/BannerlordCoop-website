import { isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
import { cache } from "react";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { hasImpersonationSelection } from "./impersonation-selection";

export type AdminNavigationViewer = { actor: User | null; impersonating: boolean };

/**
 * Resolves the original (non-impersonated) signed-in user once per request. Client, session-context and Auth outage
 * (retryable fetch or 5xx) failures throw; a missing session or rejected token reads as signed out.
 */
export const getAdminActor = cache(async (): Promise<User | null> => {
    const client = await getSupabaseServerClient({ impersonation: "actor" });
    const { data: { user }, error } = await client.auth.getUser();
    if (!error) return user;
    if (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500) throw error;
    return null;
});

/** Loads the admin navigation viewer fail-soft: a failed lookup is logged and reads as signed out, keeping the impersonation state. */
export async function loadAdminNavigationViewer(): Promise<AdminNavigationViewer> {
    // Read outside the lookup, so an impersonating navbar still resolves its own viewer when the lookup fails.
    const impersonating = await hasImpersonationSelection();
    try {
        return { actor: await getAdminActor(), impersonating };
    } catch (error) {
        console.error("Admin navigation viewer failed to load", error);
        return { actor: null, impersonating };
    }
}
