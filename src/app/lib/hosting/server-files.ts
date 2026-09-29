import { serverLogDownloadHeaders } from "../../../../supabase/functions/_shared/server-log-contract";
import { requestMyServersApi, myServersEndpoint } from "./my-servers";
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

// Called in the browser: the large file must not pass through a Next server action.
export async function downloadMyServerLog(accessToken: string, serverId: string) {
    const { endpoint, publishableKey } = myServersEndpoint();
    endpoint.searchParams.set("resource", "download-server-log");
    endpoint.searchParams.set("serverId", serverId);
    const response = await fetch(endpoint, {
        headers: { authorization: `Bearer ${accessToken}`, apikey: publishableKey, accept: "application/octet-stream" },
        cache: "no-store",
    });
    if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (error?.error?.code === "log_not_found") throw new Error("No .log file was found in this server's logs directory.");
        if (error?.error?.code === "log_too_large") throw new Error("The latest log exceeds the 100 MiB download limit.");
        throw new Error("The log could not be downloaded. The server may be unavailable; try again.");
    }
    const { filename, byteSize } = serverLogDownloadHeaders(response.headers);
    const blob = await response.blob();
    if (blob.size !== byteSize) throw new Error("The log download was incomplete. Try again.");
    return { filename, blob };
}
