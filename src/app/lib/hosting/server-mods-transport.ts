import {
    isModErrorCode,
    isModId,
    isModIssue,
    parseModChunkReceipt,
    parseModsResult,
    type ModsRequest,
} from "../../../../supabase/functions/_shared/server-mods-contract";
import { MODS_REFRESH_SESSION_HEADER, type ServerModCatalog } from "./server-mods";
import { createServerModCatalog, type ServerModsCallFailure, type ServerModsCallResult, type ServerModsTransport } from "./server-mods-client";

// The browser transport to the website's own mods routes (never to Supabase or the control plane directly).

/** JSON routes answer within about 100 s on the server side. */
const JSON_TIMEOUT_MILLISECONDS = 150_000;
/** A chunk relay answers within about 130 s on the server side. */
const CHUNK_TIMEOUT_MILLISECONDS = 180_000;

/** Builds the transport over `fetch`, validating each result again before the catalog sees it. */
export function createServerModsHttpTransport(fetchImplementation: typeof fetch = (input, init) => fetch(input, init)): ServerModsTransport {
    return {
        async send(serverId, request: ModsRequest, { refreshSession }) {
            const response = await attempt(() => fetchImplementation(`/api/servers/${encodeURIComponent(serverId)}/mods?route=${encodeURIComponent(request.route)}`, {
                method: "POST",
                headers: { "content-type": "application/json", ...(refreshSession ? { [MODS_REFRESH_SESSION_HEADER]: "1" } : {}) },
                body: JSON.stringify(request.body),
                cache: "no-store",
                credentials: "same-origin",
                signal: AbortSignal.timeout(JSON_TIMEOUT_MILLISECONDS),
            }));
            return response.ok === false ? response : readResult(response.value, result => parseModsResult(request.route, result, request));
        },
        async putChunk(serverId, chunk, { refreshSession }) {
            const query = new URLSearchParams({ uploadId: chunk.uploadId, index: String(chunk.index) });
            const response = await attempt(() => fetchImplementation(`/api/servers/${encodeURIComponent(serverId)}/mods/chunk?${query}`, {
                method: "PUT",
                headers: { "content-type": "application/octet-stream", "x-chunk-sha256": chunk.sha256, ...(refreshSession ? { [MODS_REFRESH_SESSION_HEADER]: "1" } : {}) },
                body: chunk.bytes,
                cache: "no-store",
                credentials: "same-origin",
                signal: AbortSignal.timeout(CHUNK_TIMEOUT_MILLISECONDS),
            }));
            return response.ok === false ? response : readResult(response.value, parseModChunkReceipt);
        },
    };
}

/** Runs one fetch; a network failure or timeout is a retryable unknown outcome. */
async function attempt(request: () => Promise<Response>): Promise<{ ok: true; value: Response } | { ok: false; error: ServerModsCallFailure }> {
    try {
        return { ok: true, value: await request() };
    } catch {
        return { ok: false, error: { code: "network_unavailable", retryable: true, modId: null } };
    }
}

/** Reads the route's envelope; a reply without one is retryable only when it looks like a gateway, deadline or rate failure. */
async function readResult<T>(response: Response, parse: (value: unknown) => T): Promise<ServerModsCallResult<T>> {
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        return { ok: false, error: unenvelopedFailure(response) };
    }
    if (isRecord(body) && body.ok === true && response.ok) {
        try {
            return { ok: true, result: parse(body.result) };
        } catch {
            return { ok: false, error: { code: "invalid_response", retryable: true, modId: null } };
        }
    }
    if (isRecord(body) && body.ok === false && isRecord(body.error) && isModErrorCode(body.error.code)
        && typeof body.error.retryable === "boolean" && (body.error.modId === null || isModId(body.error.modId))
        && (body.error.issue === undefined || isModIssue(body.error.issue))) {
        const { code, retryable, modId, issue } = body.error;
        return { ok: false, error: issue === undefined ? { code, retryable, modId } : { code, retryable, modId, issue } };
    }
    return { ok: false, error: unenvelopedFailure(response) };
}

/**
 * Classifies a reply without the route's envelope. A success that broke the contract and gateway, deadline or rate
 * replies may succeed on an identical resend; any other status (such as the route's own 404) is a refusal.
 */
function unenvelopedFailure(response: Response): ServerModsCallFailure {
    if (response.status === 408 || response.status >= 500) return { code: "server_api_unavailable", retryable: true, modId: null };
    if (response.status === 429) return { code: "rate_limited", retryable: true, modId: null };
    return { code: "invalid_response", retryable: response.ok, modId: null };
}

/** Whether a value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The production catalog in the browser: the website's mods routes, Web Crypto digests and real time. */
export function createBrowserServerModCatalog(): ServerModCatalog {
    return createServerModCatalog({
        transport: createServerModsHttpTransport(),
        sha256: webSha256,
        randomUUID: () => crypto.randomUUID(),
        sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
        now: () => Date.now(),
    });
}

/** Returns the lowercase hex SHA-256 of some bytes. */
export async function webSha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
