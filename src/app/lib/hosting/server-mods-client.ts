import {
    MOD_UPLOAD_ACTIVE_STATUSES,
    MOD_UPLOAD_CHUNK_BYTES,
    modChunkCount,
    modChunkLength,
    type ModChunkReceipt,
    type ModsRequest,
    type ModUploadSession,
    type ModUploadStatus,
} from "../../../../supabase/functions/_shared/server-mods-contract";
import { readServerModArchive, serverModArchiveSize, ServerModsError, type PendingServerModUpload, type ServerModArchive, type ServerModCatalog, type ServerModResumeStore, type ServerModsState, type ServerModUploadProgress } from "./server-mods";

// The API-backed ServerModCatalog. It follows the website transport contract's retry rules: identical
// resends under the same requestId (or the same chunk index and digest), backoff on retryable failures
// for at least two minutes, one session refresh after a 401, gentle status polling, and `list` as the
// authority whenever an outcome is unknown.

/** A browser-facing failure from the website's mods routes; `issue` is the control plane's reason for a refused runs-on switch. */
export type ServerModsCallFailure = { code: string; retryable: boolean; modId: string | null; issue?: string };
export type ServerModsCallResult<T> = { ok: true; result: T } | { ok: false; error: ServerModsCallFailure };

/** Sends one mods call to the website's routes; `refreshSession` asks the route to refresh the session first. */
export interface ServerModsTransport {
    send(serverId: string, request: ModsRequest, options: { refreshSession: boolean }): Promise<ServerModsCallResult<unknown>>;
    putChunk(serverId: string, chunk: { uploadId: string; index: number; sha256: string; bytes: Uint8Array<ArrayBuffer> }, options: { refreshSession: boolean; signal?: AbortSignal }): Promise<ServerModsCallResult<ModChunkReceipt>>;
}

export type ServerModCatalogDependencies = {
    transport: ServerModsTransport;
    sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
    randomUUID(): string;
    sleep(milliseconds: number): Promise<void>;
    now(): number;
    resumeStore?: ServerModResumeStore;
};

/** Mutations, chunks and reconciling reads retry for at least two minutes, covering a deployment restart. */
export const MODS_RETRY_WINDOW_MILLISECONDS = 150_000;
/** A plain list read gives up sooner; the panel offers its own retry. */
export const MODS_READ_RETRY_WINDOW_MILLISECONDS = 20_000;
/** Covers a thirty-minute dispatch, its one replay and a final authoritative list. */
export const MOD_INSTALL_SETTLE_MILLISECONDS = 65 * 60_000;
const RETRY_DELAYS_MILLISECONDS = [1_000, 2_000, 4_000, 8_000, 15_000];
const FIRST_STATUS_POLL_MILLISECONDS = 2_000;
const MAXIMUM_STATUS_POLL_MILLISECONDS = 10_000;
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(MOD_UPLOAD_ACTIVE_STATUSES);

/** Builds the catalog over an injected transport, hashing, ids and time. */
export function createServerModCatalog(dependencies: ServerModCatalogDependencies): ServerModCatalog {
    const { transport, sleep, now, randomUUID } = dependencies;
    const pendingUploads = new Map<string, PendingServerModUpload>();

    function checkPaused(signal?: AbortSignal) {
        if (signal?.aborted) throw new ServerModsError("upload_paused");
    }

    async function pendingUpload(serverId: string): Promise<PendingServerModUpload | null> {
        const stored = pendingUploads.get(serverId) ?? await dependencies.resumeStore?.get(serverId);
        if (stored) pendingUploads.set(serverId, stored);
        return stored ?? null;
    }

    async function remember(upload: PendingServerModUpload) {
        pendingUploads.set(upload.serverId, upload);
        await dependencies.resumeStore?.save(upload);
    }

    async function clear(serverId: string) {
        pendingUploads.delete(serverId);
        await dependencies.resumeStore?.clear(serverId).catch(() => undefined);
    }

    /** Sends until success, a refusal, or the retry window ends; a 401 refreshes the session and retries once. */
    async function call<T>(send: (refreshSession: boolean) => Promise<ServerModsCallResult<T>>, windowMilliseconds: number, signal?: AbortSignal): Promise<T> {
        const started = now();
        let refreshed = false;
        let refreshNext = false;
        for (let attempt = 0; ; attempt += 1) {
            checkPaused(signal);
            const outcome = await send(refreshNext);
            checkPaused(signal);
            refreshNext = false;
            if (outcome.ok) return outcome.result;
            const { code, retryable, modId, issue } = outcome.error;
            if (code === "unauthenticated" && !refreshed) {
                refreshed = refreshNext = true;
                continue;
            }
            if (!retryable || now() - started >= windowMilliseconds) throw new ServerModsError(code, retryable, modId, issue ?? null);
            await sleep(RETRY_DELAYS_MILLISECONDS[Math.min(attempt, RETRY_DELAYS_MILLISECONDS.length - 1)]);
        }
    }

    /** Sends one JSON route with the given retry window. */
    function route<T>(serverId: string, request: ModsRequest, windowMilliseconds = MODS_RETRY_WINDOW_MILLISECONDS): Promise<T> {
        return call(refreshSession => transport.send(serverId, request, { refreshSession }), windowMilliseconds) as Promise<T>;
    }

    /** Lists the installed mods; `reconcile` uses the full window because an unknown outcome depends on it. */
    function list(serverId: string, reconcile = false): Promise<ServerModsState> {
        return route(serverId, { route: "list", body: { serverId } }, reconcile ? MODS_RETRY_WINDOW_MILLISECONDS : MODS_READ_RETRY_WINDOW_MILLISECONDS);
    }

    /** Sends every chunk in order, one at a time, resending the same index and digest after a retryable failure. */
    async function sendChunks(serverId: string, session: ModUploadSession, archive: ServerModArchive, report: (progress: ServerModUploadProgress) => void, received: ReadonlySet<number>, signal?: AbortSignal) {
        const totalBytes = serverModArchiveSize(archive);
        let sentBytes = [...received].reduce((sum, index) => sum + modChunkLength(totalBytes, index), 0);
        report({ phase: "uploading", sentBytes, totalBytes });
        for (let index = 0; index < session.chunkCount; index += 1) {
            checkPaused(signal);
            if (received.has(index)) continue;
            const start = index * MOD_UPLOAD_CHUNK_BYTES;
            const bytes = await readServerModArchive(archive, start, modChunkLength(totalBytes, index));
            const sha256 = await dependencies.sha256(bytes);
            await call(refreshSession => transport.putChunk(serverId, { uploadId: session.uploadId, index, sha256, bytes }, { refreshSession, signal }), MODS_RETRY_WINDOW_MILLISECONDS, signal);
            sentBytes += bytes.byteLength;
            const pending = pendingUploads.get(serverId);
            if (pending) { pending.sentBytes = sentBytes; await remember(pending); }
            report({ phase: "uploading", sentBytes, totalBytes });
        }
    }

    /** Polls `status` no faster than every two seconds until terminal, reconciling unknown outcomes through `list`. */
    async function settle(serverId: string, uploadId: string, archive: ServerModArchive, sha256: string): Promise<ServerModsState> {
        const deadline = now() + MOD_INSTALL_SETTLE_MILLISECONDS;
        let delay = FIRST_STATUS_POLL_MILLISECONDS;
        for (;;) {
            await sleep(delay);
            delay = Math.min(Math.round(delay * 1.5), MAXIMUM_STATUS_POLL_MILLISECONDS);
            let status: ModUploadStatus;
            try {
                status = await route<ModUploadStatus>(serverId, { route: "status", body: { serverId, uploadId } }, 0);
            } catch (error) {
                if (error instanceof ServerModsError && error.retryable && now() < deadline) continue;
                return reconcile(serverId, archive, sha256);
            }
            if (status.status === "installed" && "state" in status) return status.state;
            if (status.status === "rejected" && "error" in status) throw new ServerModsError("upload_rejected", false, archive.manifest.id, status.error);
            if (status.status === "failed") throw new ServerModsError("upload_failed", false, archive.manifest.id);
            if (status.status === "expired") throw new ServerModsError("upload_expired", false, archive.manifest.id);
            if (ACTIVE_STATUSES.has(status.status) && now() < deadline) continue;
            // `unconfirmed`, an unknown status, or an install that outlived the settle window.
            return reconcile(serverId, archive, sha256);
        }
    }

    /** Treats `list` as authoritative: installed exactly when the id is present with the uploaded archive's digest. */
    async function reconcile(serverId: string, archive: ServerModArchive, sha256: string): Promise<ServerModsState> {
        let state: ServerModsState;
        try {
            state = await list(serverId, true);
        } catch (error) {
            // A refused read cannot establish whether an earlier completion installed the mod.
            if (error instanceof ServerModsError && error.code === "server_suspended") {
                throw new ServerModsError("upload_status_unavailable", false, archive.manifest.id);
            }
            throw error;
        }
        if (state.mods.some(mod => mod.id === archive.manifest.id && mod.sha256 === sha256)) return state;
        throw new ServerModsError("upload_unconfirmed", false, archive.manifest.id);
    }

    async function performUpload(serverId: string, expectedRevision: string, archive: ServerModArchive, onProgress: (progress: ServerModUploadProgress) => void, options: { signal?: AbortSignal }): Promise<ServerModsState> {
        checkPaused(options.signal);
        const totalBytes = serverModArchiveSize(archive);
        const sha256 = archive.source?.sha256 ?? await dependencies.sha256(archive.bytes);
        let pending = await pendingUpload(serverId);
        if (pending && pending.archive !== archive && (pending.archive.source === undefined || pending.archive.source.id !== archive.source?.id)) throw new ServerModsError("upload_busy");
        if (!pending) {
            pending = { serverId, archive, expectedRevision, createRequestId: randomUUID(), completeRequestId: randomUUID() };
            await remember(pending);
        }
        const stored = pending;
        onProgress({ phase: "creating", sentBytes: 0, totalBytes });
        let received: ReadonlySet<number> = new Set();
        const previousSession = stored.session;
        if (previousSession) {
            let status: ModUploadStatus | undefined;
            try {
                status = await route<ModUploadStatus>(serverId, { route: "status", body: { serverId, uploadId: previousSession.uploadId, includeReceivedChunks: true } })
                    .catch((error: unknown) => {
                        if (!(error instanceof ServerModsError) || error.code !== "invalid_request") throw error;
                        return route<ModUploadStatus>(serverId, { route: "status", body: { serverId, uploadId: previousSession.uploadId } });
                    });
            } catch (error) {
                if (!(error instanceof ServerModsError) || error.code !== "upload_not_found") throw error;
                if (stored.completionStarted) {
                    const state = await reconcile(serverId, archive, sha256);
                    await clear(serverId);
                    return state;
                }
                // No completion was sent: a forgotten session cannot install. Reuse the cached archive for a new attempt.
                stored.session = undefined;
                stored.createRequestId = randomUUID();
                stored.completeRequestId = randomUUID();
                await remember(stored);
            }
            if (status !== undefined) {
                if (status.status === "installed" && "state" in status) { await clear(serverId); return status.state; }
                if (status.status === "rejected" && "error" in status) { await clear(serverId); throw new ServerModsError("upload_rejected", false, archive.manifest.id, status.error); }
                if (status.status === "expired" || status.status === "failed") { await clear(serverId); throw new ServerModsError(`upload_${status.status}`, false, archive.manifest.id); }
                if (status.status !== "receiving") {
                    const state = await settle(serverId, previousSession.uploadId, archive, sha256);
                    await clear(serverId);
                    return state;
                }
                const indices = "receivedIndices" in status ? status.receivedIndices : undefined;
                if (indices?.some(index => index >= previousSession.chunkCount)) throw new ServerModsError("invalid_response", true);
                received = new Set(indices ?? []);
            }
        }
        if (!stored.session) {
            stored.session = await route<ModUploadSession>(serverId, { route: "uploads", body: {
                requestId: stored.createRequestId, serverId, expectedRevision: stored.expectedRevision, manifest: archive.manifest,
                totalBytes, uncompressedBytes: archive.uncompressedBytes, sha256,
            } });
            await remember(stored);
        }
        const session = stored.session;
        if (session.chunkCount !== modChunkCount(totalBytes)) throw new ServerModsError("invalid_response", false);
        await sendChunks(serverId, session, archive, onProgress, received, options.signal);
        checkPaused(options.signal);
        onProgress({ phase: "installing", sentBytes: totalBytes, totalBytes });
        stored.completionStarted = true;
        await remember(stored);
        try {
            await route(serverId, { route: "complete", body: { requestId: stored.completeRequestId, uploadId: session.uploadId, expectedRevision: stored.expectedRevision } });
        } catch (error) {
            if (!(error instanceof ServerModsError) || !(error.retryable || error.code === "upload_not_found")) throw error;
            onProgress({ phase: "verifying", sentBytes: totalBytes, totalBytes });
            const state = await reconcile(serverId, archive, sha256);
            await clear(serverId);
            return state;
        }
        onProgress({ phase: "verifying", sentBytes: totalBytes, totalBytes });
        const state = await settle(serverId, session.uploadId, archive, sha256);
        await clear(serverId);
        return state;
    }

    async function uploadServerMod(serverId: string, expectedRevision: string, archive: ServerModArchive, onProgress: (progress: ServerModUploadProgress) => void = () => {}, options: { signal?: AbortSignal } = {}) {
        try {
            return await performUpload(serverId, expectedRevision, archive, onProgress, options);
        } catch (error) {
            if (error instanceof ServerModsError && ["upload_rejected", "upload_failed", "upload_expired", "revision_conflict", "request_conflict", "upload_chunk_conflict", "invalid_request"].includes(error.code)) await clear(serverId);
            throw error;
        }
    }

    return {
        listServerMods: serverId => list(serverId),
        saveServerModOrder: (serverId, expectedRevision, order) =>
            route(serverId, { route: "load-order", body: { requestId: randomUUID(), serverId, expectedRevision, mods: order } }),
        deleteServerMod: (serverId, expectedRevision, modId) =>
            route(serverId, { route: "delete", body: { requestId: randomUUID(), serverId, expectedRevision, modId } }),
        uploadServerMod,
        pendingServerModUpload: pendingUpload,
        async resumeServerModUpload(serverId, onProgress, options) {
            const pending = await pendingUpload(serverId);
            if (pending === null) throw new ServerModsError("upload_not_found");
            return uploadServerMod(serverId, pending.expectedRevision, pending.archive, onProgress, options);
        },
    };
}
