import { createBrowserClient } from "@supabase/ssr";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

/** Returns the configured browser singleton, allowing callers to localize its configuration error. */
export function getSupabaseBrowserClient(
    configurationError = "Authentication is not configured. Add the Supabase environment variables and restart the server.",
) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !publishableKey) {
        throw new Error(configurationError);
    }

    browserClient ??= createBrowserClient(url, publishableKey);
    return browserClient;
}
