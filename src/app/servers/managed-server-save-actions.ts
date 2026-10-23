"use server";

import { getTranslations } from "@/app/lib/localization/server";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { deleteMyServerSave, getMyServerSaveDeletionStatus, MyServersApiError, selectMyServerSave } from "@/app/lib/hosting/my-servers";
import type { SaveDeletionStatus } from "../../../supabase/functions/_shared/server-save-deletion-contract";
import { hasExactKeys, isRecord } from "../../../supabase/functions/_shared/dto-validation";
import { requireFileTimestamp, requireUuid } from "../../../supabase/functions/_shared/server-file-contract";
import { revalidatePath } from "next/cache";

type SaveActionInput = { serverId: string; saveId: string; expectedUpdatedAt: string; requestId: string; confirmationText?: string };
type SaveActionResult = { ok: true; message: string } | { ok: false; message: string };

async function accessToken(expectedUserId: string): Promise<string> {
    const supabase = await getSupabaseServerClient();
    const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
    if (!user || user.id !== expectedUserId || !session || session.user.id !== user.id) throw new Error("Authentication changed");
    return session.access_token;
}

function parseInput(value: unknown, deleting: boolean): SaveActionInput {
    if (!isRecord(value) || !hasExactKeys(value, deleting
        ? ["confirmationText", "expectedUpdatedAt", "requestId", "saveId", "serverId"]
        : ["expectedUpdatedAt", "requestId", "saveId", "serverId"])) throw new Error("Invalid campaign request");
    requireUuid(value.serverId); requireUuid(value.saveId); requireUuid(value.requestId); requireFileTimestamp(value.expectedUpdatedAt);
    if (deleting && (typeof value.confirmationText !== "string" || value.confirmationText.length < 1 || value.confirmationText.length > 48)) throw new Error("Invalid campaign confirmation");
    return value as unknown as SaveActionInput;
}

async function failure(): Promise<SaveActionResult> {
    const { t } = await getTranslations("managed-server");
    return { ok: false, message: t("campaigns.selectionFailed") };
}

export async function selectManagedServerSave(value: unknown, expectedUserId: string): Promise<SaveActionResult> {
    const { t } = await getTranslations("managed-server");
    let input: SaveActionInput;
    try { input = parseInput(value, false); } catch { return { ok: false, message: t("campaigns.selectionFailed") }; }
    try {
        const { requestId, ...selection } = input;
        await selectMyServerSave(await accessToken(expectedUserId), selection, requestId);
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, message: t("campaigns.selected") };
    } catch (error) {
        return error instanceof MyServersApiError && error.code === "invalid_request"
            ? { ok: false, message: t("campaigns.selectionFailed") }
            : await failure();
    }
}

export async function deleteManagedServerSave(value: unknown, expectedUserId: string): Promise<
    { ok: true; jobId: string; message: string } | { ok: false; message: string; notSubmitted: boolean }
> {
    const { t } = await getTranslations("managed-server");
    let input: SaveActionInput;
    try { input = parseInput(value, true); } catch { return { ok: false, message: t("campaigns.deleteFailed"), notSubmitted: true }; }
    try {
        const { requestId, ...deletion } = input;
        const result = await deleteMyServerSave(await accessToken(expectedUserId), deletion as Required<Omit<SaveActionInput, "requestId">>, requestId);
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, jobId: result.jobId, message: t("campaigns.deleted") };
    } catch (error) {
        return { ok: false, notSubmitted: error instanceof MyServersApiError && ["save_not_found", "server_suspended", "save_still_loaded", "safe_stop_required", "confirmation_mismatch", "active_save_delete_forbidden", "packaged_save_delete_forbidden", "stale_interaction", "invalid_request", "unauthorized", "forbidden"].includes(error.code), message: t(error instanceof MyServersApiError && error.code === "save_still_loaded"
            ? "campaigns.saveStillLoaded" : "campaigns.deleteFailed") };
    }
}

export async function readManagedServerSaveDeletion(serverId: string, jobId: string, expectedUserId: string): Promise<
    { ok: true; status: SaveDeletionStatus; message: string } | { ok: false; message: string }
> {
    const { t } = await getTranslations("managed-server");
    try {
        requireUuid(serverId); requireUuid(jobId);
        const status = await getMyServerSaveDeletionStatus(await accessToken(expectedUserId), serverId, jobId);
        const key = status.state === "succeeded" ? "campaigns.deleteSucceeded"
            : status.state === "queued" ? "campaigns.deleted"
            : status.state === "running" ? "campaigns.deleteRunning"
            : status.state === "retry-wait" ? "campaigns.deletePending"
            : status.errorCode === "save_still_loaded" ? "campaigns.saveStillLoaded"
            : status.errorCode === "queue_timeout" ? "campaigns.deleteQueueTimeout" : "campaigns.deleteOutcomeFailed";
        return { ok: true, status, message: t(key) };
    } catch {
        return { ok: false, message: t("campaigns.deleteStatusUnavailable") };
    }
}
