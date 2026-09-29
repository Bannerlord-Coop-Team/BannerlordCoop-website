"use server";

import { getSupabaseServerClient } from "@/app/lib/supabase/server";
import { getMyServerFiles, getMyServerFileResult, submitMyServerFile, downloadMyServerSave } from "@/app/lib/hosting/server-files";
import { MyServersApiError } from "@/app/lib/hosting/my-servers";
import { MAXIMUM_WEB_SAVE_BYTES, MAXIMUM_WEB_CONFIG_BYTES, parseOwnerFileMutation, requireUuid } from "../../../supabase/functions/_shared/server-file-contract";
import { readConfigurationFile } from "../../../supabase/functions/_shared/configuration-file-import";
import { revalidatePath } from "next/cache";

async function currentToken(expectedUserId: string) {
    const supabase = await getSupabaseServerClient();
    const [{ data: { user } }, { data: { session } }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
    if (!user || user.id !== expectedUserId || !session) throw new Error("Authentication changed");
    return session.access_token;
}

function failure(error: unknown, notSubmitted = false) {
    const code = error instanceof MyServersApiError ? error.code : "unconfirmed";
    const messages: Record<string, string> = {
        stale_interaction: "The server changed. Refresh before starting a new transfer.",
        safe_stop_required: "Stop the server before adding an imported campaign. Export does not require stopping.",
        server_not_found: "This server is unavailable or your access changed.",
        invalid_request: "The file was rejected. Check the format and try again.",
        request_conflict: "This request conflicts with another operation. Check its status before trying again.",
        export_not_ready: "The save export is still being prepared.",
        export_unavailable: "The export is unavailable. Check its status and try again.",
    };
    return { ok: false as const, notSubmitted,
        rejected: !notSubmitted && ["stale_interaction", "safe_stop_required", "operation_unavailable"].includes(code),
        message: notSubmitted ? "The transfer was not sent. Check your files and campaign name, refresh the page, and try again."
            : messages[code] ?? "The transfer outcome could not be confirmed. Check its status or retry the same request." };
}

export async function submitManagedServerFile(form: FormData, expectedUserId: string) {
    let submissionStarted = false;
    try {
        const token = await currentToken(expectedUserId);
        const requestId = form.get("requestId");
        requireUuid(requestId);
        const common = { serverId: form.get("serverId"), expectedUpdatedAt: form.get("expectedUpdatedAt"), action: form.get("action") };
        let input: unknown = common;
        if (common.action === "import-config") {
            const file = form.get("config");
            if (!(file instanceof File) || file.size < 1 || file.size > MAXIMUM_WEB_CONFIG_BYTES) throw new Error("Invalid config file");
            const part = form.get("configPart") ?? "combined";
            if (part !== "server" && part !== "mod" && part !== "combined") throw new Error("Invalid configuration selection");
            input = { ...common, ...readConfigurationFile(await file.text(), part).input };
        } else if (common.action === "import-save") {
            const files = form.getAll("files");
            if (![1, 2].includes(files.length) || files.some((file) => !(file instanceof File))
                || (files as File[]).reduce((sum, file) => sum + file.size, 0) > MAXIMUM_WEB_SAVE_BYTES) throw new Error("Invalid save files");
            input = { ...common, displayName: form.get("displayName"), files: await Promise.all((files as File[]).map(async (file) => {
                const bytes = Buffer.from(await file.arrayBuffer());
                try { return { basename: file.name, base64: bytes.toString("base64") }; } finally { bytes.fill(0); }
            })) };
        } else if (common.action === "export-save") input = { ...common, saveId: form.get("saveId") };
        const mutation = parseOwnerFileMutation(input);
        submissionStarted = true;
        const result = await submitMyServerFile(token, requestId, mutation);
        revalidatePath(`/servers/${String(common.serverId)}`);
        return { ok: true as const, result };
    } catch (error) { return failure(error, !submissionStarted); }
}

export async function checkManagedServerFile(serverId: string, requestId: string, expectedUserId: string) {
    try {
        requireUuid(serverId); requireUuid(requestId);
        return { ok: true as const, result: await getMyServerFileResult(await currentToken(expectedUserId), serverId, requestId) };
    } catch (error) { return failure(error); }
}

export async function exportManagedServerConfig(serverId: string, expectedUserId: string) {
    try {
        requireUuid(serverId);
        const files = await getMyServerFiles(await currentToken(expectedUserId), serverId);
        return { ok: true as const, managedConfig: files.managedConfig };
    } catch (error) { return failure(error); }
}

export async function downloadManagedServerSave(serverId: string, requestId: string, expectedUserId: string) {
    try {
        requireUuid(serverId); requireUuid(requestId);
        return { ok: true as const, download: await downloadMyServerSave(await currentToken(expectedUserId), serverId, requestId) };
    } catch (error) { return failure(error); }
}
