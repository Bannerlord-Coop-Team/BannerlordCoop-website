"use server";

import { MyServersApiError, requestMyServerSettings } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { exactKeys, isRecord, REQUEST_ID } from "../../../supabase/functions/_shared/server-visibility-contract";
import { parseOwnerSettingsMutation } from "../../../supabase/functions/_shared/server-settings-contract";
import { revalidatePath } from "next/cache";

export async function saveServerSettings(value: unknown): Promise<{ ok: boolean; message: string; updatedAt?: string; rejected?: boolean }> {
    let input;
    let requestId: string;
    try {
        if (!isRecord(value) || !exactKeys(value, ["serverId", "expectedUpdatedAt", "patch", "requestId"])
            || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid request");
        requestId = value.requestId;
        input = parseOwnerSettingsMutation({ serverId: value.serverId, expectedUpdatedAt: value.expectedUpdatedAt, patch: value.patch });
    } catch { return { ok: false, rejected: true, message: "Select a supported maintenance window and a server name of 3–48 characters using letters, numbers, spaces, periods, apostrophes, or hyphens." }; }
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
        if (!user || !session || session.user.id !== user.id) return { ok: false, rejected: true, message: "Please sign in again before saving server settings." };
        const result = await requestMyServerSettings(session.access_token, input, requestId);
        revalidatePath("/servers");
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, updatedAt: result.updatedAt, message: "Server settings saved. Refreshing the current settings." };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
        const messages: Record<string, string> = {
            stale_interaction: "The server changed. Refresh before saving settings again.",
            server_not_found: "This server is unavailable or you are no longer its owner.",
            operation_in_progress: "Another server operation is in progress. Wait for it to finish before saving settings.",
            invalid_request: "The server settings are invalid.",
            request_conflict: "This settings request was already used for different changes. Refresh before saving again.",
        };
        return { ok: false, rejected: Object.hasOwn(messages, code), message: messages[code] ?? "The settings update could not be confirmed. Retry or refresh to check the current settings." };
    }
}
