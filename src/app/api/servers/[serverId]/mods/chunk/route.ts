import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { serverModsApi } from "@/app/lib/hosting/server-mods-api";
import { createServerModChunkHandler } from "@/app/lib/hosting/server-mods-route";

export const dynamic = "force-dynamic";

export const PUT = createServerModChunkHandler({ getAuthClient: getSupabaseServerClient, api: serverModsApi, now: Date.now });
