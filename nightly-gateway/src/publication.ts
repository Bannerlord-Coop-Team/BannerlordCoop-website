import {
    validateNightlyPublicationManifest,
    validateNightlyPublicationPointer,
    type JsonObject,
} from "./core";

export const NIGHTLY_POINTER_URL = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev/nightly/release.json";
const ARTIFACT_ORIGIN = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
const MAXIMUM_POINTER_BYTES = 4 * 1024;
const MAXIMUM_MANIFEST_BYTES = 128 * 1024;

type PrivateManifest = { size: number; body: ReadableStream<Uint8Array> };

/** Resolves the same single public pointer as the CP, then verifies its private bytes. */
export async function readNightlyPublication(
    getPrivateManifest: (key: string) => Promise<PrivateManifest | null>,
    fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
    const signal = AbortSignal.timeout(5_000);
    const response = await fetcher(NIGHTLY_POINTER_URL, {
        method: "GET", redirect: "error", signal, headers: { "Cache-Control": "no-cache" },
    });
    if (response.status !== 200 || response.body === null) {
        await response.body?.cancel();
        throw new Error("nightly_pointer_unavailable");
    }
    const pointerBytes = await readBounded(response.body, MAXIMUM_POINTER_BYTES, signal);
    const pointer = validateNightlyPublicationPointer(decodeJson(pointerBytes));
    const object = await beforeDeadline(getPrivateManifest(pointer.manifest.key), signal);
    if (object === null) throw new Error("nightly_manifest_unavailable");
    if (!Number.isSafeInteger(object.size) || object.size < 2 || object.size > MAXIMUM_MANIFEST_BYTES) {
        await object.body.cancel();
        throw new Error("nightly_manifest_unavailable");
    }
    const bytes = await readBounded(object.body, MAXIMUM_MANIFEST_BYTES, signal);
    const checksum = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
    const hex = Array.from(new Uint8Array(checksum), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hex !== pointer.manifest.sha256) throw new Error("nightly_manifest_checksum_mismatch");
    const manifest = validateNightlyPublicationManifest(decodeJson(bytes), ARTIFACT_ORIGIN);
    const container = manifest.container as JsonObject;
    if (container.manifestDigest !== pointer.container.manifestDigest
        || container.digestReference !== pointer.container.digestReference) {
        throw new Error("nightly_manifest_container_mismatch");
    }
    signal.throwIfAborted();
    return manifest;
}

function decodeJson(bytes: Uint8Array): unknown {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
}

async function beforeDeadline<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
        const abort = () => { reject(new Error("nightly_publication_timeout")); };
        signal.addEventListener("abort", abort, { once: true });
        void pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

async function readBounded(body: ReadableStream<Uint8Array>, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await beforeDeadline(reader.read(), signal);
            if (done) break;
            size += value.byteLength;
            if (size > maximum) throw new Error("nightly_publication_too_large");
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return bytes;
    } finally { await reader.cancel(); }
}
