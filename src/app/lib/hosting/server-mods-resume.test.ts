import assert from "node:assert/strict";
import test from "node:test";
import { MOD_UPLOAD_CHUNK_BYTES, type ModChunkReceipt, type ModsRequest } from "../../../../supabase/functions/_shared/server-mods-contract";
import { createServerModCatalog, type ServerModsTransport } from "./server-mods-client";
import type { PendingServerModUpload, ServerModArchive, ServerModResumeStore, ServerModsState } from "./server-mods";
import { webSha256 } from "./server-mods-transport";

test("resumes from server receipts in a new browser client without rebuilding, re-reading or resending an acknowledged part", async () => {
    const serverId = "11111111-1111-4111-8111-111111111111";
    const uploadId = "22222222-2222-4222-8222-222222222222";
    const revision = "a".repeat(64);
    const bytes = new Uint8Array(MOD_UPLOAD_CHUNK_BYTES + 5).fill(29);
    const sha256 = await webSha256(bytes);
    const reads: [number, number][] = [];
    const archive: ServerModArchive = {
        manifest: { id: "LargeMod", name: "Large Mod", version: "v1" }, bytes: new Uint8Array(0), uncompressedBytes: bytes.byteLength, fileCount: 2,
        source: { id: "33333333-3333-4333-8333-333333333333", sizeBytes: bytes.byteLength, sha256,
            async read(offset, length) { assert.ok(length <= MOD_UPLOAD_CHUNK_BYTES); reads.push([offset, length]); return bytes.slice(offset, offset + length); } },
    };
    const installed: ServerModsState = { revision: "b".repeat(64), restartRequired: true, mods: [] };
    const cached = new Map<string, PendingServerModUpload>();
    const resumeStore: ServerModResumeStore = {
        get: async id => cached.get(id) ?? null,
        save: async upload => { cached.set(upload.serverId, { ...upload }); },
        clear: async id => { cached.delete(id); },
    };
    const requests: ModsRequest[] = [];
    const indices: number[] = [];
    let completed = false;
    const transport: ServerModsTransport = {
        async send(id, request) {
            assert.equal(id, serverId);
            requests.push(structuredClone(request));
            if (request.route === "uploads") return { ok: true, result: { uploadId, chunkCount: 2, chunkBytes: MOD_UPLOAD_CHUNK_BYTES, expiresAt: "2026-11-08T00:00:00.000Z", replaces: false } };
            if (request.route === "complete") { completed = true; return { ok: true, result: { uploadId, status: "installing" } }; }
            if (request.route === "status") return { ok: true, result: completed ? { uploadId, status: "installed", state: installed }
                : { uploadId, status: "receiving", receivedIndices: [...indices], receivedBytes: MOD_UPLOAD_CHUNK_BYTES } };
            throw new Error(`unexpected route ${request.route}`);
        },
        async putChunk(id, chunk) {
            assert.equal(id, serverId);
            assert.equal(chunk.uploadId, uploadId);
            assert.equal(chunk.sha256, await webSha256(chunk.bytes));
            assert.ok(!indices.includes(chunk.index), "an acknowledged part must not be resent");
            indices.push(chunk.index);
            return { ok: true, result: { receivedChunks: indices.length, receivedBytes: indices.length === 1 ? MOD_UPLOAD_CHUNK_BYTES : bytes.byteLength } satisfies ModChunkReceipt };
        },
    };
    let uuid = 0;
    const create = () => createServerModCatalog({ transport, resumeStore, sha256: webSha256,
        now: () => 0, sleep: async () => {}, randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` });
    const abort = new AbortController();
    const first = create();
    await assert.rejects(first.uploadServerMod(serverId, revision, archive, progress => {
        if (progress.sentBytes === MOD_UPLOAD_CHUNK_BYTES) abort.abort();
    }, { signal: abort.signal }), { code: "upload_paused" });
    assert.equal(cached.get(serverId)?.sentBytes, MOD_UPLOAD_CHUNK_BYTES);
    const completeRequestId = cached.get(serverId)?.completeRequestId;
    const resumed = create();
    assert.deepEqual(await resumed.resumeServerModUpload!(serverId), installed);
    assert.deepEqual(indices, [0, 1]);
    assert.deepEqual(reads, [[0, MOD_UPLOAD_CHUNK_BYTES], [MOD_UPLOAD_CHUNK_BYTES, 5]]);
    assert.equal(requests.filter(request => request.route === "uploads").length, 1);
    assert.equal(requests.find(request => request.route === "complete")?.body.requestId, completeRequestId);
    assert.equal(cached.size, 0);
});
