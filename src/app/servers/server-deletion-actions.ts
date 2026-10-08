"use server";

import { getTranslations } from "@/app/lib/localization/server";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { MyServersApiError, requestMyServerDeletion } from "@/app/lib/hosting/my-servers";
import { parseServerDeletionIntent, type ServerDeletionIntent } from "../../../supabase/functions/_shared/server-deletion-contract";
import { revalidatePath } from "next/cache";

export type ServerDeletionActionResult = { ok: boolean; message: string; rejected?: boolean };

/** Reauthenticates every request; ownership, generation and exact name are checked by the control plane. */
export async function deleteManagedServer(value: unknown): Promise<ServerDeletionActionResult> {
    const { t } = await getTranslations("managed-server");
    let intent: ServerDeletionIntent;
    try { intent = parseServerDeletionIntent(value); }
    catch { return { ok: false, rejected: true, message: t("deletion.invalid") }; }
    let accessToken: string;
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
        if (!user || !session || session.user.id !== user.id) return { ok: false, rejected: true, message: t("deletion.signIn") };
        accessToken = session.access_token;
    } catch { return { ok: false, message: t("deletion.unknown") }; }
    try {
        await requestMyServerDeletion(accessToken, intent);
        revalidatePath("/servers");
        revalidatePath(`/servers/${intent.serverId}`);
        return { ok: true, message: t("deletion.queued") };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "unknown";
        // The control plane has definitely refused the request when another
        // lifecycle operation owns the server. Keep this out of the
        // ambiguous retry path; the owner must refresh and confirm again
        // after that operation settles.
        const rejected = ["stale_interaction", "confirmation_mismatch", "forbidden", "server_not_found", "invalid_request", "request_conflict", "hosting_conflict", "operation_conflict", "operation_in_progress"].includes(code);
        return { ok: false, rejected, message: t(rejected ? "deletion.rejected" : "deletion.unknown") };
    }
}
