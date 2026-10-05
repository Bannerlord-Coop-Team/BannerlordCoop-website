"use server";

import { getTranslations } from "@/app/lib/localization/server";

import { MyServersApiError, requestMyServerSettings } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { exactKeys, isRecord, REQUEST_ID } from "../../../supabase/functions/_shared/server-visibility-contract";
import { parseOwnerSettingsMutation } from "../../../supabase/functions/_shared/server-settings-contract";
import { revalidatePath } from "next/cache";

// Authenticates settings changes and localizes the existing result.
export async function saveServerSettings(value: unknown): Promise<{ ok: boolean; message: string; updatedAt?: string; rejected?: boolean }> {
    const { t } = await getTranslations("managed-server");
    let input;
    let requestId: string;
    try {
        if (!isRecord(value) || !exactKeys(value, ["serverId", "expectedUpdatedAt", "patch", "requestId"])
            || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid request");
        requestId = value.requestId;
        input = parseOwnerSettingsMutation({ serverId: value.serverId, expectedUpdatedAt: value.expectedUpdatedAt, patch: value.patch });
    } catch { return { ok: false, rejected: true, message: t("server-settings.selectASupportedMaintenanceWindowAndAServerNameOf") }; }
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
        if (!user || !session || session.user.id !== user.id) return { ok: false, rejected: true, message: t("server-settings.pleaseSignInAgainBeforeSavingServerSettings") };
        const result = await requestMyServerSettings(session.access_token, input, requestId);
        revalidatePath("/servers");
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, updatedAt: result.updatedAt, message: t("server-settings.serverSettingsSavedRefreshingTheCurrentSettings") };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
        const messages: Record<string, string> = {
            stale_interaction: t("server-settings.theServerChangedRefreshBeforeSavingSettingsAgain"),
            server_not_found: t("server-settings.thisServerIsUnavailableOrYouAreNoLongerIts"),
            operation_in_progress: t("server-settings.anotherServerOperationIsInProgressWaitForItTo"),
            invalid_request: t("server-settings.theServerSettingsAreInvalid"),
            request_conflict: t("server-settings.thisSettingsRequestWasAlreadyUsedForDifferentChangesRefresh"),
        };
        return { ok: false, rejected: Object.hasOwn(messages, code), message: messages[code] ?? t("server-settings.theSettingsUpdateCouldNotBeConfirmedRetryOrRefresh") };
    }
}
