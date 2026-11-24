import { getSupabaseBrowserClient } from "./client";

/** The signed-in browser session's access token, or null when there is none. */
export async function readSupabaseAccessToken(): Promise<string | null> {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    return session?.access_token ?? null;
}
