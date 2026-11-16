import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { browserModResumeStore, createPreparedModArchiveWriter, discardPreparedModArchive, prunePreparedModArchives } from "./server-mod-upload-cache";
import { MOD_UPLOAD_CHUNK_BYTES } from "../../../../supabase/functions/_shared/server-mods-contract";

Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
const details = { manifest: { id: "SomeMod", name: "Some Mod", version: "v1" }, fileCount: 2, uncompressedBytes: 1 };
const serverId = "11111111-1111-4111-8111-111111111111";

test("prepared archives preserve a rolling digest and exact bounded parts across IndexedDB resume", async () => {
    const writer = createPreparedModArchiveWriter();
    const first = new Uint8Array(MOD_UPLOAD_CHUNK_BYTES).fill(17);
    const last = new Uint8Array([3, 2, 1]);
    await writer.append(first);
    await writer.append(last);
    const archive = await writer.finish({ ...details, uncompressedBytes: first.byteLength + last.byteLength });
    try {
        const source = archive.source!;
        assert.equal(source.sizeBytes, first.byteLength + last.byteLength);
        assert.equal(source.sha256, createHash("sha256").update(first).update(last).digest("hex"));
        assert.deepEqual(await source.read(MOD_UPLOAD_CHUNK_BYTES - 2, 5), new Uint8Array([17, 17, 3, 2, 1]));
        await assert.rejects(source.read(0, MOD_UPLOAD_CHUNK_BYTES + 1), { code: "invalid_request" });
        await browserModResumeStore.save({ serverId, archive, expectedRevision: "a".repeat(64),
            createRequestId: randomUUID(), completeRequestId: randomUUID(), sentBytes: first.byteLength, completionStarted: false });
        const resumed = await browserModResumeStore.get(serverId);
        assert.equal(resumed?.archive.source?.id, source.id);
        assert.equal(resumed?.sentBytes, first.byteLength);
        assert.equal(resumed?.completionStarted, false);
        assert.deepEqual(await resumed!.archive.source!.read(MOD_UPLOAD_CHUNK_BYTES, 3), last);
        await browserModResumeStore.clear(serverId);
        assert.equal(await browserModResumeStore.get(serverId), null);
        await assert.rejects(source.read(0, 1), { code: "browser_storage_unavailable" });
    } finally { await discardPreparedModArchive(archive.source!.id); }
});

test("concurrent preparations cannot exceed eight cached archives and abort releases their capacity", async () => {
    const writers = Array.from({ length: 9 }, () => createPreparedModArchiveWriter());
    try {
        const results = await Promise.allSettled(writers.map(writer => writer.append(new Uint8Array([1]))));
        assert.equal(results.filter(result => result.status === "fulfilled").length, 8);
        assert.equal(results.filter(result => result.status === "rejected").length, 1);
        await assert.rejects(prunePreparedModArchives(), { code: "browser_storage_unavailable" });
    } finally { for (const writer of writers) await writer.abort(); }
    await prunePreparedModArchives();
});

test("eight-hour retention removes a prepared archive and its resume record", async () => {
    const writer = createPreparedModArchiveWriter();
    await writer.append(new Uint8Array([1, 2]));
    const archive = await writer.finish(details);
    await browserModResumeStore.save({ serverId, archive, expectedRevision: "a".repeat(64),
        createRequestId: randomUUID(), completeRequestId: randomUUID() });
    const originalNow = Date.now;
    const later = originalNow() + 8 * 60 * 60_000 + 1;
    Date.now = () => later;
    try {
        assert.equal(await browserModResumeStore.get(serverId), null);
        await assert.rejects(archive.source!.read(0, 1), { code: "browser_storage_unavailable" });
    } finally { Date.now = originalNow; await browserModResumeStore.clear(serverId); }
});
