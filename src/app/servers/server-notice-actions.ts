"use server";

import { getTranslations } from "@/app/lib/localization/server";

import { dismissServerNotice, MyServersApiError } from "@/app/lib/hosting/my-servers";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { hasExactKeys, isRecord } from "../../../supabase/functions/_shared/dto-validation";
import { REQUEST_ID } from "../../../supabase/functions/_shared/server-visibility-contract";

export type DismissServerNoticeResult = { ok: true } | { ok: false; message: string };

// Hides one notice for the signed-in viewer; the control plane rechecks current access to the server.
export async function dismissManagedServerNotice(value: unknown): Promise<DismissServerNoticeResult> {
    const { t } = await getTranslations("managed-server");
    if (!isRecord(value) || !hasExactKeys(value, ["serverId", "noticeId"])
        || typeof value.serverId !== "string" || !REQUEST_ID.test(value.serverId)
        || typeof value.noticeId !== "string" || !REQUEST_ID.test(value.noticeId)) {
        return { ok: false, message: t("notices.dismissFailed") };
    }
    const input = { serverId: value.serverId, noticeId: value.noticeId };
    let accessToken: string;
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: userData }, { data: sessionData }] = await Promise.all([
            supabase.auth.getUser(), supabase.auth.getSession(),
        ]);
        if (!userData.user || !sessionData.session || sessionData.session.user.id !== userData.user.id) {
            return { ok: false, message: t("notices.signInAgain") };
        }
        accessToken = sessionData.session.access_token;
    } catch {
        return { ok: false, message: t("notices.dismissFailed") };
    }
    try {
        await dismissServerNotice(accessToken, input, crypto.randomUUID());
        return { ok: true };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "notice_dismissal_failed";
        // The notice does not target this server (or no longer exists), so there is nothing left to show.
        if (code === "notice_not_found") return { ok: true };
        if (code === "impersonation_read_only") return { ok: false, message: t("notices.dismissReadOnly") };
        console.error("Server notice dismissal failed", { code });
        return { ok: false, message: t("notices.dismissFailed") };
    }
}
