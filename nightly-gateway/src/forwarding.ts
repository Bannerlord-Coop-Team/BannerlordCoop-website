import { GatewayError, decodeUtf8, json, readBoundedBytes, type UpstreamFetch } from "./http";

export const DEVICE_SESSIONS_PATH = "/v1/device/sessions";
export const FORWARDED_DEVICE_PATHS: readonly string[] = Object.freeze([DEVICE_SESSIONS_PATH, "/v1/device/token"]);

const MAXIMUM_DEVICE_REQUEST_BYTES = 4 * 1024;
const MAXIMUM_DEVICE_RESPONSE_BYTES = 16 * 1024;
const DEVICE_FORWARD_TIMEOUT_MS = 10_000;
const USER_CODE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const MISROUTED_STATUS = 404;

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
// A new device session also gets the gateway's own activation link; upstream failures, misroutes and redirects throw a 502 GatewayError.
export async function forwardDeviceRequest(
    request: Request,
    target: DeviceForwardTarget,
    upstreamFetch: UpstreamFetch,
): Promise<Response> {
    const body = await readBoundedBytes(request, MAXIMUM_DEVICE_REQUEST_BYTES);
    if (body === null) throw new GatewayError(413, "request_too_large");
    const upstream = await callFunction(request, target.url, body, upstreamFetch);
    assertFunctionReply(upstream);
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

// Refuses an upstream 404 or redirect as a logged 502: the Worker forwards only known device paths and never follows
// redirects, so either means NIGHTLY_FUNCTION_URL names the wrong function, project or host.
function assertFunctionReply(response: Response): void {
    const status = response.status;
    const redirecting = status >= 300 && status < 400;
    if (status !== MISROUTED_STATUS && !redirecting) return;
    throw new GatewayError(502, "function_response_invalid", { upstreamStatus: status });
}

// Chooses the only headers the Edge Function needs: the body type and a JSON accept.
function forwardedHeaders(request: Request): Headers {
    const headers = new Headers({ accept: "application/json" });
    const contentType = request.headers.get("content-type");
    if (contentType !== null) headers.set("content-type", contentType);
    return headers;
}

// Parses the upstream body as bounded, non-empty UTF-8 JSON; a broken, oversized, empty or non-JSON body is a 502
// that logs the upstream status, plus the failure's cause when there is one.
async function readUpstreamJson(response: Response): Promise<unknown> {
    const upstreamStatus = response.status;
    try {
        const bytes = await readBoundedBytes(response, MAXIMUM_DEVICE_RESPONSE_BYTES);
        if (bytes !== null && bytes.byteLength > 0) return JSON.parse(decodeUtf8(bytes));
    } catch (cause) {
        throw new GatewayError(502, "function_response_invalid", { cause, upstreamStatus });
    }
    throw new GatewayError(502, "function_response_invalid", { upstreamStatus });
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
