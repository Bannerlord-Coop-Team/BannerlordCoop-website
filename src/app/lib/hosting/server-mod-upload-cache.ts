// Prepared archives stay in IndexedDB; neither compression nor resume requires a multi-gigabyte ArrayBuffer.
import { sha256 } from "@noble/hashes/sha256";
import { MOD_ARCHIVE_MAXIMUM_ENTRIES, MOD_ARCHIVE_MAXIMUM_UNCOMPRESSED_BYTES, MOD_UPLOAD_CHUNK_BYTES, MOD_UPLOAD_MAXIMUM_BYTES, isModId, isModName, isModVersion, parseModUploadSession, type ModUploadManifest } from "../../../../supabase/functions/_shared/server-mods-contract";
import { ServerModsError, type PendingServerModUpload, type ServerModArchive, type ServerModArchiveSource, type ServerModResumeStore } from "./server-mods";

const DATABASE = "bannerlordcoop-mod-uploads-v1";
const ARCHIVES = "archives";
const PARTS = "parts";
const UPLOADS = "uploads";
const RETENTION_MILLISECONDS = 8 * 60 * 60_000;
const MAXIMUM_PREPARED_ARCHIVES = 8;
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

interface ArchiveRecord {
    id: string;
    manifest: ModUploadManifest;
    sizeBytes: number;
    sha256: string;
    fileCount: number;
    uncompressedBytes: number;
    createdAt: number;
}

type UploadRecord = Omit<PendingServerModUpload, "archive"> & { archiveId: string };

let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
            for (const name of [ARCHIVES, PARTS, UPLOADS]) request.result.createObjectStore(name);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = request.onblocked = () => reject(new ServerModsError("browser_storage_unavailable"));
    }).catch((error: unknown) => { opening = undefined; throw error; });
    return opening;
}

async function read<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await database();
    return new Promise((resolve, reject) => {
        const request = db.transaction(store, "readonly").objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(new ServerModsError("browser_storage_unavailable"));
    });
}

async function mutate(store: string, work: (objects: IDBObjectStore) => void): Promise<void> {
    const db = await database();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(store, "readwrite");
        work(transaction.objectStore(store));
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(new ServerModsError("browser_storage_unavailable"));
    });
}

export async function discardPreparedModArchive(id: string): Promise<void> {
    if (!UUID.test(id)) return;
    await mutate(PARTS, store => store.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
    await mutate(ARCHIVES, store => store.delete(id));
}

function source(record: ArchiveRecord): ServerModArchiveSource {
    return {
        id: record.id, sizeBytes: record.sizeBytes, sha256: record.sha256,
        async read(offset, length) {
            if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1
                || length > MOD_UPLOAD_CHUNK_BYTES || offset + length > record.sizeBytes) throw new ServerModsError("invalid_request");
            const bytes = new Uint8Array(length);
            let written = 0;
            while (written < length) {
                const position = offset + written;
                const index = Math.floor(position / MOD_UPLOAD_CHUNK_BYTES);
                const part = await read<Uint8Array>(PARTS, [record.id, index]);
                const expected = Math.min(MOD_UPLOAD_CHUNK_BYTES, record.sizeBytes - index * MOD_UPLOAD_CHUNK_BYTES);
                if (!(part instanceof Uint8Array) || part.byteLength !== expected) throw new ServerModsError("browser_storage_unavailable");
                const start = position % MOD_UPLOAD_CHUNK_BYTES;
                const count = Math.min(length - written, part.byteLength - start);
                bytes.set(part.subarray(start, start + count), written);
                written += count;
            }
            return bytes;
        },
    };
}

export interface PreparedModArchiveWriter {
    append(bytes: Uint8Array): Promise<void>;
    finish(details: { manifest: ModUploadManifest; fileCount: number; uncompressedBytes: number }): Promise<ServerModArchive>;
    abort(): Promise<void>;
}

/** Includes unfinished preparations, so closing a tab cannot leave untracked multi-gigabyte parts forever. */
export async function prunePreparedModArchives(): Promise<void> {
    const db = await database();
    const records = await new Promise<Pick<ArchiveRecord, "id" | "createdAt">[]>((resolve, reject) => {
        const request = db.transaction(ARCHIVES, "readonly").objectStore(ARCHIVES).getAll(undefined, MAXIMUM_PREPARED_ARCHIVES + 1);
        request.onsuccess = () => resolve(request.result as Pick<ArchiveRecord, "id" | "createdAt">[]);
        request.onerror = () => reject(new ServerModsError("browser_storage_unavailable"));
    });
    let kept = 0;
    for (const record of records) {
        if (!Number.isFinite(record.createdAt) || record.createdAt > Date.now() || Date.now() - record.createdAt > RETENTION_MILLISECONDS) await discardPreparedModArchive(record.id);
        else kept += 1;
    }
    if (kept >= MAXIMUM_PREPARED_ARCHIVES) throw new ServerModsError("browser_storage_unavailable");
}

/** Each committed part is at most 8 MiB; the rolling digest covers the exact ZIP stream, including its directory. */
export function createPreparedModArchiveWriter(): PreparedModArchiveWriter {
    const id = crypto.randomUUID();
    const hash = sha256.create();
    let size = 0;
    let index = 0;
    let buffered = new Uint8Array(MOD_UPLOAD_CHUNK_BYTES);
    let used = 0;
    let closed = false;
    let initialized = false;
    const flush = async () => {
        if (used === 0) return;
        const part = buffered.slice(0, used);
        await mutate(PARTS, store => store.put(part, [id, index]));
        index += 1;
        used = 0;
    };
    return {
        async append(bytes) {
            if (closed || size + bytes.byteLength > MOD_UPLOAD_MAXIMUM_BYTES) throw new ServerModsError("mod_archive_too_large");
            if (!initialized) {
                await mutate(ARCHIVES, store => {
                    const count = store.count();
                    count.onsuccess = () => {
                        if (count.result >= MAXIMUM_PREPARED_ARCHIVES) store.transaction.abort();
                        else store.add({ id, createdAt: Date.now(), sizeBytes: 0 }, id);
                    };
                });
                initialized = true;
            }
            hash.update(bytes);
            size += bytes.byteLength;
            for (let position = 0; position < bytes.byteLength;) {
                const count = Math.min(bytes.byteLength - position, buffered.byteLength - used);
                buffered.set(bytes.subarray(position, position + count), used);
                used += count;
                position += count;
                if (used === buffered.byteLength) await flush();
            }
        },
        async finish(details) {
            if (closed || size === 0) throw new ServerModsError("invalid_request");
            await flush();
            closed = true;
            const digest = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, "0")).join("");
            const record: ArchiveRecord = { ...details, id, sizeBytes: size, sha256: digest, createdAt: Date.now() };
            await mutate(ARCHIVES, store => store.put(record, id));
            buffered.fill(0);
            buffered = new Uint8Array(0);
            return { ...details, bytes: new Uint8Array(0), source: source(record) };
        },
        async abort() { closed = true; buffered.fill(0); await discardPreparedModArchive(id); },
    };
}

async function prepared(id: string): Promise<ServerModArchive | null> {
    if (!UUID.test(id)) return null;
    const record = await read<ArchiveRecord>(ARCHIVES, id);
    if (record === undefined) return null;
    if (record.id !== id || !Number.isSafeInteger(record.sizeBytes) || record.sizeBytes < 1 || record.sizeBytes > MOD_UPLOAD_MAXIMUM_BYTES
        || !SHA256.test(record.sha256) || !isModId(record.manifest?.id) || !isModName(record.manifest?.name) || !isModVersion(record.manifest?.version)
        || !Number.isSafeInteger(record.fileCount) || record.fileCount < 1 || record.fileCount > MOD_ARCHIVE_MAXIMUM_ENTRIES
        || !Number.isSafeInteger(record.uncompressedBytes) || record.uncompressedBytes < 1 || record.uncompressedBytes > MOD_ARCHIVE_MAXIMUM_UNCOMPRESSED_BYTES
        || !Number.isFinite(record.createdAt) || record.createdAt > Date.now() || Date.now() - record.createdAt > RETENTION_MILLISECONDS) {
        await discardPreparedModArchive(id);
        return null;
    }
    return { manifest: record.manifest, fileCount: record.fileCount, uncompressedBytes: record.uncompressedBytes,
        bytes: new Uint8Array(0), source: source(record) };
}

/** Resume metadata stays in this browser; the server's authorization and digest checks remain authoritative. */
export const browserModResumeStore: ServerModResumeStore = {
    async get(serverId) {
        const record = await read<UploadRecord>(UPLOADS, serverId);
        if (record === undefined) return null;
        if (record.serverId !== serverId || !SHA256.test(record.expectedRevision)
            || !UUID.test(record.createRequestId) || !UUID.test(record.completeRequestId)
            || !UUID.test(record.archiveId) || record.completionStarted !== undefined && typeof record.completionStarted !== "boolean") {
            await mutate(UPLOADS, store => store.delete(serverId));
            return null;
        }
        const archive = await prepared(record.archiveId);
        if (archive === null) { await mutate(UPLOADS, store => store.delete(serverId)); return null; }
        const upload = record;
        if (upload.sentBytes !== undefined && (!Number.isSafeInteger(upload.sentBytes) || upload.sentBytes < 0 || upload.sentBytes > archive.source!.sizeBytes)) return null;
        let session;
        try { session = upload.session === undefined ? undefined : parseModUploadSession(upload.session, archive.source!.sizeBytes); }
        catch { await mutate(UPLOADS, store => store.delete(serverId)); await discardPreparedModArchive(record.archiveId); return null; }
        return { serverId, archive, session, expectedRevision: record.expectedRevision, createRequestId: record.createRequestId,
            completeRequestId: record.completeRequestId, ...(upload.sentBytes === undefined ? {} : { sentBytes: upload.sentBytes }),
            ...(record.completionStarted === undefined ? {} : { completionStarted: record.completionStarted }) };
    },
    async save(upload) {
        const archiveId = upload.archive.source?.id;
        if (archiveId === undefined) return;
        const { archive: preparedArchive, ...record } = upload;
        void preparedArchive;
        await mutate(UPLOADS, store => store.put({ ...record, archiveId }, upload.serverId));
    },
    async clear(serverId) {
        const record = await read<UploadRecord>(UPLOADS, serverId);
        await mutate(UPLOADS, store => store.delete(serverId));
        if (record !== undefined) await discardPreparedModArchive(record.archiveId);
    },
};
