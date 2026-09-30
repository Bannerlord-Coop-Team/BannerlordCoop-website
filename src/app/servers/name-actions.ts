"use server";

import { getLiveConsoleAccessLevel } from "@/app/lib/auth/access";
import { getLiveConsoleServer } from "@/app/lib/console/servers";
import { validateServerDisplayName } from "@/app/lib/hosting/server-names";
import { saveServerDisplayName } from "@/app/lib/hosting/server-settings";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function renameLiveServer(formData: FormData) {
    const serverId = String(formData.get("serverId") ?? "");
    const server = getLiveConsoleServer(serverId);
    if (!server) {
        return { ok: false as const, error: "Choose a valid live server." };
    }

    const name = validateServerDisplayName(formData.get("displayName"));
    if (!name.ok) return name;

    try {
        const supabase = await getSupabaseServerClient();
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) {
            return { ok: false as const, error: "Sign in again before renaming this server." };
        }

        const accessLevel = getLiveConsoleAccessLevel(user, server.id);
        if (accessLevel !== "admin" && accessLevel !== "owner") {
            return {
                ok: false as const,
                error: "Only an administrator or the assigned owner can rename this server.",
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
            error: "The server name could not be saved. Verify the Supabase migration and try again.",
        };
    }
}
