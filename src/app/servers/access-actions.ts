"use server";

import { getTranslations } from "@/app/lib/localization/server";

import { isDatabaseContention } from "../../../supabase/functions/_shared/database-contention";

import {
    getLiveConsoleAccessLevel,
    getMemberRole,
    hasAdminAccess,
} from "@/app/lib/auth/access";
import {
    getAssignedLiveConsoleAccess,
    getOperatedLiveConsoleServerIds,
    getOwnedLiveConsoleServerIds,
} from "@/app/lib/console/access";
import { updateLiveConsoleAssignment } from "@/app/lib/console/assignment";
import { getLiveConsoleServer } from "@/app/lib/console/servers";
import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { listSupabaseUsers } from "@/app/lib/supabase/users";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function serverManagementUrl(
    serverId: string,
    key: "accessError" | "accessUpdated",
    value: string,
) {
    const params = new URLSearchParams({ [key]: value });
    return `/servers/${encodeURIComponent(serverId)}?${params.toString()}#server-access`;
}

function formServerId(formData: FormData) {
    const serverId = String(formData.get("serverId") ?? "");
    return getLiveConsoleServer(serverId)?.id ?? null;
}

function accountEmail(formData: FormData) {
    return String(formData.get("accountEmail") ?? "").trim().toLowerCase();
}

async function currentUser() {
    const sessionClient = await getSupabaseServerClient();
    const { data } = await sessionClient.auth.getUser();
    return data.user;
}

async function findAccountByEmail(email: string) {
    if (!email || email.length > 320) return null;
    const { users, truncated } = await listSupabaseUsers();
    return {
        users,
        truncated,
        account: users.find((user) => user.email?.toLowerCase() === email) ?? null,
    };
}

function finish(serverId: string, message: string) {
    revalidatePath("/servers");
    revalidatePath(`/servers/${serverId}`);
    redirect(serverManagementUrl(serverId, "accessUpdated", message));
}

function fail(message: string, serverId?: string): never {
    if (serverId) {
        redirect(serverManagementUrl(serverId, "accessError", message));
    }
    redirect(`/servers?${new URLSearchParams({ accessError: message }).toString()}#my-servers`);
}

export async function assignLiveConsoleOwner(formData: FormData) {
    const serverId = formServerId(formData);
    const email = accountEmail(formData);
    if (!serverId) fail("Choose a valid server.");
    if (!email) fail("Enter the owner's account email.", serverId);

    const actor = await currentUser();
    if (!actor) redirect(`/login?next=${encodeURIComponent(`/servers/${serverId}`)}`);
    if (!hasAdminAccess(actor)) redirect("/servers");

    let actionError = "";
    try {
        const result = await findAccountByEmail(email);
        const target = result?.account;
        if (!result || !target) {
            actionError = "No registered member has that email address.";
        } else if (result.truncated) {
            actionError = "The member directory is too large to assign a unique owner safely.";
        } else {
            const currentOwners = result.users.filter((user) =>
                getOwnedLiveConsoleServerIds(user.app_metadata).includes(serverId),
            );
            const ownerChanged =
                currentOwners.length !== 1 || currentOwners[0].id !== target.id;
            const assignedUsers = result.users.filter((user) =>
                user.id === target.id || getAssignedLiveConsoleAccess(user.app_metadata, serverId),
            );
            const orderedUsers = ownerChanged
                ? [...assignedUsers.filter((user) => user.id !== target.id), target]
                : assignedUsers;
            const adminClient = getSupabaseAdminClient();

            for (const user of orderedUsers) {
                await updateLiveConsoleAssignment(adminClient, user.id, serverId, {
                    owner: user.id === target.id,
                    operator: ownerChanged || user.id === target.id ? false : undefined,
                });
            }
        }
    } catch (error) {
        actionError = isDatabaseContention(error) ? "The account is busy. Refresh assignments and retry the same change." : "The server owner could not be updated.";
    }

    if (actionError) fail(actionError, serverId);
    finish(serverId, "Server owner updated successfully.");
}

export async function clearLiveConsoleOwner(formData: FormData) {
    const serverId = formServerId(formData);
    if (!serverId) fail("Choose a valid server.");

    const actor = await currentUser();
    if (!actor) redirect(`/login?next=${encodeURIComponent(`/servers/${serverId}`)}`);
    if (!hasAdminAccess(actor)) redirect("/servers");

    let actionError = "";
    try {
        const { users, truncated } = await listSupabaseUsers();
        if (truncated) {
            actionError = "The member directory is too large to remove every assignment safely.";
        } else {
            const assignedUsers = users.filter((user) =>
                getAssignedLiveConsoleAccess(user.app_metadata, serverId),
            );
            const adminClient = getSupabaseAdminClient();
            for (const user of assignedUsers) {
                await updateLiveConsoleAssignment(adminClient, user.id, serverId, {
                    owner: false,
                    operator: false,
                });
            }
        }
    } catch (error) {
        actionError = isDatabaseContention(error) ? "The account is busy. Refresh assignments and retry the same change." : "The server owner could not be removed.";
    }

    if (actionError) fail(actionError, serverId);
    finish(serverId, "Server owner and operator access removed.");
}

/** Adds delegated live access after the existing actor and owner checks, returning localized feedback. */
export async function addLiveConsoleOperator(formData: FormData) {
    const { t } = await getTranslations("live-server");
    const serverId = formServerId(formData);
    const email = accountEmail(formData);
    if (!serverId) fail(t("action.invalidServer"));
    if (!email) fail(t("action.operatorEmail"), serverId);

    const actor = await currentUser();
    if (!actor) redirect(`/login?next=${encodeURIComponent(`/servers/${serverId}`)}`);
    const actorAccess = getLiveConsoleAccessLevel(actor, serverId);
    if (actorAccess !== "admin" && actorAccess !== "owner") redirect("/servers");

    let actionError = "";
    try {
        const result = await findAccountByEmail(email);
        const target = result?.account;
        const owners = result?.users.filter((user) =>
            getOwnedLiveConsoleServerIds(user.app_metadata).includes(serverId),
        ) ?? [];
        if (!target) {
            actionError = t("action.missingAccount");
        } else if (result?.truncated) {
            actionError = t("action.directoryTooLarge");
        } else if (owners.length !== 1) {
            actionError = t("action.uniqueOwnerRequired");
        } else if (getOwnedLiveConsoleServerIds(target.app_metadata).includes(serverId)) {
            actionError = t("action.ownerHasAccess");
        } else if (getMemberRole(target) === "Admin") {
            actionError = t("action.adminHasAccess");
        } else {
            await updateLiveConsoleAssignment(getSupabaseAdminClient(), target.id, serverId, {
                operator: true,
            });
        }
    } catch (error) {
        actionError = isDatabaseContention(error) ? t("action.accountBusy") : t("action.addFailed");
    }

    if (actionError) fail(actionError, serverId);
    finish(serverId, t("action.added"));
}

/** Removes delegated live access after the existing authorization checks, returning localized feedback. */
export async function removeLiveConsoleOperator(formData: FormData) {
    const { t } = await getTranslations("live-server");
    const serverId = formServerId(formData);
    const operatorUserId = String(formData.get("operatorUserId") ?? "");
    if (!serverId) fail(t("action.invalidServer"));
    if (!operatorUserId) fail(t("action.invalidOperator"), serverId);

    const actor = await currentUser();
    if (!actor) redirect(`/login?next=${encodeURIComponent(`/servers/${serverId}`)}`);
    const actorAccess = getLiveConsoleAccessLevel(actor, serverId);
    if (actorAccess !== "admin" && actorAccess !== "owner") redirect("/servers");

    let actionError = "";
    try {
        const adminClient = getSupabaseAdminClient();
        const { data, error } = await adminClient.auth.admin.getUserById(operatorUserId);
        if (error || !data.user) {
            actionError = t("action.operatorMissing");
        } else if (!getOperatedLiveConsoleServerIds(data.user.app_metadata).includes(serverId)) {
            actionError = t("action.notOperator");
        } else {
            await updateLiveConsoleAssignment(adminClient, data.user.id, serverId, {
                operator: false,
            });
        }
    } catch (error) {
        actionError = isDatabaseContention(error) ? t("action.accountBusy") : t("action.removeFailed");
    }

    if (actionError) fail(actionError, serverId);
    finish(serverId, t("action.removed"));
}
