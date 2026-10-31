"use server";

import { getTranslations } from "@/app/lib/localization/server";
import { ownerRefusalMessage } from "@/app/lib/hosting/owner-refusal";

import { getMyServerBuildOptions, getMyServerBuildStatus, MyServersApiError, requestMyServerBuildChange } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { hasExactKeys, isRecord } from "../../../supabase/functions/_shared/dto-validation";
import { REQUEST_ID } from "../../../supabase/functions/_shared/server-visibility-contract";
import { parseBuildMutation, type BuildMutation, type BuildOptions, type BuildStatus } from "../../../supabase/functions/_shared/server-build-contract";
import { revalidatePath } from "next/cache";

// Requires the current verified session before version operations.
async function accessToken() {
    const supabase = await getSupabaseServerClient();
    const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
    if (!user || !session || session.user.id !== user.id) throw new Error("Sign in again");
    return session.access_token;
}

export type ServerBuildChangeResult = {
    ok: boolean;
    message: string;
    outcome?: "enqueued" | "existing" | "pinned" | "unpinned";
    jobId?: string | null;
    rejected?: boolean;
};

// Submits one version choice (a public version tag, or null for Latest) with localized results.
export async function changeServerBuild(value: unknown): Promise<ServerBuildChangeResult> {
    const { t } = await getTranslations("managed-server");
    let input: BuildMutation;
    let requestId: string;
    try {
        if (!isRecord(value) || !hasExactKeys(value, ["serverId", "buildId", "expectedUpdatedAt", "acknowledgeSaveRisk", "requestId"])
            || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid request");
        requestId = value.requestId;
        input = parseBuildMutation({ action: "set-server-build", serverId: value.serverId, buildId: value.buildId,
            expectedUpdatedAt: value.expectedUpdatedAt, acknowledgeSaveRisk: value.acknowledgeSaveRisk });
    } catch {
        return { ok: false, rejected: true, message: t("serverBuild.chooseOneOfTheListedPublicVersions") };
    }
    try {
        const result = await requestMyServerBuildChange(await accessToken(), input, requestId);
        revalidatePath(`/servers/${input.serverId}`);
        const message = result.outcome === "pinned" ? t("serverBuild.versionSelectedAutomaticUpdatesPaused", { version: input.buildId ?? "" })
            : result.outcome === "unpinned" ? t("serverBuild.automaticUpdatesAreOnAgain")
                : t("serverBuild.versionChangeQueuedFollowItsProgressBelow");
        return { ok: true, outcome: result.outcome, jobId: result.jobId, message };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
        const messages: Record<string, string> = {
            stale_interaction: t("serverBuild.theServerChangedRefreshAndChooseTheVersionAgain"),
            save_risk_unacknowledged: t("serverBuild.confirmThatYouUnderstandTheCampaignRiskFirst"),
            release_compatibility_unsafe: t("serverBuild.thatVersionCannotSafelyReadYourCampaign"),
            release_compatibility_unknown: t("serverBuild.thatVersionCannotSafelyReadYourCampaign"),
            validated_build_unavailable: t("serverBuild.thatVersionIsNoLongerAvailableChooseAnother"),
            invalid_build_selection: t("serverBuild.chooseOneOfTheListedPublicVersions"),
            build_selection_unavailable: t("serverBuild.choosingAVersionIsOnlyAvailableOnTheStableChannel"),
            operation_in_progress: t("serverBuild.anotherServerOperationIsRunningTryAgainWhenItFinishes"),
            request_conflict: t("serverBuild.anotherServerOperationIsRunningTryAgainWhenItFinishes"),
            settings_unchanged: t("serverBuild.thatVersionIsAlreadySelected"),
            no_update_available: t("serverBuild.thisServerAlreadyFollowsTheLatestPublicVersion"),
        };
        const refusal = !Object.hasOwn(messages, code) ? ownerRefusalMessage(error, t) : null;
        if (refusal !== null) return { ok: false, rejected: true, message: refusal };
        return { ok: false, rejected: Object.hasOwn(messages, code), message: messages[code] ?? t("serverBuild.theVersionChangeCouldNotBeConfirmedCheckProgressOrTryAgain") };
    }
}

// Reads the versions this server can install; null for any failure, including a control plane without the read.
export async function readServerBuildOptions(serverId: string): Promise<BuildOptions | null> {
    try { return await getMyServerBuildOptions(await accessToken(), serverId); }
    catch { return null; }
}

// Reads the phase-by-phase state of the server's current or latest update job.
export async function readServerBuildStatus(serverId: string): Promise<BuildStatus | null> {
    try { return await getMyServerBuildStatus(await accessToken(), serverId); }
    catch { return null; }
}
