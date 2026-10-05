"use server";

import { getTranslations } from "@/app/lib/localization/server";

import { MyServersApiError, requestMyServerSettings } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { exactKeys, isRecord, REQUEST_ID } from "../../../supabase/functions/_shared/server-visibility-contract";
import { HOSTING_MAINTENANCE_SLOTS, parseOwnerSettingsMutation, type MaintenanceSlot } from "../../../supabase/functions/_shared/server-settings-contract";
import { managedServerNameMessage, managedServerNameProblem } from "@/app/servers/managed-server-name-validation";
import { revalidatePath } from "next/cache";

export type ServerSettingsField = "displayName" | "maintenanceSlot";

// Authenticates settings changes and localizes the existing result.
export async function saveServerSettings(value: unknown): Promise<{ ok: boolean; message: string; updatedAt?: string; rejected?: boolean; field?: ServerSettingsField }> {
    const { t } = await getTranslations("managed-server");
    let input;
    let requestId: string;
    try {
        if (!isRecord(value) || !exactKeys(value, ["serverId", "expectedUpdatedAt", "patch", "requestId"])
            || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid request");
        requestId = value.requestId;
        input = parseOwnerSettingsMutation({ serverId: value.serverId, expectedUpdatedAt: value.expectedUpdatedAt, patch: value.patch });
    } catch {
        // Name the field that failed when the patch shows it; the contract above remains the authority.
        const patch = isRecord(value) && isRecord(value.patch) ? value.patch : {};
        const nameProblem = Object.hasOwn(patch, "displayName") ? managedServerNameProblem(patch.displayName) : null;
        if (nameProblem !== null) return { ok: false, rejected: true, field: "displayName", message: managedServerNameMessage(nameProblem, t) };
        if (Object.hasOwn(patch, "maintenanceSlot") && !HOSTING_MAINTENANCE_SLOTS.includes(patch.maintenanceSlot as MaintenanceSlot)) {
            return { ok: false, rejected: true, field: "maintenanceSlot", message: t("server-settings.chooseOneOfTheListedMaintenanceWindows") };
        }
        return { ok: false, rejected: true, message: t("server-settings.theSettingsRequestIsInvalidRefreshThePageAndTryAgain") };
    }
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
