const MAXIMUM_REQUEST_BYTES = 64 * 1024;
const MAXIMUM_AUTH_RESPONSE_BYTES = 512 * 1024;
const MAXIMUM_UPSTREAM_RESPONSE_BYTES = 8 * 1_048_576;
const DISCORD_SNOWFLAKE = /^[1-9][0-9]{16,19}$/u;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAXIMUM_AUTH_TIMEOUT_MILLISECONDS = 30_000;
const MAXIMUM_UPSTREAM_TIMEOUT_MILLISECONDS = 65_000;
export const CONTROL_PLANE_ADMIN_UPSTREAM_TIMEOUT_MILLISECONDS = 65_000;

export type ControlPlaneAdminHandlerOptions = {
    allowedOrigins: readonly string[];
    supabaseUrl: string;
    supabasePublishableKey: string;
    controlPlaneAdminUrl: string;
    fetchImplementation?: typeof fetch;
    authTimeoutMilliseconds?: number;
    upstreamTimeoutMilliseconds?: number;
};

export function createControlPlaneAdminHandler(options: ControlPlaneAdminHandlerOptions) {
    const allowedOrigins = new Set(options.allowedOrigins.map(validateOrigin));
    if (allowedOrigins.size === 0 || allowedOrigins.size !== options.allowedOrigins.length) {
        throw new Error("CONTROL_PLANE_WEB_ORIGINS must contain unique HTTPS origins");
    }
    const userEndpoint = new URL("/auth/v1/user", validateOrigin(options.supabaseUrl));
    const upstreamEndpoint = new URL("/v1/admin/control-plane", validateOrigin(options.controlPlaneAdminUrl));
    if (options.supabasePublishableKey.length < 20 || options.supabasePublishableKey.length > 4_096) {
        throw new Error("Supabase publishable key is invalid");
    }
    const fetchImplementation = options.fetchImplementation ?? fetch;
    const authTimeoutMilliseconds = boundedTimeout(
        options.authTimeoutMilliseconds ?? 10_000,
        MAXIMUM_AUTH_TIMEOUT_MILLISECONDS,
    );
    const upstreamTimeoutMilliseconds = boundedTimeout(
        options.upstreamTimeoutMilliseconds ?? CONTROL_PLANE_ADMIN_UPSTREAM_TIMEOUT_MILLISECONDS,
        MAXIMUM_UPSTREAM_TIMEOUT_MILLISECONDS,
    );

    return async (request: Request): Promise<Response> => {
        const origin = request.headers.get("origin");
        if (origin !== null && !allowedOrigins.has(origin)) {
            return errorResponse(403, "origin_forbidden", "The request origin is not allowed.", false);
        }
        const cors = origin === null ? {} : corsHeaders(origin);
        if (request.method === "OPTIONS") {
            if (origin === null) return errorResponse(400, "origin_required", "An Origin header is required.", false);
            return new Response(null, { status: 204, headers: { ...cors, "cache-control": "no-store" } });
        }
        if (request.method !== "POST") {
            return errorResponse(405, "method_not_allowed", "Only POST is allowed.", false, cors);
        }
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
            return errorResponse(415, "content_type_required", "JSON content is required.", false, cors);
        }
        const token = bearerToken(request.headers.get("authorization"));
        if (token === null) {
            return errorResponse(401, "unauthenticated", "Authentication is required.", false, cors);
        }

        let raw: string;
        try {
            raw = await readBoundedText(request, MAXIMUM_REQUEST_BYTES);
        } catch (error) {
            if (error instanceof ResponseTooLargeError) {
                return errorResponse(413, "request_too_large", "The request is too large.", false, cors);
            }
            return errorResponse(400, "invalid_request", "The request is invalid.", false, cors);
        }
        const requestId = validateEnvelope(raw);
        if (requestId === null) {
            return errorResponse(400, "invalid_request", "The request is invalid.", false, cors);
        }

        let user: unknown;
        try {
            const authResponse = await fetchImplementation(userEndpoint, {
                method: "GET",
                redirect: "error",
                headers: {
                    apikey: options.supabasePublishableKey,
                    authorization: `Bearer ${token}`,
                },
                signal: AbortSignal.timeout(authTimeoutMilliseconds),
            });
            if (!authResponse.ok) {
                return envelopeError(401, requestId, "unauthenticated", "Authentication is required.", false, cors);
            }
            user = JSON.parse(await readBoundedText(authResponse, MAXIMUM_AUTH_RESPONSE_BYTES));
        } catch {
            return envelopeError(401, requestId, "unauthenticated", "Authentication is required.", false, cors);
        }
        if (!isRecord(user) || !isRecord(user.app_metadata) || user.app_metadata.role !== "Admin") {
            return envelopeError(403, requestId, "forbidden", "Administrator access is required.", false, cors);
        }
        if (!hasDiscordIdentity(user)) {
            return envelopeError(409, requestId, "identity_unavailable", "A verified Discord sign-in is required.", false, cors);
        }

        let upstream: Response;
        try {
            upstream = await fetchImplementation(upstreamEndpoint, {
                method: "POST",
                redirect: "error",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
                body: raw,
                signal: AbortSignal.timeout(upstreamTimeoutMilliseconds),
            });
        } catch {
            return envelopeError(502, requestId, "control_plane_unavailable", "The control plane could not be reached.", true, cors);
        }
        let upstreamBody: string;
        try {
            upstreamBody = await readBoundedText(upstream, MAXIMUM_UPSTREAM_RESPONSE_BYTES);
        } catch {
            return envelopeError(502, requestId, "invalid_response", "The control plane returned an invalid response.", true, cors);
        }
        try {
            JSON.parse(upstreamBody);
        } catch {
            return envelopeError(502, requestId, "invalid_response", "The control plane returned an invalid response.", true, cors);
        }
        return new Response(upstreamBody, {
            status: upstream.status,
            headers: { ...cors, "cache-control": "no-store", "content-type": "application/json" },
        });
    };
}

function validateOrigin(raw: string): string {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        throw new Error("Configured origin is invalid");
    }
    return url.origin;
}

function boundedTimeout(value: number, maximum: number) {
    if (!Number.isSafeInteger(value) || value < 1_000 || value > maximum) throw new Error("Timeout is invalid");
    return value;
}

function bearerToken(header: string | null) {
    if (header === null || !header.startsWith("Bearer ")) return null;
    const token = header.slice(7);
    return token.length >= 20 && token.length <= 8_192 && !/\s/u.test(token) ? token : null;
}

function validateEnvelope(raw: string) {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isRecord(value) || value.version !== 1 || typeof value.operation !== "string") return null;
    if (value.operation.length < 1 || value.operation.length > 64) return null;
    return typeof value.requestId === "string" && REQUEST_ID.test(value.requestId) ? value.requestId : null;
}

function hasDiscordIdentity(user: Record<string, unknown>) {
    if (!Array.isArray(user.identities) || user.identities.length > 20) return false;
    return user.identities.some((candidate) => {
        if (!isRecord(candidate) || candidate.provider !== "discord") return false;
        const data = isRecord(candidate.identity_data) ? candidate.identity_data : {};
        return [data.provider_id, data.sub, data.id, candidate.id]
            .some((value) => typeof value === "string" && DISCORD_SNOWFLAKE.test(value));
    });
}

function corsHeaders(origin: string) {
    return {
        "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-origin": origin,
        "access-control-max-age": "600",
        vary: "Origin",
    };
}

function errorResponse(
    status: number,
    code: string,
    message: string,
    retryable: boolean,
    headers: Record<string, string> = {},
) {
    return Response.json(
        { ok: false, error: { code, message, retryable } },
        { status, headers: { ...headers, "cache-control": "no-store" } },
    );
}

function envelopeError(
    status: number,
    requestId: string,
    code: string,
    message: string,
    retryable: boolean,
    headers: Record<string, string>,
) {
    return Response.json(
        { version: 1, requestId, ok: false, error: { code, message, retryable } },
        { status, headers: { ...headers, "cache-control": "no-store" } },
    );
}

async function readBoundedText(response: Request | Response, maximumBytes: number) {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > maximumBytes) throw new ResponseTooLargeError();
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
            throw new ResponseTooLargeError();
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

class ResponseTooLargeError extends Error {}
