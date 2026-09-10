"use server";

import { MyServersApiError, requestServerVisibility } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { exactKeys, isRecord, parseVisibilityMutation, REQUEST_ID, type VisibilityMutation } from "../../../supabase/functions/_shared/server-visibility-contract";
import { revalidatePath } from "next/cache";

export async function setServerVisibility(value: unknown): Promise<{ ok: boolean; message: string }> {
    let input: VisibilityMutation;
    let requestId: string;
    try {
        if (!isRecord(value) || !exactKeys(value, ["serverId", "visibility", "expectedUpdatedAt", "requestId"])
            || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid update");
        requestId = value.requestId;
        input = parseVisibilityMutation({ action: "set-server-visibility", serverId: value.serverId,
            visibility: value.visibility, expectedUpdatedAt: value.expectedUpdatedAt });
    } catch { return { ok: false, message: "The visibility update is invalid." }; }
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: userData }, { data: sessionData }] = await Promise.all([
            supabase.auth.getUser(), supabase.auth.getSession(),
        ]);
        if (!userData.user || !sessionData.session || sessionData.session.user.id !== userData.user.id) {
            return { ok: false, message: "Please sign in again before changing visibility." };
        }
        // The control plane rechecks current ownership; no actor or role is supplied by the browser.
        await requestServerVisibility(sessionData.session.access_token, input, requestId);
        revalidatePath("/servers");
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, message: input.visibility === "public"
            ? "Server is now public. Its game IP and port are visible to everyone."
            : "Server is now private and removed from the public directory." };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "visibility_update_failed";
        console.error("Server visibility update failed", { code });
        if (code === "stale_interaction") return { ok: false, message: "The server changed. Refresh and try again." };
        return { ok: false, message: "Visibility could not be updated. Only the current owner can change this setting. Refresh before trying again." };
    }
}
