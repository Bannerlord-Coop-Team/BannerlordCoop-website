import "server-only";

import type { User } from "@supabase/supabase-js";
import { parseAccountStatus } from "./membership-onboarding";
import { createWebsiteAccountStatusReader, prepareWebsiteAccountStatus, readWebsiteAccountStatus } from "./website-account-status-core";

const config = () => ({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    serviceRoleKey: process.env.SUPABASE_SECRET_KEY!,
});

export const getWebsiteAccountStatus = createWebsiteAccountStatusReader(token => readWebsiteAccountStatus(token, config()));

/** Prepare independently checked reads; call the result only after fresh matching viewer verification. */
export async function prepareWebsiteAccountStatusRequest(accessToken: string) {
    const read = await prepareWebsiteAccountStatus(accessToken, config());
    return async (viewer: User) => parseAccountStatus(await read(viewer,
        operation => getWebsiteAccountStatus(viewer.id, accessToken, operation)), viewer.id);
}
