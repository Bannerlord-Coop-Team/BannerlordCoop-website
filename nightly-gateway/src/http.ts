const JSON_HEADERS = Object.freeze({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
});

// Carries the HTTP status and stable error code returned to clients.
export class GatewayError extends Error {
    constructor(readonly status: number, readonly code: string) { super(code); }
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

// Decodes bytes as strict UTF-8, throwing on malformed input instead of substituting characters.
export function decodeUtf8(bytes: Uint8Array | ArrayBuffer): string {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}
