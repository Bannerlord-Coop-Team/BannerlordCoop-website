import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { IMPERSONATION_COOKIE } from "./impersonation-cookie-options";

export type AdminActor = { actor: User | null; impersonating: boolean };

/** Reports whether the request carries an impersonation selection, without validating or resolving it. */
export async function hasImpersonationSelection() {
    const cookieStore = await cookies();
    return Boolean(cookieStore.get(IMPERSONATION_COOKIE));
}

/**
 * Resolves the original (non-impersonated) signed-in user once per request. Client or session-context
 * failures throw; an Auth `getUser` error (including a missing session) reads as signed out, like `getSupabaseServerViewer`.
 */
export const getAdminActor = cache(async (): Promise<User | null> => {
    const client = await getSupabaseServerClient({ impersonation: "actor" });
    const { data: { user }, error } = await client.auth.getUser();
    if (error) return null;
    return user;
});

/** Loads the admin navigation viewer fail-soft: a failed lookup is logged and reads as signed out, keeping the impersonation state. */
export async function loadAdminNavigationViewer(): Promise<AdminActor> {
    // Read outside the lookup, so an impersonating navbar still resolves its own viewer when the lookup fails.
    const impersonating = await hasImpersonationSelection();
    try {
        return { actor: await getAdminActor(), impersonating };
    } catch (error) {
        console.error("Admin navigation viewer failed to load", error);
        return { actor: null, impersonating };
    }
}
