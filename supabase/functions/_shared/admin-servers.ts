const MAXIMUM_REQUEST_BYTES = 16 * 1024;
const MAXIMUM_UPSTREAM_RESPONSE_BYTES = 8 * 1_048_576;
const MAXIMUM_LIMIT = 100;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LIFECYCLE_ACTIONS = new Set(["start", "stop", "restart-game"]);

export type AdminServersHandlerOptions = {
    allowedOrigins: readonly string[];
    supabaseUrl: string;
    supabasePublishableKey: string;
    fetchImplementation?: typeof fetch;
    upstreamTimeoutMilliseconds?: number;
};

type RoutedOperation = {
    requestId: string;
    operation: "servers" | "server-dashboard" | "server-operation";
    input: Record<string, unknown>;
};

export function createAdminServersHandler(options: AdminServersHandlerOptions) {
    const allowedOrigins = new Set(options.allowedOrigins.map(validateOrigin));
    if (allowedOrigins.size === 0 || allowedOrigins.size !== options.allowedOrigins.length) {
        throw new Error("CONTROL_PLANE_WEB_ORIGINS must contain unique HTTPS origins");
    }
    const controlPlaneEndpoint = new URL(
        "/functions/v1/control-plane-admin",
        validateOrigin(options.supabaseUrl),
    );
    if (options.supabasePublishableKey.length < 20 || options.supabasePublishableKey.length > 4_096) {
        throw new Error("Supabase publishable key is invalid");
    }
    const fetchImplementation = options.fetchImplementation ?? fetch;
    const upstreamTimeoutMilliseconds = boundedTimeout(options.upstreamTimeoutMilliseconds ?? 30_000);

    return async (request: Request): Promise<Response> => {
        const origin = request.headers.get("origin");
        const requestId = readRequestId(request.headers.get("x-request-id"));
        if (origin !== null && !allowedOrigins.has(origin)) {
            return errorResponse(403, requestId, "origin_forbidden", "The request origin is not allowed.", false);
        }
        const cors = origin === null ? {} : corsHeaders(origin);
        if (request.method === "OPTIONS") {
            if (origin === null) {
                return errorResponse(400, requestId, "origin_required", "An Origin header is required.", false);
            }
            return new Response(null, {
                status: 204,
                headers: { ...cors, "cache-control": "private, no-store", "x-request-id": requestId },
            });
        }
        if (request.method !== "GET" && request.method !== "POST") {
            return errorResponse(405, requestId, "method_not_allowed", "Only GET and POST are allowed.", false, cors);
        }
        const token = bearerToken(request.headers.get("authorization"));
        if (token === null) {
            return errorResponse(401, requestId, "unauthenticated", "Authentication is required.", false, cors);
        }

        let routed: RoutedOperation;
        try {
            routed = request.method === "GET"
                ? routeReadRequest(request.url, requestId)
                : await routeLifecycleRequest(request, requestId);
        } catch (error) {
            if (error instanceof RequestTooLargeError) {
                return errorResponse(413, requestId, "request_too_large", "The request is too large.", false, cors);
            }
            return errorResponse(400, requestId, "invalid_request", "The server request is invalid.", false, cors);
        }

        const upstreamBody = JSON.stringify({
            version: 1,
            requestId: routed.requestId,
            operation: routed.operation,
            input: routed.input,
        });

        let upstream: Response;
        try {
            upstream = await fetchImplementation(controlPlaneEndpoint, {
                method: "POST",
                redirect: "error",
                headers: {
                    apikey: options.supabasePublishableKey,
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
                body: upstreamBody,
                signal: AbortSignal.timeout(upstreamTimeoutMilliseconds),
            });
        } catch {
            return errorResponse(
                502,
                requestId,
                "control_plane_unavailable",
                "The control plane could not be reached.",
                true,
                cors,
            );
        }

        let responseBody: string;
        try {
            responseBody = await readBoundedText(upstream, MAXIMUM_UPSTREAM_RESPONSE_BYTES);
            const envelope: unknown = JSON.parse(responseBody);
            if (!isRecord(envelope) || envelope.version !== 1 || envelope.requestId !== requestId || typeof envelope.ok !== "boolean") {
                throw new Error("Invalid control-plane envelope");
            }
        } catch {
            return errorResponse(
                502,
                requestId,
                "invalid_response",
                "The control plane returned an invalid response.",
                true,
                cors,
            );
        }

        return new Response(responseBody, {
            status: upstream.status,
            headers: {
                ...cors,
                "cache-control": "private, no-store",
                "content-type": "application/json",
                "x-request-id": requestId,
            },
        });
    };
}

function routeReadRequest(rawUrl: string, requestId: string): RoutedOperation {
    const url = new URL(rawUrl);
    for (const key of url.searchParams.keys()) {
        if (key !== "limit" && key !== "cursor" && key !== "serverId") {
            throw new Error("Unsupported query parameter");
        }
    }
    const serverId = url.searchParams.get("serverId");
    if (serverId !== null) {
        if (!SERVER_ID.test(serverId) || url.searchParams.has("limit") || url.searchParams.has("cursor")) {
            throw new Error("Invalid server detail request");
        }
        return {
            requestId,
            operation: "server-dashboard",
            input: { serverId },
        };
    }

    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? MAXIMUM_LIMIT : parseLimit(rawLimit);
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && (cursor.length < 1 || cursor.length > 2_048)) {
        throw new Error("Invalid cursor");
    }
    return {
        requestId,
        operation: "servers",
        input: { filter: {}, cursor, limit },
    };
}

async function routeLifecycleRequest(request: Request, requestId: string): Promise<RoutedOperation> {
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => key !== "serverId")) {
        throw new Error("Unsupported query parameter");
    }
    const serverId = url.searchParams.get("serverId");
    if (serverId === null || !SERVER_ID.test(serverId)) throw new Error("Invalid server ID");
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        throw new Error("JSON is required");
    }

    const raw = await readBoundedText(request, MAXIMUM_REQUEST_BYTES);
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        throw new Error("Invalid JSON");
    }
    if (!isRecord(value) || typeof value.action !== "string" || !LIFECYCLE_ACTIONS.has(value.action)) {
        throw new Error("Invalid lifecycle action");
    }
    if (typeof value.expectedUpdatedAt !== "string" || !isTimestamp(value.expectedUpdatedAt)) {
        throw new Error("Invalid concurrency token");
    }
    if (value.reason !== undefined && (
        typeof value.reason !== "string"
        || value.reason.trim().length < 3
        || value.reason.length > 1_000
    )) {
        throw new Error("Invalid reason");
    }
    for (const key of Object.keys(value)) {
        if (key !== "action" && key !== "expectedUpdatedAt" && key !== "reason") {
            throw new Error("Unsupported lifecycle field");
        }
    }

    return {
        requestId,
        operation: "server-operation",
        input: {
            serverId,
            action: value.action,
            expectedUpdatedAt: value.expectedUpdatedAt,
            ...(typeof value.reason === "string" ? { reason: value.reason.trim() } : {}),
        },
    };
}

function parseLimit(raw: string) {
    if (!/^[1-9][0-9]*$/u.test(raw)) throw new Error("Invalid limit");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > MAXIMUM_LIMIT) throw new Error("Invalid limit");
    return value;
}

function validateOrigin(raw: string): string {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        throw new Error("Configured origin is invalid");
    }
    return url.origin;
}

function boundedTimeout(value: number) {
    if (!Number.isSafeInteger(value) || value < 1_000 || value > 30_000) throw new Error("Timeout is invalid");
    return value;
}

function readRequestId(value: string | null) {
    return value !== null && REQUEST_ID.test(value) ? value : crypto.randomUUID();
}

function bearerToken(header: string | null) {
    if (header === null || !header.startsWith("Bearer ")) return null;
    const token = header.slice(7);
    return token.length >= 20 && token.length <= 8_192 && !/\s/u.test(token) ? token : null;
}

function isTimestamp(value: string) {
    return value.length <= 64 && Number.isFinite(Date.parse(value));
}

function corsHeaders(origin: string) {
    return {
        "access-control-allow-headers": "authorization, apikey, content-type, x-request-id",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-origin": origin,
        "access-control-expose-headers": "x-request-id",
        "access-control-max-age": "600",
        vary: "Origin",
    };
}

function errorResponse(
    status: number,
    requestId: string,
    code: string,
    message: string,
    retryable: boolean,
    headers: Record<string, string> = {},
) {
    return Response.json(
        { version: 1, requestId, ok: false, error: { code, message, retryable } },
        {
            status,
            headers: {
                ...headers,
                "cache-control": "private, no-store",
                "x-request-id": requestId,
            },
        },
    );
}

async function readBoundedText(response: Request | Response, maximumBytes: number) {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > maximumBytes) {
        throw new RequestTooLargeError();
    }
    if (response.body === null) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximumBytes) {
            await reader.cancel();
            throw new RequestTooLargeError();
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

class RequestTooLargeError extends Error {}
