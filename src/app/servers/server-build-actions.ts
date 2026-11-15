"use server";

import { getMyServerBuildStatus } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import type { BuildStatus } from "../../../supabase/functions/_shared/server-build-contract";

// Requires the current verified session before reading update progress.
async function accessToken() {
    const supabase = await getSupabaseServerClient();
    const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
    if (!user || !session || session.user.id !== user.id) throw new Error("Sign in again");
    return session.access_token;
}

// Reads the phase-by-phase state of the server's current or latest update job.
export async function readServerBuildStatus(serverId: string): Promise<BuildStatus | null> {
    try { return await getMyServerBuildStatus(await accessToken(), serverId); }
    catch { return null; }
}
