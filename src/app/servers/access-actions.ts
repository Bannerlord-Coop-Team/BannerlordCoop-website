"use server";

import {
    getLiveConsoleAccessLevel,
    getMemberRole,
    hasAdminAccess,
} from "@/app/lib/auth/access";
import {
    getOperatedLiveConsoleServerIds,
    getOwnedLiveConsoleServerIds,
    LIVE_CONSOLE_OPERATOR_IDS_KEY,
    LIVE_CONSOLE_OWNER_IDS_KEY,
    withLiveConsoleServerAssignment,
} from "@/app/lib/console/access";
import { getLiveConsoleServer } from "@/app/lib/console/servers";
import { getSupabaseAdminClient } from "@/app/lib/supabase/admin";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { listSupabaseUsers } from "@/app/lib/supabase/users";
import type { User } from "@supabase/supabase-js";
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

function metadataChanged(
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
) {
    return JSON.stringify(previous) !== JSON.stringify(next);
}

async function updateUserMetadata(user: User, appMetadata: Record<string, unknown>) {
    if (!metadataChanged(user.app_metadata, appMetadata)) return;

    const adminClient = getSupabaseAdminClient();
    const { error } = await adminClient.auth.admin.updateUserById(user.id, {
        app_metadata: appMetadata,
    });
    if (error) throw error;
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
            const orderedUsers = ownerChanged
                ? [...result.users.filter((user) => user.id !== target.id), target]
                : result.users;

            for (const user of orderedUsers) {
                let metadata = withLiveConsoleServerAssignment(
                    user.app_metadata,
                    LIVE_CONSOLE_OWNER_IDS_KEY,
                    serverId,
                    user.id === target.id,
                );
                if (ownerChanged || user.id === target.id) {
                    metadata = withLiveConsoleServerAssignment(
                        metadata,
                        LIVE_CONSOLE_OPERATOR_IDS_KEY,
                        serverId,
                        false,
                    );
                }
                await updateUserMetadata(user, metadata);
            }
        }
    } catch (error) {
        console.error("Live console owner assignment failed", error);
        actionError = "The server owner could not be updated.";
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
            for (const user of users) {
                let metadata = withLiveConsoleServerAssignment(
                    user.app_metadata,
                    LIVE_CONSOLE_OWNER_IDS_KEY,
                    serverId,
                    false,
                );
                metadata = withLiveConsoleServerAssignment(
                    metadata,
                    LIVE_CONSOLE_OPERATOR_IDS_KEY,
                    serverId,
                    false,
                );
                await updateUserMetadata(user, metadata);
            }
        }
    } catch (error) {
        console.error("Live console owner removal failed", error);
        actionError = "The server owner could not be removed.";
    }

    if (actionError) fail(actionError, serverId);
    finish(serverId, "Server owner and operator access removed.");
}

export async function addLiveConsoleOperator(formData: FormData) {
    const serverId = formServerId(formData);
    const email = accountEmail(formData);
    if (!serverId) fail("Choose a valid server.");
    if (!email) fail("Enter the operator's account email.", serverId);

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
            actionError = "No registered member has that email address.";
        } else if (result?.truncated) {
            actionError = "The member directory is too large to verify a unique owner safely.";
        } else if (owners.length !== 1) {
            actionError = "Assign exactly one server owner before adding operators.";
        } else if (getOwnedLiveConsoleServerIds(target.app_metadata).includes(serverId)) {
            actionError = "The server owner already has management access.";
        } else if (getMemberRole(target) === "Admin") {
            actionError = "Administrators already have management access.";
        } else {
            const metadata = withLiveConsoleServerAssignment(
                target.app_metadata,
                LIVE_CONSOLE_OPERATOR_IDS_KEY,
                serverId,
                true,
            );
            await updateUserMetadata(target, metadata);
        }
    } catch (error) {
        console.error("Live console operator assignment failed", error);
        actionError = "The operator could not be added.";
    }

    if (actionError) fail(actionError, serverId);
    finish(serverId, "Operator access added successfully.");
}

export async function removeLiveConsoleOperator(formData: FormData) {
    const serverId = formServerId(formData);
    const operatorUserId = String(formData.get("operatorUserId") ?? "");
    if (!serverId) fail("Choose a valid server.");
    if (!operatorUserId) fail("Choose a valid server operator.", serverId);

    const actor = await currentUser();
    if (!actor) redirect(`/login?next=${encodeURIComponent(`/servers/${serverId}`)}`);
    const actorAccess = getLiveConsoleAccessLevel(actor, serverId);
    if (actorAccess !== "admin" && actorAccess !== "owner") redirect("/servers");

    let actionError = "";
    try {
        const adminClient = getSupabaseAdminClient();
        const { data, error } = await adminClient.auth.admin.getUserById(operatorUserId);
        if (error || !data.user) {
            actionError = "That operator account could not be found.";
        } else if (!getOperatedLiveConsoleServerIds(data.user.app_metadata).includes(serverId)) {
            actionError = "That account is not an operator for this server.";
        } else {
            const metadata = withLiveConsoleServerAssignment(
                data.user.app_metadata,
                LIVE_CONSOLE_OPERATOR_IDS_KEY,
                serverId,
                false,
            );
            await updateUserMetadata(data.user, metadata);
        }
    } catch (error) {
        console.error("Live console operator removal failed", error);
        actionError = "The operator could not be removed.";
    }

    if (actionError) fail(actionError, serverId);
    finish(serverId, "Operator access removed successfully.");
}
