import "server-only";

import { createWebsiteAccountStatusReader, readWebsiteAccountStatus } from "./website-account-status-core";

export const getWebsiteAccountStatus = createWebsiteAccountStatusReader(token => readWebsiteAccountStatus(token, {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    serviceRoleKey: process.env.SUPABASE_SECRET_KEY!,
}));
