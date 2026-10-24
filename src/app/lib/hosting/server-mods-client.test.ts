import assert from "node:assert/strict";
import test from "node:test";
import { MOD_UPLOAD_CHUNK_BYTES, type ModsRequest } from "../../../../supabase/functions/_shared/server-mods-contract";
import { ServerModsError, type ServerModArchive, type ServerModsState, type ServerModUploadProgress } from "./server-mods";
import { createServerModCatalog, MODS_RETRY_WINDOW_MILLISECONDS, type ServerModsCallResult, type ServerModsTransport } from "./server-mods-client";
import { webSha256 } from "./server-mods-transport";

const SERVER_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const REVISION = "a".repeat(64);
const NEXT_REVISION = "b".repeat(64);

type Sent = { route: string; body: Record<string, unknown>; refreshSession: boolean };
type SentChunk = { index: number; sha256: string; length: number; refreshSession: boolean };
type Reply = ServerModsCallResult<unknown>;

/** A failure reply. */
function refused(code: string, retryable = false, modId: string | null = null, issue?: string): Reply {
    return { ok: false, error: issue === undefined ? { code, retryable, modId } : { code, retryable, modId, issue } };
}

/** A success reply. */
function ok(result: unknown): Reply {
    return { ok: true, result };
}

/** A list carrying one owner mod with the given digest. */
function state(sha256: string | null = null, revision = NEXT_REVISION): ServerModsState {
    return { revision, restartRequired: true, mods: [
        { id: "Native", name: "Native", version: "", enabled: true, pinned: true, required: false, sizeBytes: 0, sha256: null, dependsOn: [], issues: [] },
        ...(sha256 === null ? [] : [{ id: "SomeMod", name: "Some Mod", version: "v1.2.0", enabled: true, pinned: false, required: false, sizeBytes: 5, sha256, dependsOn: [], issues: [] }]),
    ] };
}

/**
 * Builds a catalog over a scripted transport and a virtual clock. `routes` answers JSON routes by name in
 * order (the last answer repeats); `chunks` answers chunk puts in order (default success).
 */
function harness(routes: Record<string, Reply[]>, chunks: Reply[] = []) {
    const sent: Sent[] = [];
    const sentChunks: SentChunk[] = [];
    const sleeps: number[] = [];
    let clock = 0;
    let uuid = 0;
    const answer = (queue: Reply[] | undefined): Reply => (queue && queue.length > 1 ? queue.shift()! : queue?.[0]) ?? refused("unexpected");
    const transport: ServerModsTransport = {
        async send(_serverId, request: ModsRequest, { refreshSession }) {
            sent.push({ route: request.route, body: structuredClone(request.body) as Record<string, unknown>, refreshSession });
            return answer(routes[request.route]);
        },
        async putChunk(_serverId, chunk, { refreshSession }) {
            sentChunks.push({ index: chunk.index, sha256: chunk.sha256, length: chunk.bytes.byteLength, refreshSession });
            return (chunks.length > 0 ? chunks.shift()! : ok({ receivedChunks: chunk.index + 1, receivedBytes: 0 })) as ServerModsCallResult<never>;
        },
    };
    const catalog = createServerModCatalog({
        transport,
        sha256: webSha256,
        randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
        sleep: async (milliseconds) => { sleeps.push(milliseconds); clock += milliseconds; },
        now: () => clock,
    });
    return { catalog, sent, sentChunks, sleeps, elapsed: () => clock };
}

/** An archive of `length` bytes. */
function archive(length: number): ServerModArchive {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 4_099) bytes[index] = index % 251;
    return { manifest: { id: "SomeMod", name: "Some Mod", version: "v1.2.0" }, bytes, fileCount: 2, uncompressedBytes: length * 2 };
}

/** The session result for an archive. */
function session(chunkCount: number) {
    return ok({ uploadId: UPLOAD_ID, chunkBytes: MOD_UPLOAD_CHUNK_BYTES, chunkCount, expiresAt: "2026-10-19T13:00:00.000Z", replaces: false });
}

/** Rejects with a ServerModsError of this code. */
async function rejectsWith(promise: Promise<unknown>, code: string, detail?: string | null) {
    await assert.rejects(promise, (error: unknown) => error instanceof ServerModsError && error.code === code && (detail === undefined || error.detail === detail));
}

test("lists and saves the complete load order under one request ID", async () => {
    const { catalog, sent } = harness({ list: [ok(state())], "load-order": [ok(state())] });
    assert.deepEqual(await catalog.listServerMods(SERVER_ID), state());
    const order = [{ id: "Native", enabled: true }, { id: "SomeMod", enabled: false }];
    assert.deepEqual(await catalog.saveServerModOrder(SERVER_ID, REVISION, order), state());
    assert.deepEqual(sent[1], { route: "load-order", refreshSession: false, body: { requestId: "00000000-0000-4000-8000-000000000001", serverId: SERVER_ID, expectedRevision: REVISION, mods: order } });
});

for (const accepted of [true, false]) {
    test(`keeps upload unknown when ${accepted ? "accepted" : "uncertain"} completion is followed by a suspended reconciliation read`, async () => {
        const { catalog, sent } = harness({
            uploads: [session(1)],
            complete: [accepted ? ok({}) : refused("network_unavailable", true)],
            status: [refused("server_suspended")],
            list: [refused("server_suspended")],
        });
        await rejectsWith(catalog.uploadServerMod(SERVER_ID, REVISION, archive(5)), "upload_status_unavailable");
        assert.equal(sent.filter(call => call.route === "uploads").length, 1);
        assert.equal(sent.filter(call => call.route === "list").length, 1);
    });
}

test("retries rate limits and busy refusals with backoff, resending the identical request", async () => {
    const { catalog, sent, sleeps } = harness({ delete: [refused("rate_limited", true), refused("busy", true), refused("mods_unavailable", true), ok(state())] });
    await catalog.deleteServerMod(SERVER_ID, REVISION, "SomeMod");
    assert.equal(sent.length, 4);
    assert.ok(sent.every(call => JSON.stringify(call.body) === JSON.stringify(sent[0].body)));
    assert.deepEqual(sleeps, [1_000, 2_000, 4_000]);
});

test("stops at a stale revision, a refusal, or the end of the retry window", async () => {
    const stale = harness({ "load-order": [refused("revision_conflict")] });
    await rejectsWith(stale.catalog.saveServerModOrder(SERVER_ID, REVISION, []), "revision_conflict");
    assert.equal(stale.sent.length, 1);

    const dependency = harness({ delete: [refused("mod_dependency_unsatisfied", false, "Dependent.Mod")] });
    await assert.rejects(dependency.catalog.deleteServerMod(SERVER_ID, REVISION, "SomeMod"),
        (error: unknown) => error instanceof ServerModsError && error.code === "mod_dependency_unsatisfied" && error.modId === "Dependent.Mod" && error.detail === null);

    const missing = harness({ "load-order": [refused("mod_order_invalid", false, "Fae", "submodule-class-missing:Fae.SubModule")] });
    await assert.rejects(missing.catalog.saveServerModOrder(SERVER_ID, REVISION, []),
        (error: unknown) => error instanceof ServerModsError && error.modId === "Fae" && error.detail === "submodule-class-missing:Fae.SubModule");

    const unavailable = harness({ "load-order": [refused("mods_unavailable", true)] });
    await rejectsWith(unavailable.catalog.saveServerModOrder(SERVER_ID, REVISION, []), "mods_unavailable");
    assert.ok(unavailable.elapsed() >= MODS_RETRY_WINDOW_MILLISECONDS, "retries for at least the whole window");

    const list = harness({ list: [refused("mods_unavailable", true)] });
    await rejectsWith(list.catalog.listServerMods(SERVER_ID), "mods_unavailable");
    assert.ok(list.elapsed() < MODS_RETRY_WINDOW_MILLISECONDS, "a plain list gives up sooner");
});

test("refreshes the session once after a 401 and stops at a second", async () => {
    const once = harness({ list: [refused("unauthenticated"), ok(state())] });
    await once.catalog.listServerMods(SERVER_ID);
    assert.deepEqual(once.sent.map(call => call.refreshSession), [false, true]);
    const twice = harness({ list: [refused("unauthenticated"), refused("unauthenticated")] });
    await rejectsWith(twice.catalog.listServerMods(SERVER_ID), "unauthenticated");
    assert.equal(twice.sent.length, 2);
});

test("uploads chunks in order with their digests, completes, polls gently and returns the installed list", async () => {
    const upload = archive(MOD_UPLOAD_CHUNK_BYTES + 5);
    const sha256 = await webSha256(upload.bytes);
    const installed = state(sha256);
    const { catalog, sent, sentChunks, sleeps } = harness({
        uploads: [session(2)],
        complete: [ok({ uploadId: UPLOAD_ID, status: "validating" })],
        status: [ok({ uploadId: UPLOAD_ID, status: "validating" }), ok({ uploadId: UPLOAD_ID, status: "installing" }), ok({ uploadId: UPLOAD_ID, status: "installed", state: installed })],
    });
    const progress: ServerModUploadProgress[] = [];
    assert.deepEqual(await catalog.uploadServerMod(SERVER_ID, REVISION, upload, (event) => progress.push(event)), installed);
    assert.deepEqual(sent[0].body, { requestId: "00000000-0000-4000-8000-000000000001", serverId: SERVER_ID, expectedRevision: REVISION,
        manifest: upload.manifest, totalBytes: MOD_UPLOAD_CHUNK_BYTES + 5, sha256 });
    assert.deepEqual(sentChunks.map(({ index, length }) => [index, length]), [[0, MOD_UPLOAD_CHUNK_BYTES], [1, 5]]);
    assert.equal(sentChunks[1].sha256, await webSha256(upload.bytes.slice(MOD_UPLOAD_CHUNK_BYTES)));
    assert.deepEqual(sent[1].body, { requestId: "00000000-0000-4000-8000-000000000002", uploadId: UPLOAD_ID, expectedRevision: REVISION });
    assert.deepEqual(sent.slice(2).map(call => call.route), ["status", "status", "status"]);
    assert.ok(sleeps.every(delay => delay >= 2_000), "status is never polled faster than every two seconds");
    assert.deepEqual(progress.map(event => event.phase), ["creating", "uploading", "uploading", "installing", "verifying"]);
    assert.deepEqual(progress[1], { phase: "uploading", sentBytes: MOD_UPLOAD_CHUNK_BYTES, totalBytes: MOD_UPLOAD_CHUNK_BYTES + 5 });
});

test("resends the same chunk index and digest after a retryable failure", async () => {
    const upload = archive(MOD_UPLOAD_CHUNK_BYTES + 5);
    const { catalog, sentChunks } = harness({
        uploads: [session(2)], complete: [ok({ uploadId: UPLOAD_ID, status: "validating" })],
        status: [ok({ uploadId: UPLOAD_ID, status: "installed", state: state(await webSha256(upload.bytes)) })],
    }, [ok({ receivedChunks: 1, receivedBytes: MOD_UPLOAD_CHUNK_BYTES }), refused("mods_unavailable", true), refused("rate_limited", true), refused("unauthenticated")]);
    await catalog.uploadServerMod(SERVER_ID, REVISION, upload);
    assert.deepEqual(sentChunks.map(({ index, refreshSession }) => [index, refreshSession]), [[0, false], [1, false], [1, false], [1, false], [1, true]]);
    assert.equal(new Set(sentChunks.slice(1).map(chunk => chunk.sha256)).size, 1);
});

test("fails an upload whose chunk is refused or whose session ends", async () => {
    for (const code of ["upload_chunk_conflict", "mod_storage_quota_exceeded", "upload_expired", "upload_not_found"]) {
        const { catalog, sent } = harness({ uploads: [session(1)] }, [refused(code)]);
        await rejectsWith(catalog.uploadServerMod(SERVER_ID, REVISION, archive(5)), code);
        assert.deepEqual(sent.map(call => call.route), ["uploads"]);
    }
    const busy = harness({ uploads: [refused("upload_busy")] });
    await rejectsWith(busy.catalog.uploadServerMod(SERVER_ID, REVISION, archive(5)), "upload_busy");
    assert.equal(busy.sent.length, 1);
});

test("reports each terminal refusal of an install", async () => {
    const cases: [Reply, string, string | null][] = [
        [ok({ uploadId: UPLOAD_ID, status: "rejected", error: "mod_submodule_invalid" }), "upload_rejected", "mod_submodule_invalid"],
        [ok({ uploadId: UPLOAD_ID, status: "failed" }), "upload_failed", null],
        [ok({ uploadId: UPLOAD_ID, status: "expired" }), "upload_expired", null],
    ];
    for (const [status, code, detail] of cases) {
        const { catalog } = harness({ uploads: [session(1)], complete: [ok({ uploadId: UPLOAD_ID, status: "validating" })], status: [status] });
        await rejectsWith(catalog.uploadServerMod(SERVER_ID, REVISION, archive(5)), code, detail);
    }
});

test("reconciles unconfirmed, unknown, forgotten and timed-out installs through list", async () => {
    const upload = archive(5);
    const sha256 = await webSha256(upload.bytes);
    const statuses: Reply[] = [
        ok({ uploadId: UPLOAD_ID, status: "unconfirmed" }),
        ok({ uploadId: UPLOAD_ID, status: "quarantined" }),
        refused("upload_not_found"),
    ];
    for (const status of statuses) {
        const present = harness({ uploads: [session(1)], complete: [ok({ uploadId: UPLOAD_ID, status: "validating" })], status: [status], list: [ok(state(sha256))] });
        assert.deepEqual(await present.catalog.uploadServerMod(SERVER_ID, REVISION, upload), state(sha256));
        assert.equal(present.sent.at(-1)?.route, "list");
        const absent = harness({ uploads: [session(1)], complete: [ok({ uploadId: UPLOAD_ID, status: "validating" })], status: [status], list: [ok(state("c".repeat(64)))] });
        await rejectsWith(absent.catalog.uploadServerMod(SERVER_ID, REVISION, upload), "upload_unconfirmed");
    }
    const stuck = harness({ uploads: [session(1)], complete: [ok({ uploadId: UPLOAD_ID, status: "validating" })], status: [ok({ uploadId: UPLOAD_ID, status: "installing" })], list: [ok(state(sha256))] });
    assert.deepEqual(await stuck.catalog.uploadServerMod(SERVER_ID, REVISION, upload), state(sha256));
    assert.ok(stuck.elapsed() >= 12 * 60_000);
    const lostCompletion = harness({ uploads: [session(1)], complete: [refused("control_plane_unavailable", true)], list: [ok(state(sha256))] });
    assert.deepEqual(await lostCompletion.catalog.uploadServerMod(SERVER_ID, REVISION, upload), state(sha256));
    assert.ok(lostCompletion.sent.filter(call => call.route === "complete").every((call, _, all) => call.body.requestId === all[0].body.requestId));
});

test("keeps polling through retryable status failures", async () => {
    const upload = archive(5);
    const { catalog, sent } = harness({ uploads: [session(1)], complete: [ok({ uploadId: UPLOAD_ID, status: "validating" })],
        status: [refused("rate_limited", true), refused("mods_unavailable", true), ok({ uploadId: UPLOAD_ID, status: "installed", state: state(await webSha256(upload.bytes)) })] });
    await catalog.uploadServerMod(SERVER_ID, REVISION, upload);
    assert.equal(sent.filter(call => call.route === "status").length, 3);
});

test("fails closed when mods are unavailable for the server", async () => {
    const { catalog } = harness({ uploads: [refused("mods_unavailable", false)] });
    await rejectsWith(catalog.uploadServerMod(SERVER_ID, REVISION, archive(5)), "mods_unavailable");
});
