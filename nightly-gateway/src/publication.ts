import {
    validateNightlyPublicationManifest,
    validateNightlyPublicationPointer,
    type JsonObject,
    type NightlyPublicationPointer,
} from "./core";

export const NIGHTLY_POINTER_URL = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev/nightly/release.json";
const ARTIFACT_ORIGIN = "https://pub-bf6bfe4b880e4d1b83f4b09b10419f78.r2.dev";
const MAXIMUM_POINTER_BYTES = 4 * 1024;
const MAXIMUM_MANIFEST_BYTES = 128 * 1024;

type PrivateManifest = { size: number; body: ReadableStream<Uint8Array> };

export type NightlyPublicationFailureStage = "pointer" | "private_read" | "checksum" | "manifest" | "container";

/** Preserves the bounded stage and transport evidence needed to diagnose a failed publication read. */
export class NightlyPublicationReadError extends Error {
    readonly stage: NightlyPublicationFailureStage;
    readonly status: number | null;
    readonly exceptionClass: string;

    constructor(stage: NightlyPublicationFailureStage, cause: unknown, status: number | null = null) {
        const message = cause instanceof Error ? cause.message : String(cause);
        super(message || "nightly_publication_read_failed");
        this.name = "NightlyPublicationReadError";
        this.stage = stage;
        this.status = status;
        this.exceptionClass = cause instanceof Error && cause.name.length > 0 ? cause.name : "Error";
    }
}

function namedError(name: string, message: string): Error {
    const error = new Error(message);
    error.name = name;
    return error;
}

/** Resolves the same single public pointer as the CP, then verifies its private bytes. */
export async function readNightlyPublication(
    getPrivateManifest: (key: string) => Promise<PrivateManifest | null>,
    fetcher: typeof fetch = fetch,
    getPublicPointer?: () => Promise<PrivateManifest | null>,
): Promise<JsonObject> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
        return await readNightlyPublicationWithSignal(getPrivateManifest, fetcher, controller.signal, getPublicPointer);
    } finally {
        clearTimeout(timeout);
    }
}

async function readNightlyPublicationWithSignal(
    getPrivateManifest: (key: string) => Promise<PrivateManifest | null>,
    fetcher: typeof fetch,
    signal: AbortSignal,
    getPublicPointer?: () => Promise<PrivateManifest | null>,
): Promise<JsonObject> {
    let pointerBytes: Uint8Array;
    let pointerStatus: number | null = null;
    if (getPublicPointer !== undefined) {
        let object: PrivateManifest | null;
        try {
            object = await beforeDeadline(getPublicPointer(), signal);
        } catch (error) {
            throw new NightlyPublicationReadError("pointer", error);
        }
        if (object === null) {
            throw new NightlyPublicationReadError("pointer", namedError("R2ObjectMissing", "nightly_pointer_unavailable"));
        }
        if (!Number.isSafeInteger(object.size) || object.size < 2 || object.size > MAXIMUM_POINTER_BYTES) {
            await object.body.cancel();
            throw new NightlyPublicationReadError("pointer", namedError("R2ObjectInvalid", "nightly_pointer_unavailable"));
        }
        try {
            pointerBytes = await readBounded(object.body, MAXIMUM_POINTER_BYTES, signal);
        } catch (error) {
            throw new NightlyPublicationReadError("pointer", error);
        }
    } else {
        let response: Response;
        try {
            response = await fetcher.call(globalThis, NIGHTLY_POINTER_URL, {
                method: "GET", redirect: "manual", signal, headers: { "Cache-Control": "no-cache" },
            });
        } catch (error) {
            throw new NightlyPublicationReadError("pointer", error);
        }
        pointerStatus = response.status;
        if (response.status !== 200 || response.body === null) {
            await response.body?.cancel();
            throw new NightlyPublicationReadError("pointer", namedError("PointerUnavailable", "nightly_pointer_unavailable"), response.status);
        }
        try {
            pointerBytes = await readBounded(response.body, MAXIMUM_POINTER_BYTES, signal);
        } catch (error) {
            throw new NightlyPublicationReadError("pointer", error, response.status);
        }
    }
    let pointer: NightlyPublicationPointer;
    try {
        pointer = validateNightlyPublicationPointer(decodeJson(pointerBytes));
    } catch (error) {
        throw new NightlyPublicationReadError("pointer", error, pointerStatus);
    }
    let object: PrivateManifest | null;
    try {
        object = await beforeDeadline(getPrivateManifest(pointer.manifest.key), signal);
    } catch (error) {
        throw new NightlyPublicationReadError("private_read", error);
    }
    if (object === null) {
        throw new NightlyPublicationReadError("private_read", namedError("R2ObjectMissing", "nightly_manifest_unavailable"));
    }
    if (!Number.isSafeInteger(object.size) || object.size < 2 || object.size > MAXIMUM_MANIFEST_BYTES) {
        await object.body.cancel();
        throw new NightlyPublicationReadError("private_read", namedError("R2ObjectInvalid", "nightly_manifest_unavailable"));
    }
    let bytes: Uint8Array;
    try {
        bytes = await readBounded(object.body, MAXIMUM_MANIFEST_BYTES, signal);
    } catch (error) {
        throw new NightlyPublicationReadError("private_read", error);
    }
    const checksum = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
    const hex = Array.from(new Uint8Array(checksum), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hex !== pointer.manifest.sha256) {
        throw new NightlyPublicationReadError("checksum", namedError("ChecksumMismatch", "nightly_manifest_checksum_mismatch"));
    }
    let manifest: JsonObject;
    try {
        manifest = validateNightlyPublicationManifest(decodeJson(bytes), ARTIFACT_ORIGIN);
    } catch (error) {
        throw new NightlyPublicationReadError("manifest", error);
    }
    const container = manifest.container as JsonObject;
    if (container.manifestDigest !== pointer.container.manifestDigest
        || container.digestReference !== pointer.container.digestReference) {
        throw new NightlyPublicationReadError("container", namedError("ContainerMismatch", "nightly_manifest_container_mismatch"));
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
