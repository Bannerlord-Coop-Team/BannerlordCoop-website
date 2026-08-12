import "server-only";

import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdminClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;

    if (!url || !secretKey) {
        throw new Error(
            "Admin member management is not configured. Add SUPABASE_SECRET_KEY to .env.local.",
        );
    }

    return createClient(url, secretKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}
