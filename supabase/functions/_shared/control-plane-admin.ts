import type { ControlPlaneCall, RegionRequestNotifier } from "./region-request-notification.ts";
import { verifyWebsiteSessionContext } from "./session-context.ts";

const MAXIMUM_REQUEST_BYTES = 64 * 1024;
const MAXIMUM_AUTH_RESPONSE_BYTES = 512 * 1024;
const MAXIMUM_UPSTREAM_RESPONSE_BYTES = 8 * 1_048_576;
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
    /** Handles `notify-region-request`; absent when SMTP is not configured. */
    notifyRegionRequest?: RegionRequestNotifier;
};
type UpstreamReply = { kind: "unreachable" } | { kind: "invalid" } | { kind: "ok"; status: number; text: string };

/** Authenticates every request and forwards reads to the authoritative control plane. */
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
        const envelope = validateEnvelope(raw);
        if (envelope === null) {
            return errorResponse(400, "invalid_request", "The request is invalid.", false, cors);
        }
        const { requestId } = envelope;

        const authenticationStarted = performance.now();
        let user: unknown;
        const authentication = new AbortController();
        const authSignal = AbortSignal.any([authentication.signal, AbortSignal.timeout(authTimeoutMilliseconds)]);
        try {
            const userRead = (async () => {
                const authResponse = await fetchImplementation(userEndpoint, {
                    method: "GET", redirect: "error",
                    headers: { apikey: options.supabasePublishableKey, authorization: `Bearer ${token}` },
                    signal: authSignal,
                });
                if (authSignal.aborted || !authResponse.ok) {
                    void authResponse.body?.cancel().catch(() => undefined);
                    throw new Error("Invalid identity");
                }
                const value: unknown = JSON.parse(await readBoundedText(authResponse, MAXIMUM_AUTH_RESPONSE_BYTES, authSignal));
                if (!isRecord(value) || typeof value.id !== "string") throw new Error("Invalid identity");
                return { ...value, id: value.id };
            })();
            [user] = await Promise.all([
                userRead,
                verifyWebsiteSessionContext({ supabaseUrl: options.supabaseUrl, key: options.supabasePublishableKey,
                    authorization: `Bearer ${token}`, userId: userRead.then(value => value.id), action: "control-plane-admin",
                    requestId, fetch: fetchImplementation, signal: authSignal }),
            ]);
        } catch {
            return envelopeError(401, requestId, "unauthenticated", "Authentication is required.", false, cors);
        } finally {
            authentication.abort();
        }
        if (!isRecord(user) || !isRecord(user.app_metadata) || user.app_metadata.role !== "Admin") {
            return envelopeError(403, requestId, "forbidden", "Administrator access is required.", false, cors);
        }

        // Sends one envelope to the control plane and reads its bounded JSON reply.
        const callUpstream = async (body: string): Promise<UpstreamReply> => {
            let upstream: Response;
            try {
                upstream = await fetchImplementation(upstreamEndpoint, {
                    method: "POST",
                    redirect: "error",
                    headers: {
                        authorization: `Bearer ${token}`,
                        "content-type": "application/json",
                    },
                    body,
                    signal: AbortSignal.timeout(upstreamTimeoutMilliseconds),
                });
            } catch {
                return { kind: "unreachable" };
            }
            try {
                const text = await readBoundedText(upstream, MAXIMUM_UPSTREAM_RESPONSE_BYTES);
                JSON.parse(text);
                return { kind: "ok", status: upstream.status, text };
            } catch {
                return { kind: "invalid" };
            }
        };

        if (envelope.operation === "notify-region-request") {
            return notifyRegionRequest(envelope, callUpstream, cors);
        }

        const upstreamStarted = performance.now();
        const authenticationMilliseconds = Math.round(upstreamStarted - authenticationStarted);
        const reply = await callUpstream(raw);
        if (reply.kind === "unreachable") {
            return envelopeError(502, requestId, "control_plane_unavailable", "The control plane could not be reached.", true, cors);
        }
        if (reply.kind === "invalid") {
            return envelopeError(502, requestId, "invalid_response", "The control plane returned an invalid response.", true, cors);
        }
        return new Response(reply.text, {
            status: reply.status,
            headers: {
                ...cors, "cache-control": "no-store", "content-type": "application/json",
                "server-timing": `edge_auth;dur=${authenticationMilliseconds}, control_plane;dur=${Math.round(performance.now() - upstreamStarted)}`,
            },
        });
    };

    // Dispatches `notify-region-request` to the notifier and wraps its outcome in the response envelope.
    async function notifyRegionRequest(
        envelope: Envelope,
        callUpstream: (body: string) => Promise<UpstreamReply>,
        cors: Record<string, string>,
    ): Promise<Response> {
        const { requestId } = envelope;
        if (options.notifyRegionRequest === undefined) {
            return envelopeError(503, requestId, "notifications_unavailable", "Email notifications are not configured.", false, cors);
        }
        const call: ControlPlaneCall = async (operation, input) => {
            const reply = await callUpstream(JSON.stringify({ version: 1, requestId: crypto.randomUUID(), operation, input }));
            if (reply.kind !== "ok") throw new Error("The control plane could not be reached.");
            return { status: reply.status, body: JSON.parse(reply.text) };
        };
        let outcome: Awaited<ReturnType<RegionRequestNotifier>>;
        try {
            outcome = await options.notifyRegionRequest(envelope.input, call);
        } catch {
            return envelopeError(502, requestId, "control_plane_unavailable", "The control plane could not be reached.", true, cors);
        }
        if (!outcome.ok) {
            const { code, message, retryable } = outcome.error;
            return envelopeError(outcome.status, requestId, code, message, retryable, cors);
        }
        return Response.json(
            { version: 1, requestId, ok: true, result: outcome.result },
            { headers: { ...cors, "cache-control": "no-store" } },
        );
    }
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

type Envelope = { requestId: string; operation: string; input: unknown };

// Reads the closed request envelope fields the proxy needs, or null when malformed.
function validateEnvelope(raw: string): Envelope | null {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isRecord(value) || value.version !== 1 || typeof value.operation !== "string") return null;
    if (value.operation.length < 1 || value.operation.length > 64) return null;
    if (typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) return null;
    return { requestId: value.requestId, operation: value.operation, input: value.input };
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

async function readBoundedText(response: Request | Response, maximumBytes: number, signal?: AbortSignal) {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > maximumBytes) throw new ResponseTooLargeError();
    if (response.body === null) return "";
    signal?.throwIfAborted();
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal?.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            signal?.throwIfAborted();
            if (done) break;
            total += value.byteLength;
            if (total > maximumBytes) {
                await reader.cancel();
                throw new ResponseTooLargeError();
            }
            chunks.push(value);
        }
    } finally {
        signal?.removeEventListener("abort", cancel);
        reader.releaseLock();
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
