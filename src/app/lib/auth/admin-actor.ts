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

/** Resolves the original (non-impersonated) signed-in user once per request; lookup failures throw to the caller. */
export const getAdminActor = cache(async (): Promise<AdminActor> => {
    const impersonating = await hasImpersonationSelection();
    const client = await getSupabaseServerClient({ impersonation: "actor" });
    const { data: { user } } = await client.auth.getUser();
    return { actor: user, impersonating };
});
