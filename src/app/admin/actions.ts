"use server";

import { hasAdminAccess, isBootstrapAdmin } from "@/app/lib/auth/access";
import { isMemberRole } from "@/app/lib/auth/roles";
import { isDatabaseContention } from "../../../supabase/functions/_shared/database-contention";
import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function adminUrl(key: "error" | "updated", value: string, query: string) {
    const params = new URLSearchParams({ [key]: value });
    if (query) params.set("q", query);
    return `/admin?${params.toString()}`;
}

export async function updateMemberRole(formData: FormData) {
    const userId = String(formData.get("userId") ?? "");
    const role = formData.get("role");
    const query = String(formData.get("query") ?? "").trim().slice(0, 100);

    if (!userId || !isMemberRole(role)) {
        redirect(adminUrl("error", "Invalid role update request.", query));
    }

    const sessionClient = await getSupabaseServerClient();
    const { data: sessionData } = await sessionClient.auth.getUser();
    const currentUser = sessionData.user;

    if (!currentUser) redirect("/login?next=/admin");
    if (!hasAdminAccess(currentUser)) redirect("/");

    if (currentUser.id === userId && role !== "Admin") {
        redirect(adminUrl("error", "You cannot remove your own admin role.", query));
    }

    let updateError = "";

    try {
        const adminClient = getSupabaseAdminClient();
        const { data: targetData, error: targetError } =
            await adminClient.auth.admin.getUserById(userId);

        if (targetError || !targetData.user) {
            updateError = "That member could not be found.";
        } else if (isBootstrapAdmin(targetData.user.email) && role !== "Admin") {
            updateError = "Bootstrap administrators must remain admins.";
        } else {
            const { error } = await adminClient.rpc("set_member_role", { p_user_id: userId, p_role: role });

            if (error) throw error;
        }
    } catch (error) {
        updateError = isDatabaseContention(error) ? "The account is busy. Refresh and retry the same role change." : "The member role could not be updated.";
    }

    if (updateError) redirect(adminUrl("error", updateError, query));

    revalidatePath("/admin");
    revalidatePath("/");
    redirect(adminUrl("updated", "Role updated successfully.", query));
}
