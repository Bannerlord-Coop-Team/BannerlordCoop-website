const JSON_HEADERS = Object.freeze({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
});

const SAFE_ERROR_CODE = /^[a-z0-9_]{1,64}$/;

/** Receives one structured log event; the Worker writes it as a JSON line, tests collect it. */
export type GatewayLog = (event: Record<string, unknown>) => void;

/** The outbound HTTP call the gateway depends on; production passes the Workers global fetch. */
export type UpstreamFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Log-only context on a GatewayError: the underlying failure and, for relayed calls, the upstream HTTP status. */
export type GatewayErrorOptions = { cause?: unknown; upstreamStatus?: number };

// Carries the HTTP status and stable error code returned to clients.
// Its cause and upstream status are for the top-level log only and never reach the response body.
export class GatewayError extends Error {
    readonly upstreamStatus?: number;

    constructor(readonly status: number, readonly code: string, options: GatewayErrorOptions = {}) {
        super(code, options);
        this.upstreamStatus = options.upstreamStatus;
    }
}

// Returns an error's message only when it is a bare snake_case code, which is safe to log.
// Any other message text may carry secrets or user input, so it yields undefined.
export function safeErrorCode(error: unknown): string | undefined {
    if (!(error instanceof Error) || !SAFE_ERROR_CODE.test(error.message)) return undefined;
    return error.message;
}

// Serializes one JSON body with the gateway's no-store headers.
export function json(value: unknown, status = 200): Response {
    return new Response(`${JSON.stringify(value)}\n`, { status, headers: JSON_HEADERS });
}

// Reads a message body up to a byte limit; null means the declared or streamed size passed the limit.
// Stream failures propagate so callers can tell a broken body from an oversized one.
export async function readBoundedBytes(message: Request | Response, maximum: number): Promise<Uint8Array | null> {
    const declared = Number(message.headers.get("content-length") ?? 0);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maximum) return null;
    if (message.body === null) return new Uint8Array(0);
    return collectChunks(message.body.getReader(), maximum);
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

// Reads a small urlencoded form body, refusing anything over 4 KiB.
export async function readForm(request: Request): Promise<URLSearchParams> {
    const bytes = await readBoundedBytes(request, 4096);
    if (bytes === null) throw new GatewayError(413, "request_too_large");
    return new URLSearchParams(decodeUtf8(bytes));
}

// Decodes bytes as strict UTF-8, throwing on malformed input instead of substituting characters.
export function decodeUtf8(bytes: Uint8Array | ArrayBuffer): string {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}
