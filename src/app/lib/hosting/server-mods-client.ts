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
import { ServerModsError, type ServerModArchive, type ServerModCatalog, type ServerModsState, type ServerModUploadProgress } from "./server-mods";

// The API-backed ServerModCatalog. It follows the website transport contract's retry rules: identical
// resends under the same requestId (or the same chunk index and digest), backoff on retryable failures
// for at least two minutes, one session refresh after a 401, gentle status polling, and `list` as the
// authority whenever an outcome is unknown.

/** A browser-facing failure from the website's mods routes. */
export type ServerModsCallFailure = { code: string; retryable: boolean; modId: string | null };
export type ServerModsCallResult<T> = { ok: true; result: T } | { ok: false; error: ServerModsCallFailure };

/** Sends one mods call to the website's routes; `refreshSession` asks the route to refresh the session first. */
export interface ServerModsTransport {
    send(serverId: string, request: ModsRequest, options: { refreshSession: boolean }): Promise<ServerModsCallResult<unknown>>;
    putChunk(serverId: string, chunk: { uploadId: string; index: number; sha256: string; bytes: Uint8Array<ArrayBuffer> }, options: { refreshSession: boolean }): Promise<ServerModsCallResult<ModChunkReceipt>>;
}

export type ServerModCatalogDependencies = {
    transport: ServerModsTransport;
    sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
    randomUUID(): string;
    sleep(milliseconds: number): Promise<void>;
    now(): number;
};

/** Mutations, chunks and reconciling reads retry for at least two minutes, covering a deployment restart. */
export const MODS_RETRY_WINDOW_MILLISECONDS = 150_000;
/** A plain list read gives up sooner; the panel offers its own retry. */
export const MODS_READ_RETRY_WINDOW_MILLISECONDS = 20_000;
/** An install settles within about ten minutes (one five-minute dispatch, one replay and a list). */
export const MOD_INSTALL_SETTLE_MILLISECONDS = 12 * 60_000;
const RETRY_DELAYS_MILLISECONDS = [1_000, 2_000, 4_000, 8_000, 15_000];
const FIRST_STATUS_POLL_MILLISECONDS = 2_000;
const MAXIMUM_STATUS_POLL_MILLISECONDS = 10_000;
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(MOD_UPLOAD_ACTIVE_STATUSES);

/** Builds the catalog over an injected transport, hashing, ids and time. */
export function createServerModCatalog(dependencies: ServerModCatalogDependencies): ServerModCatalog {
    const { transport, sleep, now, randomUUID } = dependencies;

    /** Sends until success, a refusal, or the retry window ends; a 401 refreshes the session and retries once. */
    async function call<T>(send: (refreshSession: boolean) => Promise<ServerModsCallResult<T>>, windowMilliseconds: number): Promise<T> {
        const started = now();
        let refreshed = false;
        let refreshNext = false;
        for (let attempt = 0; ; attempt += 1) {
            const outcome = await send(refreshNext);
            refreshNext = false;
            if (outcome.ok) return outcome.result;
            const { code, retryable, modId } = outcome.error;
            if (code === "unauthenticated" && !refreshed) {
                refreshed = refreshNext = true;
                continue;
            }
            if (!retryable || now() - started >= windowMilliseconds) throw new ServerModsError(code, retryable, modId);
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
    async function sendChunks(serverId: string, session: ModUploadSession, archive: ServerModArchive, report: (progress: ServerModUploadProgress) => void) {
        const totalBytes = archive.bytes.byteLength;
        let sentBytes = 0;
        for (let index = 0; index < session.chunkCount; index += 1) {
            const start = index * MOD_UPLOAD_CHUNK_BYTES;
            const bytes = archive.bytes.subarray(start, start + modChunkLength(totalBytes, index));
            const sha256 = await dependencies.sha256(bytes);
            await call(refreshSession => transport.putChunk(serverId, { uploadId: session.uploadId, index, sha256, bytes }, { refreshSession }), MODS_RETRY_WINDOW_MILLISECONDS);
            sentBytes += bytes.byteLength;
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

    return {
        listServerMods: serverId => list(serverId),
        saveServerModOrder: (serverId, expectedRevision, order) =>
            route(serverId, { route: "load-order", body: { requestId: randomUUID(), serverId, expectedRevision, mods: order } }),
        deleteServerMod: (serverId, expectedRevision, modId) =>
            route(serverId, { route: "delete", body: { requestId: randomUUID(), serverId, expectedRevision, modId } }),
        async uploadServerMod(serverId, expectedRevision, archive, onProgress = () => {}) {
            const totalBytes = archive.bytes.byteLength;
            onProgress({ phase: "creating", sentBytes: 0, totalBytes });
            const sha256 = await dependencies.sha256(archive.bytes);
            const session = await route<ModUploadSession>(serverId, { route: "uploads", body: {
                requestId: randomUUID(), serverId, expectedRevision, manifest: archive.manifest, totalBytes, sha256,
            } });
            if (session.chunkCount !== modChunkCount(totalBytes)) throw new ServerModsError("invalid_response", false);
            await sendChunks(serverId, session, archive, onProgress);
            onProgress({ phase: "installing", sentBytes: totalBytes, totalBytes });
            try {
                await route(serverId, { route: "complete", body: { requestId: randomUUID(), uploadId: session.uploadId, expectedRevision } });
            } catch (error) {
                // A forgotten session or an unanswered completion may still have installed; `list` decides.
                if (!(error instanceof ServerModsError) || !(error.retryable || error.code === "upload_not_found")) throw error;
                onProgress({ phase: "verifying", sentBytes: totalBytes, totalBytes });
                return reconcile(serverId, archive, sha256);
            }
            onProgress({ phase: "verifying", sentBytes: totalBytes, totalBytes });
            return settle(serverId, session.uploadId, archive, sha256);
        },
    };
}
