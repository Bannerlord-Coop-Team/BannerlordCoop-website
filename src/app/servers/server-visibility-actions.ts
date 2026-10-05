"use server";

import { getTranslations } from "@/app/lib/localization/server";

import { MyServersApiError, requestServerVisibility } from "@/app/lib/hosting/my-servers";
import { listAllMyServers } from "@/app/lib/hosting/my-servers-server";
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
    let accessToken: string;
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: userData }, { data: sessionData }] = await Promise.all([
            supabase.auth.getUser(), supabase.auth.getSession(),
        ]);
        if (!userData.user || !sessionData.session || sessionData.session.user.id !== userData.user.id) {
            return { ok: false, rejected: true, message: t("server-visibility.pleaseSignInAgainBeforeChangingVisibility") };
        }
        accessToken = sessionData.session.access_token;
    } catch {
        return { ok: false, message: t("server-visibility.visibilityCouldNotBeUpdatedOnlyTheCurrentOwnerCan") };
    }
    const acknowledged = (updatedAt: string) => {
        revalidatePath("/servers");
        revalidatePath(`/servers/${input.serverId}`);
        // A replay acknowledges the original receipt, not necessarily the current preference.
        return { ok: true, updatedAt, message: t("server-visibility.discoveryPreferenceUpdateAcknowledgedRefreshingTheCurrentSetting") };
    };
    try {
        // The control plane rechecks current ownership; no actor or role is supplied by the browser.
        return acknowledged((await requestServerVisibility(accessToken, input, requestId)).updatedAt);
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "visibility_update_failed";
        if (code === "request_conflict" || code === "stale_interaction") {
            try {
                const retried = await retryAtCurrentRevision(accessToken, input);
                if (retried !== null) return acknowledged(retried);
            } catch (retryError) {
                const retryCode = retryError instanceof MyServersApiError ? retryError.code : "visibility_update_failed";
                console.error("Server visibility retry failed", { code: retryCode });
            }
            return { ok: false, rejected: true, message: t("server-visibility.theServerChangedRefreshAndTryAgain") };
        }
        console.error("Server visibility update failed", { code });
        return { ok: false, rejected: ["server_not_found", "invalid_request"].includes(code), message: t("server-visibility.visibilityCouldNotBeUpdatedOnlyTheCurrentOwnerCan") };
    }
}

/**
 * A revision conflict usually means another write advanced the server, not that its visibility changed.
 * Visibility has only two values, so if it still differs from the owner's explicit choice, apply that choice
 * once at the current revision. Returns the acknowledged revision, or null when the owner can no longer act.
 */
async function retryAtCurrentRevision(accessToken: string, input: VisibilityMutation): Promise<string | null> {
    const server = (await listAllMyServers(accessToken)).find((candidate) => candidate.serverId === input.serverId);
    if (!server || server.accessRole !== "owner") return null;
    if ((server.visibility ?? "private") === input.visibility) return server.updatedAt;
    const result = await requestServerVisibility(accessToken, { ...input, expectedUpdatedAt: server.updatedAt }, crypto.randomUUID());
    return result.updatedAt;
}
