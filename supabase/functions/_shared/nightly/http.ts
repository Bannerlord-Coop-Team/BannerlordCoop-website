import { readBoundedText, RequestTooLargeError } from "../edge-http.ts";

const JSON_HEADERS = Object.freeze({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
});
const MAXIMUM_REQUEST_BYTES = 4096;

/** An upstream service's HTTP status and its own numeric error code, when a failed call reported one. */
export type UpstreamFailure = { upstream_status: number; upstream_code?: number };

// Carries the HTTP status and stable error code returned to clients, plus the upstream status
// and error code when a failed upstream call caused it.
export class GatewayError extends Error {
    constructor(readonly status: number, readonly code: string, readonly upstream?: UpstreamFailure) { super(code); }
}

/** Serializes a JSON response in the gateway's exact wire format (trailing newline, no-store). */
export function json(value: unknown, status = 200): Response {
    return new Response(`${JSON.stringify(value)}\n`, { status, headers: JSON_HEADERS });
}

/** Builds the `{error, upstream_status?, upstream_code?}` envelope for a gateway error. */
export function errorJson(error: GatewayError): Response {
    return json({ error: error.code, ...error.upstream }, error.status);
}

/** Reads a small url-encoded installer form; oversized bodies are `413 request_too_large`. */
export async function readForm(request: Request): Promise<URLSearchParams> {
    return new URLSearchParams(await readRequestText(request));
}

/** Reads a small JSON object body from the website; anything else is `400 invalid_request`. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
    const text = await readRequestText(request);
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new GatewayError(400, "invalid_request");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new GatewayError(400, "invalid_request");
    return value as Record<string, unknown>;
}

/** Reads a request body as UTF-8 up to the shared 4 KiB limit. */
function readRequestText(request: Request): Promise<string> {
    return readBoundedText(request, MAXIMUM_REQUEST_BYTES).catch(rethrowTooLargeAsRequestTooLarge);
}

/** Maps a body over the shared 4 KiB limit to `413 request_too_large` and rethrows anything else unchanged. */
function rethrowTooLargeAsRequestTooLarge(error: unknown): never {
    if (error instanceof RequestTooLargeError) throw new GatewayError(413, "request_too_large");
    throw error;
}
