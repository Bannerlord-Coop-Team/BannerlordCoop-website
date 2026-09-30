import { createBrowserClient } from "@supabase/ssr";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
    if (typeof document !== "undefined" && document.getElementById("impersonation-banner")) {
        throw new Error("Impersonation is read-only. Exit impersonation before connecting a console or making changes.");
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !publishableKey) {
        throw new Error(
            "Authentication is not configured. Add the Supabase environment variables and restart the server.",
        );
    }

    browserClient ??= createBrowserClient(url, publishableKey);
    return browserClient;
}
