"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { listMyServerCampaigns, resetMyServerCampaign, selectMyServerCampaign } from "@/app/lib/hosting/server-campaigns";
import { requireUuid } from "../../../supabase/functions/_shared/server-file-contract";
import { parseCampaignMutation, type CampaignPage, type CampaignResetResult, type CampaignSelection } from "../../../supabase/functions/_shared/server-campaign-contract";

export type ManagedServerCampaignList = { ok: true; campaigns: Omit<CampaignPage, "nextCursor"> } | { ok: false; message: string };
export type ManagedServerCampaignChange =
    | { ok: true; selection: CampaignSelection }
    | { ok: true; reset: CampaignResetResult }
    | { ok: false; message: string; refresh: boolean; notSubmitted: boolean };

async function currentToken(expectedUserId: string) {
    const supabase = await getSupabaseServerClient();
    const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
    if (!user || user.id !== expectedUserId || !session) throw new Error("Authentication changed");
    return session.access_token;
}

const REFRESH_CODES = new Set(["stale_interaction", "safe_stop_required", "operation_in_progress", "request_conflict", "save_not_found"]);

function message(error: unknown): { code: string; message: string } {
    const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
    const messages: Record<string, string> = {
        stale_interaction: "The server changed since this page loaded. Refresh and try again.",
        safe_stop_required: "Stop the server before changing or resetting the campaign.",
        operation_in_progress: "Another server operation is still running. Wait for it to finish, then try again.",
        request_conflict: "This request conflicts with another operation. Refresh and try again.",
        operation_unavailable: "Campaign changes are not available for this server right now.",
        save_not_found: "That campaign is no longer available. Refresh the list.",
        server_not_found: "This server is unavailable or your access changed.",
        rate_limited: "Too many requests were sent. Wait a moment and try again.",
        invalid_request: "The campaign request was rejected. Refresh and try again.",
        control_plane_unavailable: "The hosting service could not be reached. Try again.",
        server_api_unavailable: "The hosting service could not be reached. Try again.",
    };
    return { code, message: messages[code] ?? "The campaign change could not be confirmed. Refresh to see the current state." };
}

export async function listManagedServerCampaigns(serverId: string, expectedUserId: string): Promise<ManagedServerCampaignList> {
    try {
        requireUuid(serverId);
        return { ok: true, campaigns: await listMyServerCampaigns(await currentToken(expectedUserId), serverId) };
    } catch (error) {
        return { ok: false, message: error instanceof MyServersApiError ? message(error).message : "The campaign list could not be loaded. Try again." };
    }
}

/** Selects an existing campaign or queues a fresh-campaign reset; the request ID makes retries replay-safe. */
export async function changeManagedServerCampaign(input: unknown, expectedUserId: string): Promise<ManagedServerCampaignChange> {
    let submitted = false;
    try {
        const token = await currentToken(expectedUserId);
        if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Invalid campaign request");
        const { requestId, ...mutation } = input as Record<string, unknown>;
        requireUuid(requestId);
        const parsed = parseCampaignMutation(mutation);
        submitted = true;
        const result = parsed.action === "select-save"
            ? { selection: await selectMyServerCampaign(token, requestId, parsed) }
            : { reset: await resetMyServerCampaign(token, requestId, parsed) };
        revalidatePath(`/servers/${parsed.serverId}`);
        return { ok: true, ...result };
    } catch (error) {
        if (!submitted) return { ok: false, notSubmitted: true, refresh: false, message: "The campaign request was not sent. Refresh the page and try again." };
        const described = message(error);
        return { ok: false, notSubmitted: false, refresh: REFRESH_CODES.has(described.code), message: described.message };
    }
}
