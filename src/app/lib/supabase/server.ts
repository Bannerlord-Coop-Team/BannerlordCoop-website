import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getSupabaseServerClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !publishableKey) {
        throw new Error("Supabase authentication is not configured.");
    }

    const cookieStore = await cookies();

    return createServerClient(url, publishableKey, {
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
}
