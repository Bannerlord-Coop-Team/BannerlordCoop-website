"use server";

import { getLiveConsoleAccessLevel } from "@/app/lib/auth/access";
import { getLiveConsoleServer } from "@/app/lib/console/servers";
import { MAX_SERVER_DISPLAY_NAME_LENGTH, validateServerDisplayName } from "@/app/lib/hosting/server-names";
import { getTranslations } from "@/app/lib/localization/server";
import { saveServerDisplayName } from "@/app/lib/hosting/server-settings";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";

/** Renames an authorized live server with request-localized validation and failure messages. */
export async function renameLiveServer(formData: FormData) {
    const { t } = await getTranslations("managed-server");
    const serverId = String(formData.get("serverId") ?? "");
    const server = getLiveConsoleServer(serverId);
    if (!server) {
        return { ok: false as const, error: t("name.invalidServer") };
    }

    const name = validateServerDisplayName(formData.get("displayName"), {
        required: t("name.required"),
        singleLine: t("name.singleLine"),
        tooLong: t("name.tooLong", { maximum: MAX_SERVER_DISPLAY_NAME_LENGTH }),
    });
    if (!name.ok) return name;

    try {
        const supabase = await getSupabaseServerClient();
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) {
            return { ok: false as const, error: t("name.signIn") };
        }

        const accessLevel = getLiveConsoleAccessLevel(user, server.id);
        if (accessLevel !== "admin" && accessLevel !== "owner") {
            return {
                ok: false as const,
                error: t("name.forbidden"),
            };
        }

        await saveServerDisplayName({
            displayName: name.displayName,
            serverId: server.id,
            updatedBy: user.id,
        });
        revalidatePath("/servers");
        revalidatePath(`/servers/${server.id}`);

        return {
            ok: true as const,
            displayName: name.displayName,
        };
    } catch (error) {
        console.error("Live server rename failed", error);
        return {
            ok: false as const,
            error: t("name.saveFailed"),
        };
    }
}
