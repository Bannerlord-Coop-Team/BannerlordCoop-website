import "server-only";
import {
    CONTROL_PLANE_ADMIN_BROWSER_TIMEOUT_MILLISECONDS,
    CONTROL_PLANE_ADMIN_MAXIMUM_RESPONSE_BYTES,
    ControlPlaneAdminError,
    decodeControlPlaneAdminResponse,
} from "./client";

const READ_OPERATIONS = ["overview", "vps-hosts", "servers", "server-dashboard", "jobs", "audit", "builds"] as const;

/** Reads the closed Admin API with the relay's protected-role requirement enforced by Oracle. */
export async function readControlPlaneAdmin<T>(options: {
    accessToken: string;
    operation: typeof READ_OPERATIONS[number];
    input?: unknown;
    requestId?: string;
    signal?: AbortSignal;
}): Promise<T> {
    const requestId = options.requestId ?? crypto.randomUUID();
    if (!READ_OPERATIONS.includes(options.operation) || options.accessToken.length < 20 || options.accessToken.length > 8_192) {
        throw new ControlPlaneAdminError("invalid_request", "The administrator read request is invalid.", false, requestId);
    }
    const body = JSON.stringify({ version: 1, requestId, operation: options.operation,
        ...(options.input === undefined ? {} : { input: options.input }) });
    if (new TextEncoder().encode(body).byteLength > 64 * 1_024) {
        throw new ControlPlaneAdminError("request_too_large", "The administrator read request was too large.", false, requestId);
    }
    const signal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(CONTROL_PLANE_ADMIN_BROWSER_TIMEOUT_MILLISECONDS)])
        : AbortSignal.timeout(CONTROL_PLANE_ADMIN_BROWSER_TIMEOUT_MILLISECONDS);
    let response: Response;
    try {
        signal.throwIfAborted();
        response = await fetch("https://control-plane.bannerlordcoop.com/v1/admin/control-plane", {
            method: "POST", headers: { authorization: `Bearer ${options.accessToken}`, "content-type": "application/json",
                "x-request-id": requestId, "x-control-plane-protected-admin": "1" },
            body, credentials: "omit", cache: "no-store", redirect: "manual", signal,
        });
    } catch {
        throw new ControlPlaneAdminError("control_plane_unavailable", "The control plane could not be reached.", true, requestId);
    }
    if ((response.status >= 300 && response.status < 400)
        || (response.ok && response.headers.get("x-control-plane-protected-admin") !== "1")) {
        void response.body?.cancel().catch(() => undefined);
        throw new ControlPlaneAdminError("invalid_response", "The control plane did not confirm protected administrator access.", true, requestId);
    }
    const result = decodeControlPlaneAdminResponse<T>(await readResponse(response, signal, requestId), requestId, response.ok);
    if (!response.ok) throw new ControlPlaneAdminError("invalid_response", "The control plane returned an invalid response.", true, requestId);
    return result;
}

async function readResponse(response: Response, signal: AbortSignal, requestId: string): Promise<string> {
    const declaredLength = response.headers.get("content-length");
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
        || (declaredLength !== null && (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength)
            || Number(declaredLength) > CONTROL_PLANE_ADMIN_MAXIMUM_RESPONSE_BYTES))) {
        void response.body?.cancel().catch(() => undefined);
        throw new ControlPlaneAdminError("invalid_response", "The control plane returned an invalid response.", true, requestId);
    }
    if (!response.body) return "";
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", cancel, { once: true });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "", bytes = 0, chunks = 0;
    try {
        signal.throwIfAborted();
        for (;;) {
            const chunk = await reader.read();
            signal.throwIfAborted();
            if (chunk.done) return text + decoder.decode();
            bytes += chunk.value.byteLength;
            if (bytes > CONTROL_PLANE_ADMIN_MAXIMUM_RESPONSE_BYTES || ++chunks > 8_192) {
                throw new ControlPlaneAdminError("response_too_large", "The control plane response was too large.", false, requestId);
            }
            text += decoder.decode(chunk.value, { stream: true });
        }
    } catch (error) {
        if (error instanceof ControlPlaneAdminError) throw error;
        throw new ControlPlaneAdminError(signal.aborted ? "control_plane_unavailable" : "invalid_response",
            "The control plane response could not be read.", true, requestId);
    } finally {
        signal.removeEventListener("abort", cancel);
        cancel();
        reader.releaseLock();
    }
}
