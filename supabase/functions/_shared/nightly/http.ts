import { readBoundedBytes, RequestTooLargeError } from "../edge-http.ts";

const JSON_HEADERS = Object.freeze({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
});
const MAXIMUM_REQUEST_BYTES = 4096;

/** Discord's HTTP status and numeric JSON error code (e.g. 40333, 10007) for a failed upstream call. */
export type DiscordFailure = { upstream_status: number; upstream_code?: number };

// Carries the HTTP status and stable error code returned to clients, plus Discord's own
// status and error code when an upstream Discord call caused the failure.
export class GatewayError extends Error {
    constructor(readonly status: number, readonly code: string, readonly upstream?: DiscordFailure) { super(code); }
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

/** Reads a bounded upstream response as strict UTF-8; oversized bodies are `502 response_too_large`. */
export async function readUpstreamText(response: Response, maximumBytes: number): Promise<string> {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBytes(response, maximumBytes));
    } catch (error) {
        if (error instanceof RequestTooLargeError) throw new GatewayError(502, "response_too_large");
        throw new GatewayError(502, "discord_response_invalid");
    }
}

// Extracts Discord's HTTP status and numeric JSON error code (e.g. 40333, 10007) from a failed response body.
export function discordFailure(response: Response, text: string): DiscordFailure {
    try {
        const code = (JSON.parse(text) as { code?: unknown }).code;
        if (Number.isSafeInteger(code)) return { upstream_status: response.status, upstream_code: code as number };
    } catch {
        // Non-JSON bodies (e.g. Cloudflare error pages) carry only the status.
    }
    return { upstream_status: response.status };
}

/** Reads a request body as UTF-8 up to the shared 4 KiB limit. */
async function readRequestText(request: Request): Promise<string> {
    try {
        return new TextDecoder().decode(await readBoundedBytes(request, MAXIMUM_REQUEST_BYTES));
    } catch (error) {
        if (error instanceof RequestTooLargeError) throw new GatewayError(413, "request_too_large");
        throw error;
    }
}
