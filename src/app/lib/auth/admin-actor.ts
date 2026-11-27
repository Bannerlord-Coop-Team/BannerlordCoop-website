import { isAuthApiError, isAuthSessionMissingError, type AuthError, type User } from "@supabase/supabase-js";
import { cache } from "react";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { hasImpersonationSelection } from "./impersonation-selection";

/** Hands the site viewer to the navbar's own lookup, used while impersonating because the effective viewer is the target. */
export const NAVBAR_LOOKUP = "navbar-lookup";

/** `siteViewer` is the known site viewer, or `NAVBAR_LOOKUP` when the navbar must resolve its own (impersonated) viewer. */
export type AdminNavigationIdentity = { actor: User | null; siteViewer: { user: User | null } | typeof NAVBAR_LOOKUP };

/** Auth errors that mean no usable session, as opposed to an outage or rate limit. */
function isSignedOutAuthError(error: AuthError) {
    return isAuthSessionMissingError(error) || (isAuthApiError(error) && error.status < 500 && error.status !== 429);
}

/**
 * Resolves the original (non-impersonated) signed-in user once per request. A missing session or a rejected token
 * (4xx Auth API error other than 429) reads as signed out; every other Auth, client or session-context failure throws.
 */
export const getOriginalActor = cache(async (): Promise<User | null> => {
    const client = await getSupabaseServerClient({ impersonation: "actor" });
    const { data: { user }, error } = await client.auth.getUser();
    if (!error) return user;
    if (isSignedOutAuthError(error)) return null;
    throw error;
});

/** Loads the admin navigation identity fail-soft; without an impersonation selection the original actor is also the site viewer. */
export async function loadAdminNavigationIdentity(): Promise<AdminNavigationIdentity> {
    // Read outside the lookup, so an impersonating navbar still resolves its own viewer when the lookup fails.
    const impersonating = await hasImpersonationSelection();
    let actor: User | null = null;
    try {
        actor = await getOriginalActor();
    } catch (error) {
        console.error("Admin navigation identity failed to load", error);
    }
    return { actor, siteViewer: impersonating ? NAVBAR_LOOKUP : { user: actor } };
}
