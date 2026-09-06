"use server";

import {
    MyServersApiError,
    requestMyServerBackupOperation,
} from "@/app/lib/hosting/my-servers";
import { parseManagedServerBackupInput } from "@/app/servers/managed-server-backup-input";
import { backupRequestOutcomeIsUncertain } from "@/app/servers/managed-server-backup-errors";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ManagedServerBackupActionResult =
    | { ok: true; message: string; jobId: string }
    | { ok: false; message: string; retrySameRequest: boolean };

export async function manageServerBackup(input: unknown, expectedPageUserId: unknown): Promise<ManagedServerBackupActionResult> {
    const parsed = parseManagedServerBackupInput(input);
    if (parsed === null) return rejected("The backup request is invalid.");

    let accessToken: string | null = null;
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: userData }, { data: sessionData }] = await Promise.all([
            supabase.auth.getUser(),
            supabase.auth.getSession(),
        ]);
        if (userData.user === null) {
            return uncertain("Please sign in again before managing backups; then retry the pending request.");
        }
        // This caller-supplied comparison can only restrict dispatch. Authentication and
        // backend authorization still derive exclusively from the current session.
        if (typeof expectedPageUserId !== "string" || expectedPageUserId !== userData.user.id) {
            return uncertain("Your signed-in account changed. Sign in with the account that submitted this request, then retry the pending request.");
        }
        accessToken = sessionData.session?.access_token ?? null;
    } catch {
        return uncertain("Your authenticated server session is unavailable. Retry the pending request once it recovers.");
    }
    if (accessToken === null) {
        return uncertain("Please sign in again before managing backups; then retry the pending request.");
    }

    try {
        const result = parsed.action === "create-backup"
            ? await requestMyServerBackupOperation(accessToken, {
                serverId: parsed.serverId,
                action: parsed.action,
                expectedUpdatedAt: parsed.expectedUpdatedAt,
            }, parsed.requestId)
            : await requestMyServerBackupOperation(accessToken, {
                serverId: parsed.serverId,
                backupId: parsed.backupId,
                action: parsed.action,
                expectedUpdatedAt: parsed.expectedUpdatedAt,
            }, parsed.requestId);
        revalidatePath("/servers");
        revalidatePath(`/servers/${parsed.serverId}`);
        return {
            ok: true,
            message: result.outcome === "existing"
                ? parsed.action === "create-backup"
                    ? "That backup request was already accepted."
                    : "That restore request was already accepted."
                : parsed.action === "create-backup"
                    ? "Backup request accepted."
                    : "Save restore request accepted.",
            jobId: result.jobId,
        };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "operation_failed";
        console.error("Managed server backup operation failed", { code });
        if (backupRequestOutcomeIsUncertain(error)) {
            return uncertain(
                "The submission outcome could not be confirmed. Retry this request to reconcile it without creating a duplicate.",
            );
        }
        if (code === "stale_interaction") {
            revalidatePath("/servers");
            revalidatePath(`/servers/${parsed.serverId}`);
            return rejected("The server or backup state changed. Refresh and try again.");
        }
        if (code === "server_not_found" || code === "access_denied") {
            // Authority is checked before replay, so this cannot resolve an earlier submission.
            return uncertain("This server is unavailable or your access was removed. The pending request remains unconfirmed.");
        }
        if (["backup_not_found", "backup_expired", "backup_unavailable"].includes(code)) {
            revalidatePath(`/servers/${parsed.serverId}`);
            return rejected("That backup is no longer available to restore.");
        }
        if (code === "backup_build_mismatch") {
            revalidatePath(`/servers/${parsed.serverId}`);
            return rejected("Save-only restore requires a backup from the currently installed game and mod version.");
        }
        if (code === "safe_stop_required") {
            revalidatePath(`/servers/${parsed.serverId}`);
            return rejected("The game could not be verified stopped safely. Refresh its status before trying again.");
        }
        if (code === "operation_in_progress") {
            revalidatePath(`/servers/${parsed.serverId}`);
            return rejected("Another server operation is active. Wait for its status to finish, then try again.");
        }
        if (code === "operation_unavailable") {
            revalidatePath(`/servers/${parsed.serverId}`);
            return rejected("That backup operation is not available in the server's current state.");
        }
        if (code === "rate_limited" || code === "busy") {
            return uncertain("Too many requests were submitted. Please wait and retry the pending request.");
        }
        // Unknown/authentication rejections may happen before idempotency lookup.
        return uncertain("The backup operation could not be confirmed right now. Retry the pending request.");
    }
}

function rejected(message: string): ManagedServerBackupActionResult {
    return { ok: false, message, retrySameRequest: false };
}

function uncertain(message: string): ManagedServerBackupActionResult {
    return { ok: false, message, retrySameRequest: true };
}
