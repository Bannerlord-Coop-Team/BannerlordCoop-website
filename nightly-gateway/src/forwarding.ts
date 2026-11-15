export const FORWARDED_ORIGIN_HEADER = "x-nightly-forwarded-origin";
export const FORWARDED_DEVICE_PATHS: readonly string[] = Object.freeze(["/v1/device/sessions", "/v1/device/token"]);

const MAXIMUM_DEVICE_REQUEST_BYTES = 4 * 1024;
const MAXIMUM_DEVICE_RESPONSE_BYTES = 16 * 1024;
const DEVICE_FORWARD_TIMEOUT_MS = 10_000;
const JSON_HEADERS = Object.freeze({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
});

/** The outbound HTTP call the forwarder depends on; production passes the Workers global fetch. */
export type UpstreamFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Where one installer call is relayed: the Edge Function URL and the gateway origin the installer used. */
export type DeviceForwardTarget = { url: string; origin: string };

// Builds the Edge Function URL for one device-API path from the configured function base URL.
// Throws when the configured base is not a plain https URL, so a bad deploy fails loudly.
export function deviceFunctionUrl(functionUrl: unknown, path: string): string {
    if (typeof functionUrl !== "string" || !FORWARDED_DEVICE_PATHS.includes(path)) {
        throw new Error("gateway_function_url_invalid");
    }
    let parsed: URL;
    try {
        parsed = new URL(functionUrl);
    } catch {
        throw new Error("gateway_function_url_invalid");
    }
    if (parsed.protocol !== "https:" || parsed.search || parsed.hash || parsed.username || parsed.password) {
        throw new Error("gateway_function_url_invalid");
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${path}`;
}

// Relays one installer device-API call to the Edge Function and returns its status and JSON body unchanged.
// A bounded request body is passed through; network failures and unreadable upstream bodies become 502.
export async function forwardDeviceRequest(
    request: Request,
    target: DeviceForwardTarget,
    upstreamFetch: UpstreamFetch,
): Promise<Response> {
    const body = await readBoundedBytes(request, MAXIMUM_DEVICE_REQUEST_BYTES);
    if (body === null) return jsonResponse({ error: "request_too_large" }, 413);
    let upstream: Response;
    try {
        upstream = await upstreamFetch(target.url, {
            method: request.method,
            headers: forwardedHeaders(request, target.origin),
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(DEVICE_FORWARD_TIMEOUT_MS),
        });
    } catch {
        return jsonResponse({ error: "internal_error" }, 502);
    }
    const payload = await readUpstreamJson(upstream);
    if (payload === null) return jsonResponse({ error: "internal_error" }, 502);
    return new Response(payload, { status: upstream.status, headers: JSON_HEADERS });
}

// Chooses the only headers the Edge Function needs: the body type, JSON accept, and the installer's gateway origin.
function forwardedHeaders(request: Request, origin: string): Headers {
    const headers = new Headers({ accept: "application/json", [FORWARDED_ORIGIN_HEADER]: origin });
    const contentType = request.headers.get("content-type");
    if (contentType !== null) headers.set("content-type", contentType);
    return headers;
}

// Returns the upstream body when it is bounded, readable JSON; null tells the caller to answer 502.
async function readUpstreamJson(response: Response): Promise<string | null> {
    const bytes = await readBoundedBytes(response, MAXIMUM_DEVICE_RESPONSE_BYTES);
    if (bytes === null || bytes.byteLength === 0) return null;
    try {
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
        JSON.parse(text);
        return text;
    } catch {
        return null;
    }
}

// Reads a message body up to a byte limit; null means the body was too large or the stream failed.
async function readBoundedBytes(message: Request | Response, maximum: number): Promise<Uint8Array | null> {
    const declared = Number(message.headers.get("content-length") ?? 0);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maximum) return null;
    if (message.body === null) return new Uint8Array(0);
    try {
        return await collectChunks(message.body.getReader(), maximum);
    } catch {
        return null;
    }
}

// Drains a byte stream into one buffer, cancelling and returning null once it passes the limit.
async function collectChunks(reader: ReadableStreamDefaultReader<Uint8Array>, maximum: number): Promise<Uint8Array | null> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximum) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

// Serializes a JSON error body with the gateway's no-store headers.
function jsonResponse(value: unknown, status: number): Response {
    return new Response(`${JSON.stringify(value)}\n`, { status, headers: JSON_HEADERS });
}
