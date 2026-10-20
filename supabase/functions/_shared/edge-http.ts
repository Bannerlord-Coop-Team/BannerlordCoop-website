import { hasExactKeys, isRecord } from "./dto-validation.ts";

// Bounded body reading and the versioned error envelope shared by the owner Edge routes.

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ERROR_CODE = /^[a-z][a-z0-9_-]{0,63}$/u;

/** A request or response body that declared or streamed more bytes than its bound. */
export class RequestTooLargeError extends Error {}

/** A correlated control-plane envelope: a result on success, a safe error otherwise. */
export type ControlPlaneEnvelope = { version: 1; requestId: string } & ({ ok: true; result: unknown } | { ok: false; error: Record<string, unknown> });

/** Builds the website's versioned `no-store` error envelope. */
export function errorResponse(
    status: number,
    requestId: string,
    code: string,
    message: string,
    retryable: boolean,
    headers: Record<string, string> = {},
) {
    return Response.json(
        { version: 1, requestId, ok: false, error: { code, message, retryable } },
        {
            status,
            headers: {
                ...headers,
                "cache-control": "private, no-store",
                "x-request-id": requestId,
            },
        },
    );
}

/** Reads a whole body, failing as soon as its declared or streamed length exceeds `maximumBytes`. */
export async function readBoundedBytes(
    source: { headers: Headers; body: ReadableStream<Uint8Array> | null },
    maximumBytes: number,
): Promise<Uint8Array> {
    const declaredLength = source.headers.get("content-length");
    if (
        declaredLength !== null
        && (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
    ) throw new RequestTooLargeError();
    if (source.body === null) return new Uint8Array(0);
    const reader = source.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximumBytes) {
            await reader.cancel();
            throw new RequestTooLargeError();
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

/** Reads a bounded body as UTF-8 text. */
export async function readBoundedText(
    source: { headers: Headers; body: ReadableStream<Uint8Array> | null },
    maximumBytes: number,
) {
    return new TextDecoder().decode(await readBoundedBytes(source, maximumBytes));
}

/** Whether a value is a well-formed envelope for this request ID with a safe error shape. */
export function isControlPlaneEnvelope(value: unknown, requestId: string): value is ControlPlaneEnvelope {
    if (!isRecord(value) || value.version !== 1 || value.requestId !== requestId || typeof value.ok !== "boolean") {
        return false;
    }
    if (value.ok) return hasExactKeys(value, ["ok", "requestId", "result", "version"]);
    if (!hasExactKeys(value, ["error", "ok", "requestId", "version"]) || !isRecord(value.error)
        || !hasExactKeys(value.error, value.error.operationId === undefined
            ? ["code", "message", "retryable"] : ["code", "message", "operationId", "retryable"])) return false;
    if (value.error.operationId !== undefined
        && (typeof value.error.operationId !== "string" || !REQUEST_ID.test(value.error.operationId))) return false;
    return typeof value.error.code === "string"
        && SAFE_ERROR_CODE.test(value.error.code)
        && typeof value.error.message === "string"
        && value.error.message.length >= 1
        && value.error.message.length <= 512
        && !/[\p{Cc}\p{Cf}]/u.test(value.error.message)
        && typeof value.error.retryable === "boolean";
}
