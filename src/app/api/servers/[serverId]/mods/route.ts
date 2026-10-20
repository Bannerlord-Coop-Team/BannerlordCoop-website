import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { serverModsApi } from "@/app/lib/hosting/server-mods-api";
import { createServerModsJsonHandler } from "@/app/lib/hosting/server-mods-route";

export const dynamic = "force-dynamic";

export const POST = createServerModsJsonHandler({ getAuthClient: getSupabaseServerClient, api: serverModsApi, now: Date.now });
