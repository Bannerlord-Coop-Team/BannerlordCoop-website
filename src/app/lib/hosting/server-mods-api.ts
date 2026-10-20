import { requestMyServersApi } from "./my-servers";
import {
    MAXIMUM_MODS_SMALL_RESPONSE_BYTES,
    MAXIMUM_MODS_STATE_RESPONSE_BYTES,
    MOD_CHUNK_RESOURCE,
    MOD_UPLOAD_CHUNK_BYTES,
    MODS_RESOURCE,
    isModMutationRoute,
    parseModChunkReceipt,
    parseModsResult,
    type ModChunkReceipt,
    type ModsRequest,
} from "../../../../supabase/functions/_shared/server-mods-contract";

// Server-side calls from the website to the custom-mods routes of the my-servers Edge Function.

/** The Edge Function waits 90 s for a JSON route; this leaves room for its own reply. */
const MODS_JSON_TIMEOUT_MILLISECONDS = 100_000;
/** The Edge Function waits 120 s for a chunk relay; this leaves room for its own reply. */
const MOD_CHUNK_TIMEOUT_MILLISECONDS = 130_000;

/** One raw chunk with its query identity and digest. */
export type ServerModChunk = { uploadId: string; index: number; sha256: string; bytes: Uint8Array<ArrayBuffer> };

/** The two Edge calls the mods route handlers make; injected so the handlers are testable without a network. */
export interface ServerModsApi {
    request(accessToken: string, request: ModsRequest): Promise<unknown>;
    putChunk(accessToken: string, chunk: ServerModChunk): Promise<ModChunkReceipt>;
}

/** Relays one validated JSON route; a mutation resends under its own requestId, a read under a fresh one. */
export async function requestServerMods(accessToken: string, request: ModsRequest): Promise<unknown> {
    const requestId = isModMutationRoute(request.route) ? (request.body as { requestId: string }).requestId : undefined;
    const result = await requestMyServersApi(accessToken, {
        method: "POST",
        body: JSON.stringify(request.body),
        requestId,
        timeoutMilliseconds: MODS_JSON_TIMEOUT_MILLISECONDS,
        maximumResponseBytes: request.route === "uploads" || request.route === "complete" ? MAXIMUM_MODS_SMALL_RESPONSE_BYTES : MAXIMUM_MODS_STATE_RESPONSE_BYTES,
        configureEndpoint(endpoint) {
            endpoint.searchParams.set("resource", MODS_RESOURCE);
            endpoint.searchParams.set("route", request.route);
        },
    });
    return parseModsResult(request.route, result, request);
}

/** Relays one whole chunk (at most 8 MiB) with its digest. */
export async function putServerModChunk(accessToken: string, chunk: ServerModChunk): Promise<ModChunkReceipt> {
    if (chunk.bytes.byteLength < 1 || chunk.bytes.byteLength > MOD_UPLOAD_CHUNK_BYTES) throw new Error("Invalid chunk length");
    return parseModChunkReceipt(await requestMyServersApi(accessToken, {
        method: "PUT",
        body: chunk.bytes,
        chunkSha256: chunk.sha256,
        timeoutMilliseconds: MOD_CHUNK_TIMEOUT_MILLISECONDS,
        maximumResponseBytes: MAXIMUM_MODS_SMALL_RESPONSE_BYTES,
        configureEndpoint(endpoint) {
            endpoint.searchParams.set("resource", MOD_CHUNK_RESOURCE);
            endpoint.searchParams.set("uploadId", chunk.uploadId);
            endpoint.searchParams.set("index", String(chunk.index));
        },
    }));
}

/** The production Edge calls. */
export const serverModsApi: ServerModsApi = { request: requestServerMods, putChunk: putServerModChunk };
