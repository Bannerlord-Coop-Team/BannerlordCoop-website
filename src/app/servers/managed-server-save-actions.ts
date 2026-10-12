"use server";

import { getTranslations } from "@/app/lib/localization/server";
import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { deleteMyServerSave, MyServersApiError, selectMyServerSave } from "@/app/lib/hosting/my-servers";
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
        await selectMyServerSave(await accessToken(expectedUserId), input, input.requestId);
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, message: t("campaigns.selected") };
    } catch (error) {
        return error instanceof MyServersApiError && error.code === "invalid_request"
            ? { ok: false, message: t("campaigns.selectionFailed") }
            : await failure();
    }
}

export async function deleteManagedServerSave(value: unknown, expectedUserId: string): Promise<SaveActionResult> {
    const { t } = await getTranslations("managed-server");
    let input: SaveActionInput;
    try { input = parseInput(value, true); } catch { return { ok: false, message: t("campaigns.deleteFailed") }; }
    try {
        await deleteMyServerSave(await accessToken(expectedUserId), input as Required<SaveActionInput>, input.requestId);
        revalidatePath(`/servers/${input.serverId}`);
        return { ok: true, message: t("campaigns.deleted") };
    } catch { return { ok: false, message: t("campaigns.deleteFailed") }; }
}
