"use server";

import { getTranslations } from "@/app/lib/localization/server";

import {
    MyServersApiError,
    getMyServerBackupStatus,
    requestMyServerBackupOperation,
} from "@/app/lib/hosting/my-servers";
import { parseManagedServerBackupInput } from "@/app/servers/managed-server-backup-input";
import { backupRequestOutcomeIsUncertain } from "@/app/servers/managed-server-backup-errors";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ManagedServerBackupActionResult =
    | { ok: true; message: string; jobId: string }
    | { ok: false; message: string; retrySameRequest: boolean };

// Authenticates backup operations and preserves durable retry identity.
export async function manageServerBackup(input: unknown, expectedPageUserId: unknown): Promise<ManagedServerBackupActionResult> {
    const { t } = await getTranslations("managed-server");
    const parsed = parseManagedServerBackupInput(input);
    if (parsed === null) return rejected(t("action.backup.theBackupRequestIsInvalid"));

    let accessToken: string | null = null;
    try {
        const supabase = await getSupabaseServerClient();
        const [{ data: userData }, { data: sessionData }] = await Promise.all([
            supabase.auth.getUser(),
            supabase.auth.getSession(),
        ]);
        if (userData.user === null) {
            return uncertain(t("action.backup.pleaseSignInAgainBeforeManagingBackupsThenRetryThe"));
        }
        // This caller-supplied comparison can only restrict dispatch. Authentication and
        // backend authorization still derive exclusively from the current session.
        if (typeof expectedPageUserId !== "string" || expectedPageUserId !== userData.user.id) {
            return uncertain(t("action.backup.yourSignedInAccountChangedSignInWithTheAccount"));
        }
        accessToken = sessionData.session?.access_token ?? null;
    } catch {
        return uncertain(t("action.backup.yourAuthenticatedServerSessionIsUnavailableRetryThePendingRequest"));
    }
    if (accessToken === null) {
        return uncertain(t("action.backup.pleaseSignInAgainBeforeManagingBackupsThenRetryThe"));
    }

    try {
        const { requestId, ...operation } = parsed;
        const submit = (expectedUpdatedAt: string) => requestMyServerBackupOperation(
            accessToken, { ...operation, expectedUpdatedAt }, requestId,
        );
        let result;
        try {
            result = await submit(parsed.expectedUpdatedAt);
        } catch (error) {
            if (!(error instanceof MyServersApiError) || error.code !== "stale_interaction" || error.operationId !== undefined) throw error;
            revalidatePath("/servers");
            revalidatePath(`/servers/${parsed.serverId}`);
            const current = await getMyServerBackupStatus(accessToken, parsed.serverId);
            if (current.updatedAt === parsed.expectedUpdatedAt) throw error;
            // The backend checks durable replay before generation, then rejects stale
            // state before enqueue. Preserve the UUID/backup selection and retry once.
            result = await submit(current.updatedAt);
        }
        revalidatePath("/servers");
        revalidatePath(`/servers/${parsed.serverId}`);
        return {
            ok: true,
            message: result.outcome === "existing"
                ? parsed.action === "create-backup"
                    ? t("action.backup.thatBackupRequestWasAlreadyAccepted")
                    : t("action.backup.thatRestoreRequestWasAlreadyAccepted")
                : parsed.action === "create-backup"
                    ? t("action.backup.backupRequestAccepted")
                    : t("action.backup.saveRestoreRequestAccepted"),
            jobId: result.jobId,
        };
    } catch (error) {
        const code = error instanceof MyServersApiError ? error.code : "operation_failed";
        console.error("Managed server backup operation failed", { code });
        if (backupRequestOutcomeIsUncertain(error)) {
            return uncertain(
                t("action.backup.theSubmissionOutcomeCouldNotBeConfirmedRetryThisRequest"),
            );
        }
        if (code === "stale_interaction") {
            revalidatePath("/servers");
            revalidatePath(`/servers/${parsed.serverId}`);
            return uncertain(t("action.backup.theServerIsStillChangingYourRequestIsSavedRetry"));
        }
        if (code === "server_not_found" || code === "access_denied") {
            // Authority is checked before replay, so this cannot resolve an earlier submission.
            return uncertain(t("action.backup.thisServerIsUnavailableOrYourAccessWasRemovedThe"));
        }
        if (["backup_not_found", "backup_expired", "backup_unavailable"].includes(code)) {
            revalidatePath(`/servers/${parsed.serverId}`);
            return rejected(t("action.backup.thatBackupIsNoLongerAvailableToRestore"));
        }
        if (code === "backup_build_mismatch") {
            revalidatePath(`/servers/${parsed.serverId}`);
            return rejected(t("action.backup.saveOnlyRestoreRequiresABackupFromTheCurrentlyInstalled"));
        }
        if (code === "safe_stop_required") {
            revalidatePath(`/servers/${parsed.serverId}`);
            return rejected(t("action.backup.theGameCouldNotBeVerifiedStoppedSafelyRefreshIts"));
        }
        if (code === "operation_in_progress") {
            revalidatePath(`/servers/${parsed.serverId}`);
            return rejected(t("action.backup.anotherServerOperationIsActiveWaitForItsStatusTo"));
        }
        if (code === "operation_unavailable") {
            revalidatePath(`/servers/${parsed.serverId}`);
            return rejected(t("action.backup.thatBackupOperationIsNotAvailableInTheServerS"));
        }
        if (code === "rate_limited" || code === "busy") {
            return uncertain(t("action.backup.tooManyRequestsWereSubmittedPleaseWaitAndRetryThe"));
        }
        // Unknown/authentication rejections may happen before idempotency lookup.
        return uncertain(t("action.backup.theBackupOperationCouldNotBeConfirmedRightNowRetry"));
    }
}

// Presents a definitive backup rejection without enabling retries.
function rejected(message: string): ManagedServerBackupActionResult {
    return { ok: false, message, retrySameRequest: false };
}

// Presents an unconfirmed backup outcome while retaining retry identity.
function uncertain(message: string): ManagedServerBackupActionResult {
    return { ok: false, message, retrySameRequest: true };
}
