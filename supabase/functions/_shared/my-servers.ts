const MAXIMUM_URL_LENGTH = 4_096;
const MAXIMUM_REQUEST_BYTES = 16 * 1_024;
const MAXIMUM_LIST_RESPONSE_BYTES = 8 * 1_048_576;
const MAXIMUM_OPERATION_RESPONSE_BYTES = 64 * 1_024;
const MAXIMUM_LIMIT = 100;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const SERVER_OPERATIONS = new Set(["start", "stop", "restart-game"]);

export type MyServersHandlerOptions = {
    allowedOrigins: readonly string[];
    controlPlaneUrl: string;
    fetchImplementation?: typeof fetch;
    upstreamTimeoutMilliseconds?: number;
};

export function createMyServersHandler(options: MyServersHandlerOptions) {
    const allowedOrigins = new Set(options.allowedOrigins.map(validateOrigin));
    if (allowedOrigins.size === 0 || allowedOrigins.size !== options.allowedOrigins.length) {
        throw new Error("CONTROL_PLANE_WEB_ORIGINS must contain unique HTTPS origins");
    }
    const controlPlaneEndpoint = new URL(
        "/v1/user/control-plane",
        validateOrigin(options.controlPlaneUrl),
    );
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
        const token = bearerToken(request.headers.get("authorization"));
        if (token === null) {
            return errorResponse(401, requestId, "unauthenticated", "Authentication is required.", false, cors);
        }
        if (request.url.length > MAXIMUM_URL_LENGTH) {
            return errorResponse(414, requestId, "request_too_large", "The request URL is too large.", false, cors);
        }

        let upstreamRequest: { operation: "my-servers" | "server-operation"; input: unknown };
        try {
            upstreamRequest = request.method === "GET"
                ? listRequest(request)
                : request.method === "POST"
                    ? await operationRequest(request)
                    : (() => { throw new MethodNotAllowedError(); })();
        } catch (error) {
            if (error instanceof MethodNotAllowedError) {
                return errorResponse(405, requestId, "method_not_allowed", "Only GET and POST are allowed.", false, cors);
            }
            if (error instanceof RequestTooLargeError) {
                return errorResponse(413, requestId, "request_too_large", "The request body is too large.", false, cors);
            }
            if (error instanceof ContentTypeError) {
                return errorResponse(415, requestId, "invalid_content_type", "JSON is required.", false, cors);
            }
            return errorResponse(400, requestId, "invalid_request", "The server request is invalid.", false, cors);
        }

        const upstreamBody = JSON.stringify({
            version: 1,
            requestId,
            ...upstreamRequest,
        });
        let upstream: Response;
        try {
            upstream = await fetchImplementation(controlPlaneEndpoint, {
                method: "POST",
                redirect: "error",
                headers: {
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
            responseBody = await readBoundedText(
                upstream,
                upstreamRequest.operation === "my-servers"
                    ? MAXIMUM_LIST_RESPONSE_BYTES
                    : MAXIMUM_OPERATION_RESPONSE_BYTES,
            );
            const envelope: unknown = JSON.parse(responseBody);
            if (!isControlPlaneEnvelope(envelope, requestId)) {
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

function listRequest(request: Request) {
    if (request.body !== null) throw new Error("GET requests cannot contain a body");
    const url = new URL(request.url);
    for (const key of url.searchParams.keys()) {
        if (key !== "limit" && key !== "cursor") throw new Error("Unsupported query parameter");
    }
    if (url.searchParams.getAll("limit").length > 1 || url.searchParams.getAll("cursor").length > 1) {
        throw new Error("Duplicate query parameter");
    }
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? MAXIMUM_LIMIT : parseLimit(rawLimit);
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && (cursor.length < 1 || cursor.length > 2_048)) {
        throw new Error("Invalid cursor");
    }
    return { operation: "my-servers" as const, input: { cursor, limit } };
}

async function operationRequest(request: Request) {
    if ([...new URL(request.url).searchParams.keys()].length !== 0) {
        throw new Error("Operation query parameters are unsupported");
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        throw new ContentTypeError();
    }
    const text = await readBoundedText(request, MAXIMUM_REQUEST_BYTES);
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new Error("Invalid JSON");
    }
    if (!isRecord(value) || !hasExactKeys(value, ["action", "expectedUpdatedAt", "serverId"])) {
        throw new Error("Invalid operation");
    }
    if (typeof value.serverId !== "string" || !SERVER_ID.test(value.serverId)) {
        throw new Error("Invalid server ID");
    }
    if (typeof value.action !== "string" || !SERVER_OPERATIONS.has(value.action)) {
        throw new Error("Invalid operation action");
    }
    if (
        typeof value.expectedUpdatedAt !== "string"
        || value.expectedUpdatedAt.length > 64
        || !ISO_TIMESTAMP.test(value.expectedUpdatedAt)
        || !Number.isFinite(Date.parse(value.expectedUpdatedAt))
    ) throw new Error("Invalid expected update time");
    return {
        operation: "server-operation" as const,
        input: {
            serverId: value.serverId,
            action: value.action,
            expectedUpdatedAt: value.expectedUpdatedAt,
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

function corsHeaders(origin: string) {
    return {
        "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-request-id",
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

async function readBoundedText(
    source: { headers: Headers; body: ReadableStream<Uint8Array> | null },
    maximumBytes: number,
) {
    const declaredLength = source.headers.get("content-length");
    if (
        declaredLength !== null
        && (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
    ) throw new RequestTooLargeError();
    if (source.body === null) return "";
    const reader = source.body.getReader();
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

function isControlPlaneEnvelope(value: unknown, requestId: string) {
    if (!isRecord(value) || value.version !== 1 || value.requestId !== requestId || typeof value.ok !== "boolean") {
        return false;
    }
    if (value.ok) return Object.hasOwn(value, "result");
    if (!isRecord(value.error)) return false;
    return typeof value.error.code === "string"
        && typeof value.error.message === "string"
        && typeof value.error.retryable === "boolean";
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
    const keys = Object.keys(value).sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

class RequestTooLargeError extends Error {}
class ContentTypeError extends Error {}
class MethodNotAllowedError extends Error {}
