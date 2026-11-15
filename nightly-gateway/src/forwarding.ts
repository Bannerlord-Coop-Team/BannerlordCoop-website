import { GatewayError, decodeUtf8, json, readBoundedBytes, type UpstreamFetch } from "./http";

export const DEVICE_SESSIONS_PATH = "/v1/device/sessions";
export const FORWARDED_DEVICE_PATHS: readonly string[] = Object.freeze([DEVICE_SESSIONS_PATH, "/v1/device/token"]);

const MAXIMUM_DEVICE_REQUEST_BYTES = 4 * 1024;
const MAXIMUM_DEVICE_RESPONSE_BYTES = 16 * 1024;
const DEVICE_FORWARD_TIMEOUT_MS = 10_000;
const USER_CODE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;

/** Where one installer call is relayed: the device-API path, its Edge Function URL, and the gateway origin the installer used. */
export type DeviceForwardTarget = { path: string; url: string; origin: string };

// Builds the Edge Function URL for one device-API path from the configured function base URL.
// Throws when the configured base is not a plain https URL, so a bad deploy fails loudly.
export function deviceFunctionUrl(functionUrl: unknown, path: string): string {
    if (typeof functionUrl !== "string") throw new Error("gateway_function_url_invalid");
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

// Relays one installer device-API call to the Edge Function and returns its status and JSON body.
// A new device session also gets the gateway's own activation link; upstream failures throw a 502 GatewayError.
export async function forwardDeviceRequest(
    request: Request,
    target: DeviceForwardTarget,
    upstreamFetch: UpstreamFetch,
): Promise<Response> {
    const body = await readBoundedBytes(request, MAXIMUM_DEVICE_REQUEST_BYTES);
    if (body === null) throw new GatewayError(413, "request_too_large");
    const upstream = await callFunction(request, target.url, body, upstreamFetch);
    const payload = await readUpstreamJson(upstream);
    return json(withVerificationUri(payload, target.path, upstream.status, target.origin), upstream.status);
}

// Sends the bounded body to the Edge Function with only the headers it needs; any network failure or timeout is a 502.
async function callFunction(request: Request, url: string, body: Uint8Array, upstreamFetch: UpstreamFetch): Promise<Response> {
    try {
        return await upstreamFetch(url, {
            method: request.method,
            headers: forwardedHeaders(request),
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(DEVICE_FORWARD_TIMEOUT_MS),
        });
    } catch (cause) {
        throw new GatewayError(502, "function_unreachable", { cause });
    }
}

// Chooses the only headers the Edge Function needs: the body type and a JSON accept.
function forwardedHeaders(request: Request): Headers {
    const headers = new Headers({ accept: "application/json" });
    const contentType = request.headers.get("content-type");
    if (contentType !== null) headers.set("content-type", contentType);
    return headers;
}

// Parses the upstream body as bounded, non-empty UTF-8 JSON; anything else is a 502 that logs the upstream status.
async function readUpstreamJson(response: Response): Promise<unknown> {
    const upstreamStatus = response.status;
    const bytes = await readUpstreamBytes(response);
    if (bytes === null || bytes.byteLength === 0) throw new GatewayError(502, "function_response_invalid", { upstreamStatus });
    try {
        return JSON.parse(decodeUtf8(bytes));
    } catch (cause) {
        throw new GatewayError(502, "function_response_invalid", { cause, upstreamStatus });
    }
}

// Reads the bounded upstream body; null means it was too large, and a broken stream is a 502 that keeps its cause and status.
async function readUpstreamBytes(response: Response): Promise<Uint8Array | null> {
    try {
        return await readBoundedBytes(response, MAXIMUM_DEVICE_RESPONSE_BYTES);
    } catch (cause) {
        throw new GatewayError(502, "function_response_invalid", { cause, upstreamStatus: response.status });
    }
}

// Adds the activation link on the installer's gateway host to a successfully created device session.
// Every other response is returned unchanged.
function withVerificationUri(payload: unknown, path: string, status: number, origin: string): unknown {
    if (path !== DEVICE_SESSIONS_PATH || status !== 201) return payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return payload;
    const userCode = (payload as Record<string, unknown>).user_code;
    if (typeof userCode !== "string" || !USER_CODE.test(userCode)) return payload;
    return { ...payload, verification_uri: `${origin}/activate?code=${encodeURIComponent(userCode)}` };
}
