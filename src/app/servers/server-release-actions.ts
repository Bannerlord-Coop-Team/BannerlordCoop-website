"use server";

import { getTranslations } from "@/app/lib/localization/server";

import { getMyServerUpdateStatus, MyServersApiError, requestMyServerRelease } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { exactKeys, isRecord, REQUEST_ID } from "../../../supabase/functions/_shared/server-visibility-contract";
import { parseReleaseMutation, type ReleaseStatus } from "../../../supabase/functions/_shared/server-release-contract";
import { revalidatePath } from "next/cache";

// Requires the current verified session before release operations.
async function accessToken() {
    const supabase = await getSupabaseServerClient();
    const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
    if (!user || !session || session.user.id !== user.id) throw new Error("Sign in again");
    return session.access_token;
}

// Submits the unchanged release-channel operation with localized results.
export async function changeServerRelease(value: unknown): Promise<{ ok: boolean; message: string; jobId?: string; rejected?: boolean }> {
    const { t } = await getTranslations("managed-server");
    try {
        if (!isRecord(value) || !exactKeys(value, ["serverId", "releaseChannel", "expectedUpdatedAt", "requestId"])
            || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid request");
        const input = parseReleaseMutation({ action: "set-release-channel", serverId: value.serverId,
            releaseChannel: value.releaseChannel, expectedUpdatedAt: value.expectedUpdatedAt });
        const result = await requestMyServerRelease(await accessToken(), input, value.requestId);
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, jobId: result.jobId, message: t("server-release.releaseChangeQueuedTheServerWillStopBackUpIts") };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
        const messages: Record<string, string> = {
            stale_interaction: t("server-release.theServerChangedRefreshBeforeSavingTheReleaseChannelAgain"),
            nightly_unavailable: t("server-release.nightlyReleasesAreCurrentlyUnavailable"),
            validated_build_unavailable: t("server-release.noValidatedBuildIsAvailableForThatChannel"),
            release_compatibility_unknown: t("server-release.campaignCompatibilityIsNotValidatedForThisReleaseContactHosting"),
            release_compatibility_unsafe: t("server-release.thatReleaseCannotSafelyReadThisCampaignTheChannelWas"),
            settings_unchanged: t("server-release.thisChannelIsAlreadySelected"),
        };
        return { ok: false, rejected: Object.hasOwn(messages, code), message: messages[code] ?? t("server-release.theReleaseChangeCouldNotBeConfirmedCheckProgressOr") };
    }
}

// Reads release progress under the existing session checks.
export async function readServerReleaseStatus(serverId: string): Promise<ReleaseStatus | null> {
    try { return await getMyServerUpdateStatus(await accessToken(), serverId); }
    catch { return null; }
}
