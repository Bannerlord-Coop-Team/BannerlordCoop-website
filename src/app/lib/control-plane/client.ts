import "server-only";

import { randomUUID } from "node:crypto";

const MAXIMUM_RESPONSE_BYTES = 8 * 1_048_576;

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
    const endpoint = controlPlaneAdminEndpoint();
    const requestId = options.requestId ?? randomUUID();
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
                authorization: `Bearer ${options.accessToken}`,
                "content-type": "application/json",
            },
            body,
            cache: "no-store",
            signal: AbortSignal.timeout(30_000),
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
    const raw = process.env.CONTROL_PLANE_ADMIN_URL?.trim();
    if (!raw) throw new ControlPlaneAdminError(
        "control_plane_not_configured",
        "CONTROL_PLANE_ADMIN_URL is not configured.",
    );
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "127.0.0.1")) {
        throw new ControlPlaneAdminError("control_plane_not_configured", "The control plane URL must use HTTPS.");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new ControlPlaneAdminError("control_plane_not_configured", "The control plane URL is invalid.");
    }
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/v1/admin/control-plane`;
    return url;
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
