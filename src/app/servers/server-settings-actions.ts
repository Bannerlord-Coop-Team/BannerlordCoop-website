"use server";

import { getTranslations } from "@/app/lib/localization/server";

import { MyServersApiError, requestMyServerSettings } from "@/app/lib/hosting/my-servers";
import { listAllMyServers } from "@/app/lib/hosting/my-servers-server";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { hasExactKeys, isRecord } from "../../../supabase/functions/_shared/dto-validation";
import { REQUEST_ID } from "../../../supabase/functions/_shared/server-visibility-contract";
import { HOSTING_MAINTENANCE_SLOTS, parseOwnerSettingsMutation, type MaintenanceSlot, type OwnerSettingsMutation } from "../../../supabase/functions/_shared/server-settings-contract";
import { managedServerNameMessage, managedServerNameProblem } from "@/app/servers/managed-server-name-validation";
import { revalidatePath } from "next/cache";

export type ServerSettingsField = "displayName" | "maintenanceSlot";
/** The values the page showed for each changed field, so a revision conflict can be told apart from a real edit. */
export type ServerSettingsPrevious = Partial<Record<ServerSettingsField, string>>;

// Authenticates settings changes and localizes the existing result.
export async function saveServerSettings(value: unknown): Promise<{ ok: boolean; message: string; updatedAt?: string; rejected?: boolean; field?: ServerSettingsField }> {
    const { t } = await getTranslations("managed-server");
    let input;
    let requestId: string;
    let previous: ServerSettingsPrevious | null;
    try {
        if (!isRecord(value) || !(hasExactKeys(value, ["serverId", "expectedUpdatedAt", "patch", "requestId"])
            || hasExactKeys(value, ["serverId", "expectedUpdatedAt", "patch", "requestId", "previous"]))
            || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid request");
        requestId = value.requestId;
        input = parseOwnerSettingsMutation({ serverId: value.serverId, expectedUpdatedAt: value.expectedUpdatedAt, patch: value.patch });
        previous = parsePrevious(value.previous);
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
    let accessToken: string;
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
        if (!user || !session || session.user.id !== user.id) return { ok: false, rejected: true, message: t("server-settings.pleaseSignInAgainBeforeSavingServerSettings") };
        accessToken = session.access_token;
    } catch {
        return { ok: false, message: t("server-settings.theSettingsUpdateCouldNotBeConfirmedRetryOrRefresh") };
    }
    const saved = (updatedAt: string) => {
        revalidatePath("/servers");
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, updatedAt, message: t("server-settings.serverSettingsSavedRefreshingTheCurrentSettings") };
    };
    try {
        return saved((await requestMyServerSettings(accessToken, input, requestId)).updatedAt);
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
        if ((code === "request_conflict" || code === "stale_interaction") && previous !== null) {
            try {
                const retried = await retryAtCurrentRevision(accessToken, input, previous);
                if (retried.outcome === "saved") return saved(retried.updatedAt);
                if (retried.outcome === "changed") return { ok: false, rejected: true, field: retried.field,
                    message: t("server-settings.thisSettingWasChangedElsewhereWhileThePageWasOpen") };
            } catch {
                // Fall through to the ordinary explanation; the page refreshes before the next attempt.
            }
        }
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

// Accepts only bounded strings for known fields; anything else disables the conflict retry.
function parsePrevious(value: unknown): ServerSettingsPrevious | null {
    if (value === undefined || !isRecord(value)) return null;
    const previous: ServerSettingsPrevious = {};
    for (const [key, entry] of Object.entries(value)) {
        if ((key !== "displayName" && key !== "maintenanceSlot") || typeof entry !== "string" || entry.length > 200) return null;
        previous[key] = entry;
    }
    return previous;
}

/**
 * A revision conflict usually means another write (such as a status check) advanced the server, not that the owner's
 * fields changed. Re-read the server: fields that already hold the requested value are done, and the rest are applied
 * once at the current revision only if they still hold the values the page showed. A field changed elsewhere is reported.
 */
async function retryAtCurrentRevision(accessToken: string, input: OwnerSettingsMutation, previous: ServerSettingsPrevious):
    Promise<{ outcome: "saved"; updatedAt: string } | { outcome: "changed"; field: ServerSettingsField } | { outcome: "unavailable" }> {
    const server = (await listAllMyServers(accessToken)).find((candidate) => candidate.serverId === input.serverId);
    if (!server || server.accessRole !== "owner") return { outcome: "unavailable" };
    const current: Record<ServerSettingsField, string | undefined> = { displayName: server.displayName, maintenanceSlot: server.maintenanceSlot };
    const remaining: OwnerSettingsMutation["patch"] = {};
    for (const field of Object.keys(input.patch) as ServerSettingsField[]) {
        if (current[field] === input.patch[field]) continue;
        if (previous[field] === undefined || current[field] !== previous[field]) return { outcome: "changed", field };
        Object.assign(remaining, { [field]: input.patch[field] });
    }
    if (Object.keys(remaining).length === 0) return { outcome: "saved", updatedAt: server.updatedAt };
    const result = await requestMyServerSettings(accessToken, { serverId: input.serverId, expectedUpdatedAt: server.updatedAt, patch: remaining }, crypto.randomUUID());
    return { outcome: "saved", updatedAt: result.updatedAt };
}
