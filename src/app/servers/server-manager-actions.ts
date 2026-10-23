"use server";

import { getTranslations } from "@/app/lib/localization/server";
import { ownerRefusalMessage } from "@/app/lib/hosting/owner-refusal";
import { MyServersApiError, requestMyServerManager } from "@/app/lib/hosting/my-servers";
import { getMyServerSummary } from "@/app/lib/hosting/my-servers-server";
import { findWebsiteAccountByEmail } from "@/app/lib/supabase/users";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";

// Server and account IDs both match the owner API's resource ID check.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

type ManagerActionResult = { ok: boolean; message: string };
type Translate = Awaited<ReturnType<typeof getTranslations>>["t"];
type OwnerSession = { accessToken: string; updatedAt: string };

/** Grants manager access to the website account with the submitted exact email. */
export async function setServerManager(formData: FormData): Promise<ManagerActionResult> {
    const { t } = await getTranslations("managed-server");
    const serverId = String(formData.get("serverId") ?? "");
    const email = String(formData.get("managerEmail") ?? "").trim().toLowerCase();
    if (!UUID.test(serverId) || !EMAIL.test(email) || email.length > 320) {
        return { ok: false, message: t("managerAccess.enterValidAccountEmail") };
    }
    return await asOwner(t, serverId, async (owner) => {
        const target = await findWebsiteAccountByEmail(email);
        // Keep unknown-account and backend authorization responses intentionally generic.
        if (!target) return { ok: false, message: t("managerAccess.accountCouldNotBeFound") };
        const result = await requestMyServerManager(owner.accessToken, {
            serverId, managerAccountId: target.accountId, enabled: true, expectedUpdatedAt: owner.updatedAt,
        }, crypto.randomUUID());
        return { ok: true, message: result.changed ? t("managerAccess.accessGranted") : t("managerAccess.accessAlreadyGranted") };
    });
}

/** Revokes one listed manager's access to the owner's server. */
export async function removeServerManager(formData: FormData): Promise<ManagerActionResult> {
    const { t } = await getTranslations("managed-server");
    const serverId = String(formData.get("serverId") ?? "");
    const managerAccountId = String(formData.get("managerAccountId") ?? "").toLowerCase();
    if (!UUID.test(serverId) || !UUID.test(managerAccountId)) {
        return { ok: false, message: t("managerAccess.requestCouldNotBeConfirmed") };
    }
    return await asOwner(t, serverId, async (owner) => {
        const result = await requestMyServerManager(owner.accessToken, {
            serverId, managerAccountId, enabled: false, expectedUpdatedAt: owner.updatedAt,
        }, crypto.randomUUID());
        return { ok: true, message: result.changed ? t("managerAccess.accessRemoved") : t("managerAccess.accessAlreadyRemoved") };
    });
}

// Runs one manager change for a freshly verified owner session, then refreshes the server pages.
async function asOwner(t: Translate, serverId: string, change: (owner: OwnerSession) => Promise<ManagerActionResult>): Promise<ManagerActionResult> {
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
        const result = await change({ accessToken, updatedAt: server.updatedAt });
        if (!result.ok) return result;
        revalidatePath("/servers");
        revalidatePath(`/servers/${serverId}`);
        return result;
    } catch (error) {
        if (error instanceof MyServersApiError && error.code === "unauthenticated") return { ok: false, message: t("managerAccess.signInAgain") };
        const refusal = ownerRefusalMessage(error, t);
        if (refusal !== null) return { ok: false, message: refusal };
        return { ok: false, message: t("managerAccess.requestCouldNotBeConfirmed") };
    }
}
