"use server";

import { getTranslations } from "@/app/lib/localization/server";

import { getMyServerUpdateStatus, MyServersApiError, requestMyServerRelease } from "@/app/lib/hosting/my-servers";
import { listAllMyServers } from "@/app/lib/hosting/my-servers-server";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { hasExactKeys, isRecord } from "../../../supabase/functions/_shared/dto-validation";
import { REQUEST_ID } from "../../../supabase/functions/_shared/server-visibility-contract";
import { parseReleaseMutation, type ReleaseMutation, type ReleaseStatus } from "../../../supabase/functions/_shared/server-release-contract";
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
    let token: string | null = null;
    let input: ReleaseMutation | null = null;
    let previousChannel: string | null = null;
    const queued = (jobId: string, serverId: string) => {
        revalidatePath(`/servers/${serverId}`);
        return { ok: true, jobId, message: t("server-release.releaseChangeQueuedTheServerWillStopBackUpIts") };
    };
    try {
        if (!isRecord(value) || !(hasExactKeys(value, ["serverId", "releaseChannel", "expectedUpdatedAt", "requestId"])
            || hasExactKeys(value, ["serverId", "releaseChannel", "expectedUpdatedAt", "requestId", "previousChannel"]))
            || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid request");
        input = parseReleaseMutation({ action: "set-release-channel", serverId: value.serverId,
            releaseChannel: value.releaseChannel, expectedUpdatedAt: value.expectedUpdatedAt });
        previousChannel = typeof value.previousChannel === "string" && value.previousChannel.length <= 32 ? value.previousChannel : null;
        token = await accessToken();
        const result = await requestMyServerRelease(token, input, value.requestId);
        return queued(result.jobId, input.serverId);
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
        // A revision conflict from an unrelated write is retried once, only while the channel is still the one shown.
        if ((code === "request_conflict" || code === "stale_interaction") && token !== null && input !== null && previousChannel !== null) {
            try {
                const server = (await listAllMyServers(token)).find((candidate) => candidate.serverId === input!.serverId);
                if (server?.accessRole === "owner" && server.releaseChannel === input.releaseChannel) {
                    return { ok: false, rejected: true, message: t("server-release.thisChannelIsAlreadySelected") };
                }
                if (server?.accessRole === "owner" && server.releaseChannel === previousChannel) {
                    const result = await requestMyServerRelease(token, { ...input, expectedUpdatedAt: server.updatedAt }, crypto.randomUUID());
                    return queued(result.jobId, input.serverId);
                }
            } catch {
                // Fall through to the ordinary explanation below.
            }
        }
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
