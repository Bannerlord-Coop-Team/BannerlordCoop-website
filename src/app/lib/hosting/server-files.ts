import { requestMyServersApi } from "./my-servers";
import {
    MAXIMUM_WEB_FILE_RESPONSE_BYTES,
    parseOwnerFileStatus,
    parseOwnerFileResult,
    parseOwnerFileDownload,
    type OwnerFileMutation,
} from "../../../../supabase/functions/_shared/server-file-contract";

export async function getMyServerFiles(accessToken: string, serverId: string) {
    const result = parseOwnerFileStatus(await requestMyServersApi(accessToken, {
        method: "GET",
        configureEndpoint(url) { url.searchParams.set("resource", "files"); url.searchParams.set("serverId", serverId); },
    }));
    if (result.serverId !== serverId) throw new Error("File response belongs to another server");
    return result;
}

export async function submitMyServerFile(accessToken: string, requestId: string, input: OwnerFileMutation) {
    const result = parseOwnerFileResult(await requestMyServersApi(accessToken, {
        method: "POST", body: JSON.stringify(input), requestId,
        configureEndpoint(url) { url.searchParams.set("resource", "file-transfer"); },
    }));
    if (result === null || result.kind !== "rejected" && (input.action === "import-config" ? result.kind !== "configuration"
        : result.kind !== "job" || result.action !== input.action)) throw new Error("File response does not match the request");
    return result;
}

export async function getMyServerFileResult(accessToken: string, serverId: string, transferRequestId: string) {
    return parseOwnerFileResult(await requestMyServersApi(accessToken, {
        method: "GET",
        configureEndpoint(url) {
            url.searchParams.set("resource", "file-transfer-status");
            url.searchParams.set("serverId", serverId);
            url.searchParams.set("transferRequestId", transferRequestId);
        },
    }));
}

export async function downloadMyServerSave(accessToken: string, serverId: string, transferRequestId: string) {
    return parseOwnerFileDownload(await requestMyServersApi(accessToken, {
        method: "GET", maximumResponseBytes: MAXIMUM_WEB_FILE_RESPONSE_BYTES,
        configureEndpoint(url) {
            url.searchParams.set("resource", "download-save-export");
            url.searchParams.set("serverId", serverId);
            url.searchParams.set("transferRequestId", transferRequestId);
        },
    }));
}
