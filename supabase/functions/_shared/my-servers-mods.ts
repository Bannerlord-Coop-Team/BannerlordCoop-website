import { hasExactKeys, isRecord } from "./dto-validation.ts";
import { errorResponse, isControlPlaneEnvelope, readBoundedBytes, readBoundedText, RequestTooLargeError } from "./edge-http.ts";
import {
    MAXIMUM_MODS_REQUEST_BYTES,
    MAXIMUM_MODS_SMALL_RESPONSE_BYTES,
    MAXIMUM_MODS_STATE_RESPONSE_BYTES,
    MOD_CHUNK_PATH,
    MOD_JSON_ROUTES,
    MOD_UPLOAD_CHUNK_BYTES,
    isModJsonRoute,
    isModMutationRoute,
    parseModChunkDigest,
    parseModChunkQuery,
    parseModChunkReceipt,
    parseModsRequest,
    parseModsResult,
    type ModJsonRoute,
    type ModsRequest,
} from "./server-mods-contract.ts";

// Custom-mods forwarding for the owner my-servers Edge Function (custom-mods.md "Website transport contract").
// The browser names only a route key or a chunk's upload and index; every upstream path is fixed here.

/** `POST ?resource=mods&route=<route>` carries one JSON route. */
export const MODS_RESOURCE = "mods";
/** `PUT ?resource=mod-chunk&uploadId=<UUID>&index=<n>` carries one raw chunk. */
export const MOD_CHUNK_RESOURCE = "mod-chunk";
/** The adapter waits up to 60 s for the control plane on JSON routes, after authentication and body transfer. */
export const DEFAULT_MODS_JSON_TIMEOUT_MILLISECONDS = 90_000;
/** A full chunk relays as 128 runner stage requests; the contract asks the website to wait about 120 s. */
export const DEFAULT_MOD_CHUNK_TIMEOUT_MILLISECONDS = 120_000;
/** Supabase closes a request that sends no response within 150 s, so every upstream wait stays below it. */
const MAXIMUM_MODS_TIMEOUT_MILLISECONDS = 140_000;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Proxy and Node deadline replies without the JSON envelope; the contract treats them as retryable. */
const UNAVAILABLE_STATUSES = new Set([408, 502, 503, 504]);

export type ModsForwarderOptions = {
    controlPlaneOrigin: string;
    fetchImplementation: typeof fetch;
    jsonTimeoutMilliseconds?: number;
    chunkTimeoutMilliseconds?: number;
};

/** The caller identity the main handler already checked: bearer token, header request ID and CORS headers. */
export type ModsForwardingContext = { token: string; headerRequestId: string | null; cors: Record<string, string> };

/** Whether an Edge request names one of the two mods resources (any method; the forwarder checks it). */
export function isModsEdgeRequest(request: Request): boolean {
    const resources = new URL(request.url).searchParams.getAll("resource");
    return resources.length === 1 && (resources[0] === MODS_RESOURCE || resources[0] === MOD_CHUNK_RESOURCE);
}

/** Builds the forwarder for the mods resources; it relays only allowlisted routes with validated bodies. */
export function createModsForwarder(options: ModsForwarderOptions) {
    const jsonTimeout = boundedTimeout(options.jsonTimeoutMilliseconds ?? DEFAULT_MODS_JSON_TIMEOUT_MILLISECONDS);
    const chunkTimeout = boundedTimeout(options.chunkTimeoutMilliseconds ?? DEFAULT_MOD_CHUNK_TIMEOUT_MILLISECONDS);
    const relay = createModsRelay(options.fetchImplementation);

    /** Forwards one JSON route after validating its body against the route's strict shape. */
    async function forwardJson(request: Request, context: ModsForwardingContext): Promise<Response> {
        const url = new URL(request.url);
        let fallbackId = readRequestId(context.headerRequestId);
        if (request.method !== "POST") return errorResponse(405, fallbackId, "method_not_allowed", "Mods routes accept only POST.", false, context.cors);
        let parsed: ModsRequest;
        let requestId: string;
        try {
            const route = exactQuery(url, ["resource", "route"]).route;
            if (!isModJsonRoute(route)) throw new Error("Unsupported mods route");
            if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
                return errorResponse(415, fallbackId, "invalid_content_type", "JSON is required.", false, context.cors);
            }
            parsed = parseModsRequest(route, JSON.parse(await readBoundedText(request, MAXIMUM_MODS_REQUEST_BYTES)));
            requestId = mutationRequestId(parsed, context.headerRequestId) ?? fallbackId;
            fallbackId = requestId;
        } catch (error) {
            if (error instanceof RequestTooLargeError) return errorResponse(413, fallbackId, "request_too_large", "The request body is too large.", false, context.cors);
            return errorResponse(400, fallbackId, "invalid_request", "The mods request is invalid.", false, context.cors);
        }
        return relay({
            endpoint: new URL(MOD_JSON_ROUTES[parsed.route], options.controlPlaneOrigin),
            init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.body) },
            token: context.token, requestId, timeoutMilliseconds: jsonTimeout, cors: context.cors,
            maximumResponseBytes: stateRoute(parsed.route) ? MAXIMUM_MODS_STATE_RESPONSE_BYTES : MAXIMUM_MODS_SMALL_RESPONSE_BYTES,
            parseResult: (result) => parseModsResult(parsed.route, result, parsed),
        });
    }

    /** Reads one whole chunk (at most 8 MiB) before forwarding it with its digest and an exact length. */
    async function forwardChunk(request: Request, context: ModsForwardingContext): Promise<Response> {
        const requestId = readRequestId(context.headerRequestId);
        if (request.method !== "PUT") return errorResponse(405, requestId, "method_not_allowed", "Mod chunks accept only PUT.", false, context.cors);
        let target: { uploadId: string; index: number };
        let digest: string;
        let bytes: Uint8Array;
        try {
            const query = exactQuery(new URL(request.url), ["resource", "uploadId", "index"]);
            target = parseModChunkQuery(query.uploadId, query.index);
            digest = parseModChunkDigest(request.headers.get("x-chunk-sha256"));
            if (request.headers.get("content-type")?.toLowerCase().split(";")[0]?.trim() !== "application/octet-stream") {
                return errorResponse(415, requestId, "invalid_content_type", "application/octet-stream is required.", false, context.cors);
            }
            bytes = await readBoundedBytes(request, MOD_UPLOAD_CHUNK_BYTES);
            if (bytes.byteLength === 0) throw new Error("Empty chunk");
        } catch (error) {
            if (error instanceof RequestTooLargeError) return errorResponse(413, requestId, "request_too_large", "The chunk is too large.", false, context.cors);
            return errorResponse(400, requestId, "invalid_request", "The mods request is invalid.", false, context.cors);
        }
        const endpoint = new URL(MOD_CHUNK_PATH, options.controlPlaneOrigin);
        endpoint.searchParams.set("uploadId", target.uploadId);
        endpoint.searchParams.set("index", String(target.index));
        try {
            return await relay({
                endpoint,
                init: { method: "PUT", headers: { "content-type": "application/octet-stream", "x-chunk-sha256": digest }, body: bytes },
                token: context.token, requestId, timeoutMilliseconds: chunkTimeout, cors: context.cors,
                maximumResponseBytes: MAXIMUM_MODS_SMALL_RESPONSE_BYTES,
                parseResult: parseModChunkReceipt,
            });
        } finally {
            bytes.fill(0);
        }
    }

    return (request: Request, context: ModsForwardingContext): Promise<Response> =>
        new URL(request.url).searchParams.get("resource") === MOD_CHUNK_RESOURCE ? forwardChunk(request, context) : forwardJson(request, context);
}

type RelayRequest = {
    endpoint: URL;
    init: { method: "POST" | "PUT"; headers: Record<string, string>; body: string | Uint8Array };
    token: string;
    requestId: string;
    timeoutMilliseconds: number;
    cors: Record<string, string>;
    maximumResponseBytes: number;
    parseResult: (value: unknown) => unknown;
};

/** Builds the single upstream call: fixed endpoint, bearer and request ID, no redirects, bounded wait and reply. */
function createModsRelay(fetchImplementation: typeof fetch) {
    return async (relay: RelayRequest): Promise<Response> => {
        let upstream: Response;
        try {
            upstream = await fetchImplementation(relay.endpoint, {
                method: relay.init.method,
                redirect: "error",
                headers: { ...relay.init.headers, authorization: `Bearer ${relay.token}`, "x-request-id": relay.requestId },
                body: relay.init.body,
                signal: AbortSignal.timeout(relay.timeoutMilliseconds),
            });
        } catch {
            return errorResponse(502, relay.requestId, "control_plane_unavailable", "The control plane could not be reached.", true, relay.cors);
        }
        return normalizeModsResponse(upstream, relay);
    };
}

/** Converts the adapter's reply into the website envelope, validating the result for the route. */
async function normalizeModsResponse(upstream: Response, relay: RelayRequest): Promise<Response> {
    let value: unknown;
    try {
        value = JSON.parse(await readBoundedText(upstream, relay.maximumResponseBytes));
    } catch {
        return unreadableReply(upstream.status, relay);
    }
    const headers = { ...relay.cors, "cache-control": "private, no-store", "x-request-id": relay.requestId };
    if (upstream.ok && isRecord(value) && hasExactKeys(value, ["ok", "requestId", "result"]) && value.ok === true && value.requestId === relay.requestId) {
        try {
            const result = relay.parseResult(value.result);
            return Response.json({ version: 1, requestId: relay.requestId, ok: true, result }, { status: upstream.status, headers });
        } catch {
            return invalidReply(relay);
        }
    }
    if (!upstream.ok && isControlPlaneEnvelope(value, relay.requestId) && !value.ok) {
        return Response.json(value, { status: upstream.status, headers });
    }
    return invalidReply(relay);
}

/** Maps a reply without a readable envelope: deadline and proxy statuses stay retryable, a proxy size refusal does not. */
function unreadableReply(status: number, relay: RelayRequest): Response {
    if (UNAVAILABLE_STATUSES.has(status)) {
        return errorResponse(503, relay.requestId, "control_plane_unavailable", "The control plane is temporarily unavailable.", true, relay.cors);
    }
    if (status === 413) return errorResponse(413, relay.requestId, "request_too_large", "The request body is too large.", false, relay.cors);
    return invalidReply(relay);
}

/** An unrecognized reply is an unknown outcome; an identical resend replays safely, so it stays retryable. */
function invalidReply(relay: RelayRequest): Response {
    return errorResponse(502, relay.requestId, "invalid_response", "The control plane returned an invalid response.", true, relay.cors);
}

/** Requires a mutation's header request ID to match its body, so the website and control plane share one replay key. */
function mutationRequestId(parsed: ModsRequest, headerRequestId: string | null): string | null {
    if (!isModMutationRoute(parsed.route)) return null;
    const bodyRequestId = (parsed.body as { requestId: string }).requestId;
    if (headerRequestId === null || headerRequestId.toLowerCase() !== bodyRequestId.toLowerCase()) throw new Error("Mutation request ID mismatch");
    return bodyRequestId;
}

/** Whether a route answers with a whole mod list (or an upload status that may carry one). */
function stateRoute(route: ModJsonRoute): boolean {
    return route === "list" || route === "load-order" || route === "delete" || route === "status";
}

/** Returns the query values when the URL carries exactly these parameters, each once. */
function exactQuery(url: URL, keys: readonly string[]): Record<string, string> {
    const names = [...url.searchParams.keys()];
    if (names.length !== keys.length || !keys.every((key) => url.searchParams.getAll(key).length === 1)) throw new Error("Unexpected query");
    return Object.fromEntries(keys.map((key) => [key, url.searchParams.get(key)!]));
}

/** Uses a valid caller request ID or generates one. */
function readRequestId(value: string | null) {
    return value !== null && REQUEST_ID.test(value) ? value : crypto.randomUUID();
}

/** Bounds a configured upstream wait below the Supabase response deadline. */
function boundedTimeout(value: number) {
    if (!Number.isSafeInteger(value) || value < 1_000 || value > MAXIMUM_MODS_TIMEOUT_MILLISECONDS) throw new Error("Mods timeout is invalid");
    return value;
}
