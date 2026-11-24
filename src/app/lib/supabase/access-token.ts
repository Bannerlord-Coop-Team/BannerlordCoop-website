import { getSupabaseBrowserClient } from "./client";

/** Looks up the current access token, or null when signed out. */
export type AccessTokenLookup = () => Promise<string | null>;

/** The signed-in browser session's access token, or null when there is none. */
export async function readSupabaseAccessToken(): Promise<string | null> {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    return session?.access_token ?? null;
}

/** Adapts a token-taking request into a signal-only read: looks up the token, sends nothing if aborted meanwhile, and fails when signed out. */
export function withAccessToken<T>(lookup: AccessTokenLookup, request: (accessToken: string, signal: AbortSignal) => Promise<T>) {
    return async (signal: AbortSignal): Promise<T> => {
        const accessToken = await lookup();
        signal.throwIfAborted();
        if (!accessToken) throw new Error("Authentication is required.");
        return request(accessToken, signal);
    };
}
