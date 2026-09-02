const MAXIMUM_RESPONSE_BYTES = 8 * 1_048_576;
export const CONTROL_PLANE_ADMIN_BROWSER_TIMEOUT_MILLISECONDS = 90_000;

export class ControlPlaneAdminError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly retryable = false,
    ) {
        super(message);
        this.name = "ControlPlaneAdminError";
    }
}

export type ControlPlaneAdminEnvelope<T> =
    | { version: 1; requestId: string; ok: true; result: T }
    | {
        version: 1;
        requestId: string;
        ok: false;
        error: { code: string; message: string; retryable: boolean };
    };

export async function requestControlPlaneAdmin<T>(options: {
    accessToken: string;
    operation: string;
    input?: unknown;
    requestId?: string;
}): Promise<T> {
    const { endpoint, publishableKey } = controlPlaneAdminEndpoint();
    const requestId = options.requestId ?? crypto.randomUUID();
    const body = JSON.stringify({
        version: 1,
        requestId,
        operation: options.operation,
        ...(options.input === undefined ? {} : { input: options.input }),
    });
    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers: {
                apikey: publishableKey,
                authorization: `Bearer ${options.accessToken}`,
                "content-type": "application/json",
            },
            body,
            cache: "no-store",
            signal: AbortSignal.timeout(CONTROL_PLANE_ADMIN_BROWSER_TIMEOUT_MILLISECONDS),
        });
    } catch {
        throw new ControlPlaneAdminError(
            "control_plane_unavailable",
            "The control plane could not be reached.",
            true,
        );
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAXIMUM_RESPONSE_BYTES) {
        throw new ControlPlaneAdminError("response_too_large", "The control plane response was too large.");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new ControlPlaneAdminError("invalid_response", "The control plane returned an invalid response.", true);
    }
    if (!isEnvelope(parsed, requestId)) {
        const fallback = readError(parsed);
        throw new ControlPlaneAdminError(
            fallback?.code ?? "invalid_response",
            fallback?.message ?? "The control plane returned an invalid response.",
            fallback?.retryable ?? true,
        );
    }
    if (!parsed.ok) {
        throw new ControlPlaneAdminError(parsed.error.code, parsed.error.message, parsed.error.retryable);
    }
    return parsed.result as T;
}

function controlPlaneAdminEndpoint() {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
    if (!raw || !publishableKey) throw new ControlPlaneAdminError(
        "control_plane_not_configured",
        "Supabase is not configured.",
    );
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.pathname !== "/") {
        throw new ControlPlaneAdminError("control_plane_not_configured", "The Supabase URL must be an HTTPS origin.");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new ControlPlaneAdminError("control_plane_not_configured", "The Supabase URL is invalid.");
    }
    if (publishableKey.length < 20 || publishableKey.length > 4_096) {
        throw new ControlPlaneAdminError("control_plane_not_configured", "The Supabase key is invalid.");
    }
    url.pathname = "/functions/v1/control-plane-admin";
    return { endpoint: url, publishableKey };
}

function isEnvelope(value: unknown, requestId: string): value is ControlPlaneAdminEnvelope<unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || record.requestId !== requestId || typeof record.ok !== "boolean") return false;
    if (record.ok) return Object.hasOwn(record, "result");
    const error = readError(value);
    return error !== null;
}

function readError(value: unknown): { code: string; message: string; retryable: boolean } | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const candidate = (value as Record<string, unknown>).error;
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
    const error = candidate as Record<string, unknown>;
    return typeof error.code === "string" && typeof error.message === "string"
        ? { code: error.code, message: error.message, retryable: error.retryable === true }
        : null;
}
