import "server-only";

import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { createWebsiteAccountStatusReader } from "./website-account-status-core";

export const getWebsiteAccountStatus = createWebsiteAccountStatusReader(getSupabaseServerClient);
