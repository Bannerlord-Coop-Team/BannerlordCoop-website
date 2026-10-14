"use server";

import { getTranslations } from "@/app/lib/localization/server";
import { MyServersApiError, requestMyServerManager } from "@/app/lib/hosting/my-servers";
import { getMyServerSummary } from "@/app/lib/hosting/my-servers-server";
import { findWebsiteAccountByEmail } from "@/app/lib/supabase/users";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export async function setServerManager(formData: FormData): Promise<{ ok: boolean; message: string }> {
    const { t } = await getTranslations("managed-server");
    const serverId = String(formData.get("serverId") ?? "");
    const email = String(formData.get("managerEmail") ?? "").trim().toLowerCase();
    if (!UUID.test(serverId) || !EMAIL.test(email) || email.length > 320) {
        return { ok: false, message: t("managerAccess.enterValidAccountEmail") };
    }
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: userData }, { data: sessionData }] = await Promise.all([
            supabase.auth.getUser(), supabase.auth.getSession(),
        ]);
        const user = userData.user;
        const accessToken = sessionData.session?.access_token;
        if (!user || !accessToken || sessionData.session?.user.id !== user.id) {
            return { ok: false, message: t("managerAccess.signInAgain") };
        }
        const server = await getMyServerSummary(accessToken, serverId);
        if (!server || server.accessRole !== "owner") return { ok: false, message: t("managerAccess.ownerOnly") };
        const target = await findWebsiteAccountByEmail(email);
        // Keep unknown-account and backend authorization responses intentionally generic.
        if (!target) return { ok: false, message: t("managerAccess.accountCouldNotBeFound") };
        const result = await requestMyServerManager(accessToken, {
            serverId, managerAccountId: target.accountId, enabled: true, expectedUpdatedAt: server.updatedAt,
        }, crypto.randomUUID());
        revalidatePath("/servers");
        revalidatePath(`/servers/${serverId}`);
        return { ok: true, message: result.changed ? t("managerAccess.accessGranted") : t("managerAccess.accessAlreadyGranted") };
    } catch (error) {
        if (error instanceof MyServersApiError && error.code === "unauthenticated") return { ok: false, message: t("managerAccess.signInAgain") };
        return { ok: false, message: t("managerAccess.requestCouldNotBeConfirmed") };
    }
}
