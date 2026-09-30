"use server";

import { getMyServerUpdateStatus, MyServersApiError, requestMyServerRelease } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { exactKeys, isRecord, REQUEST_ID } from "../../../supabase/functions/_shared/server-visibility-contract";
import { parseReleaseMutation, type ReleaseStatus } from "../../../supabase/functions/_shared/server-release-contract";
import { revalidatePath } from "next/cache";

async function accessToken() {
    const supabase = await getSupabaseServerClient();
    const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
    if (!user || !session || session.user.id !== user.id) throw new Error("Sign in again");
    return session.access_token;
}

export async function changeServerRelease(value: unknown): Promise<{ ok: boolean; message: string; jobId?: string; rejected?: boolean }> {
    try {
        if (!isRecord(value) || !exactKeys(value, ["serverId", "releaseChannel", "expectedUpdatedAt", "requestId"])
            || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid request");
        const input = parseReleaseMutation({ action: "set-release-channel", serverId: value.serverId,
            releaseChannel: value.releaseChannel, expectedUpdatedAt: value.expectedUpdatedAt });
        const result = await requestMyServerRelease(await accessToken(), input, value.requestId);
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, jobId: result.jobId, message: "Release change queued. The server will stop, back up its campaign, install the selected release, and start again." };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
        const messages: Record<string, string> = {
            stale_interaction: "The server changed. Refresh before saving the release channel again.",
            nightly_unavailable: "Nightly releases are currently unavailable.",
            validated_build_unavailable: "No validated build is available for that channel.",
            release_compatibility_unknown: "Campaign compatibility is not validated for this release. Contact hosting support.",
            release_compatibility_unsafe: "That release cannot safely read this campaign. The channel was not changed.",
            settings_unchanged: "This channel is already selected.",
        };
        return { ok: false, rejected: Object.hasOwn(messages, code), message: messages[code] ?? "The release change could not be confirmed. Check progress or retry this request before making another change." };
    }
}

export async function readServerReleaseStatus(serverId: string): Promise<ReleaseStatus | null> {
    try { return await getMyServerUpdateStatus(await accessToken(), serverId); }
    catch { return null; }
}
