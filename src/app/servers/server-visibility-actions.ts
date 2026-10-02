"use server";

import { getTranslations } from "@/app/lib/localization/server";

import { MyServersApiError, requestServerVisibility } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { exactKeys, isRecord, parseVisibilityMutation, REQUEST_ID, type VisibilityMutation } from "../../../supabase/functions/_shared/server-visibility-contract";
import { revalidatePath } from "next/cache";

// Authenticates directory preference changes and localizes existing outcomes.
export async function setServerVisibility(value: unknown): Promise<{ ok: boolean; message: string; updatedAt?: string; rejected?: boolean }> {
    const { t } = await getTranslations("managed-server");
    let input: VisibilityMutation;
    let requestId: string;
    try {
        if (!isRecord(value) || !exactKeys(value, ["serverId", "visibility", "expectedUpdatedAt", "requestId"])
            || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid update");
        requestId = value.requestId;
        input = parseVisibilityMutation({ action: "set-server-visibility", serverId: value.serverId,
            visibility: value.visibility, expectedUpdatedAt: value.expectedUpdatedAt });
    } catch { return { ok: false, rejected: true, message: t("server-visibility.theVisibilityUpdateIsInvalid") }; }
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: userData }, { data: sessionData }] = await Promise.all([
            supabase.auth.getUser(), supabase.auth.getSession(),
        ]);
        if (!userData.user || !sessionData.session || sessionData.session.user.id !== userData.user.id) {
            return { ok: false, rejected: true, message: t("server-visibility.pleaseSignInAgainBeforeChangingVisibility") };
        }
        // The control plane rechecks current ownership; no actor or role is supplied by the browser.
        const result = await requestServerVisibility(sessionData.session.access_token, input, requestId);
        revalidatePath("/servers");
        revalidatePath(`/servers/${input.serverId}`);
        // A replay acknowledges the original receipt, not necessarily the current preference.
        return { ok: true, updatedAt: result.updatedAt, message: t("server-visibility.discoveryPreferenceUpdateAcknowledgedRefreshingTheCurrentSetting") };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "visibility_update_failed";
        console.error("Server visibility update failed", { code });
        if (code === "stale_interaction") return { ok: false, rejected: true, message: t("server-visibility.theServerChangedRefreshAndTryAgain") };
        return { ok: false, rejected: ["server_not_found", "invalid_request", "request_conflict"].includes(code), message: t("server-visibility.visibilityCouldNotBeUpdatedOnlyTheCurrentOwnerCan") };
    }
}
