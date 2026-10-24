import assert from "node:assert/strict";
import test from "node:test";
import {
    MOD_UPLOAD_CHUNK_BYTES,
    isModMutationRoute,
    isOwnerModId,
    modChunkCount,
    modChunkLength,
    modIdFromErrorMessage,
    parseModChunkDigest,
    parseModChunkQuery,
    parseModChunkReceipt,
    parseModsRequest,
    parseModsResult,
    parseModsState,
    parseModUploadAccepted,
    parseModUploadSession,
    parseModUploadStatus,
} from "./server-mods-contract.ts";

const SERVER = "22222222-2222-4222-8222-222222222222";
const REQUEST = "11111111-1111-4111-8111-111111111111";
const UPLOAD = "33333333-3333-4333-8333-333333333333";
const REVISION = "a".repeat(64);

/** Builds one API mod entry with optional overrides. */
function entry(overrides: Record<string, unknown> = {}) {
    return { id: "SomeMod", name: "Some Mod", version: "v1.2.0", enabled: true, pinned: false, required: false,
        sizeBytes: 1_234, sha256: "b".repeat(64), dependsOn: ["Native"], issues: ["stripped:0Harmony.dll"], ...overrides };
}

/** Builds a minimal valid mod list. */
function state(mods: unknown[] = [entry()]) {
    return { revision: REVISION, restartRequired: false, mods: [
        entry({ id: "Native", name: "Native", version: "", pinned: true, sizeBytes: 0, sha256: null, dependsOn: [], issues: [] }),
        ...mods,
    ] };
}

test("accepts each route's exact body and rejects unknown fields and bad identities", () => {
    assert.deepEqual(parseModsRequest("list", { serverId: SERVER }), { route: "list", body: { serverId: SERVER } });
    assert.throws(() => parseModsRequest("list", { serverId: SERVER, actor: "someone" }));
    assert.throws(() => parseModsRequest("list", { serverId: "../../etc" }));
    const order = { requestId: REQUEST, serverId: SERVER, expectedRevision: REVISION, mods: [{ id: "Native", enabled: true }, { id: "SomeMod", enabled: false }] };
    assert.deepEqual(parseModsRequest("load-order", order).body, order);
    assert.throws(() => parseModsRequest("load-order", { ...order, mods: [{ id: "a", enabled: true }, { id: "A", enabled: true }] }));
    assert.throws(() => parseModsRequest("load-order", { ...order, mods: [{ id: "a/b", enabled: true }] }));
    assert.throws(() => parseModsRequest("load-order", { ...order, expectedRevision: "A".repeat(64) }));
    assert.throws(() => parseModsRequest("load-order", { ...order, mods: Array.from({ length: 134 }, (_, index) => ({ id: `m${index}`, enabled: true })) }));
    const upload = { requestId: REQUEST, serverId: SERVER, expectedRevision: REVISION, manifest: { id: "SomeMod", name: "Some Mod", version: "v1.2.0" }, totalBytes: 10, sha256: "C".repeat(64) };
    assert.equal((parseModsRequest("uploads", upload).body as { sha256: string }).sha256, "c".repeat(64));
    for (const invalid of [{ ...upload, totalBytes: 0 }, { ...upload, totalBytes: 100 * 1_048_576 + 1 }, { ...upload, sha256: "x" },
        { ...upload, manifest: { id: "SomeMod", name: " padded", version: "v1" } }, { ...upload, manifest: { id: "SomeMod", name: "Mod", version: "1 0" } }]) {
        assert.throws(() => parseModsRequest("uploads", invalid));
    }
    assert.throws(() => parseModsRequest("complete", { requestId: REQUEST, uploadId: UPLOAD, expectedRevision: REVISION, serverId: SERVER }));
    assert.doesNotThrow(() => parseModsRequest("complete", { requestId: REQUEST, uploadId: UPLOAD, expectedRevision: REVISION }));
    assert.doesNotThrow(() => parseModsRequest("status", { serverId: SERVER, uploadId: UPLOAD }));
    assert.doesNotThrow(() => parseModsRequest("delete", { requestId: REQUEST, serverId: SERVER, expectedRevision: REVISION, modId: "SomeMod" }));
    assert.throws(() => parseModsRequest("delete", { requestId: "not-a-uuid", serverId: SERVER, expectedRevision: REVISION, modId: "SomeMod" }));
    assert.deepEqual(["list", "load-order", "uploads", "complete", "status", "delete"].map((route) => isModMutationRoute(route as never)),
        [false, true, true, true, false, true]);
});

test("bounds chunk queries and digests and computes chunk geometry", () => {
    assert.deepEqual(parseModChunkQuery(UPLOAD, "12"), { uploadId: UPLOAD, index: 12 });
    for (const index of ["13", "01", "-1", "1.0", "", undefined]) assert.throws(() => parseModChunkQuery(UPLOAD, index));
    assert.throws(() => parseModChunkQuery("upload", "0"));
    assert.equal(parseModChunkDigest("F".repeat(64)), "f".repeat(64));
    assert.throws(() => parseModChunkDigest("f".repeat(63)));
    assert.equal(modChunkCount(MOD_UPLOAD_CHUNK_BYTES + 1), 2);
    assert.equal(modChunkLength(MOD_UPLOAD_CHUNK_BYTES + 1, 0), MOD_UPLOAD_CHUNK_BYTES);
    assert.equal(modChunkLength(MOD_UPLOAD_CHUNK_BYTES + 1, 1), 1);
    assert.equal(modChunkLength(MOD_UPLOAD_CHUNK_BYTES + 1, 2), 0);
});

test("validates mod lists strictly", () => {
    assert.equal(parseModsState(state()).mods.length, 2);
    assert.throws(() => parseModsState({ ...state(), extra: true }));
    assert.throws(() => parseModsState(state([entry({ pinned: true, required: true })])));
    assert.throws(() => parseModsState(state([entry({ id: "native" })])));
    assert.throws(() => parseModsState(state([entry({ sha256: "B".repeat(64) })])));
    assert.throws(() => parseModsState(state([entry({ issues: ["<script>"] })])));
    assert.throws(() => parseModsState(state([entry({ name: "line\nbreak" })])));
    assert.throws(() => parseModsState({ ...state(), mods: [] }));
    assert.doesNotThrow(() => parseModsState(state([entry({ issues: ["image-module-not-loaded:StoryMode", "future-issue"] })])));
});

test("accepts entries with or without the players-only pair, but never half of it", () => {
    assert.equal(parseModsState(state()).mods[1].runsOn, undefined);
    assert.equal(Object.hasOwn(parseModsState(state()).mods[1], "runsOnLocked"), false);
    const players = parseModsState(state([entry({ runsOn: "players", runsOnLocked: false })])).mods[1];
    assert.deepEqual([players.runsOn, players.runsOnLocked], ["players", false]);
    const harmony = parseModsState(state([entry({ id: "Bannerlord.Harmony", runsOn: "players", runsOnLocked: true })])).mods[1];
    assert.deepEqual([harmony.runsOn, harmony.runsOnLocked], ["players", true]);
    for (const invalid of [{ runsOn: "server" }, { runsOnLocked: false }, { runsOn: "both", runsOnLocked: false }, { runsOn: "server", runsOnLocked: "no" },
        { runsOn: null, runsOnLocked: false }, { runsOn: "server", runsOnLocked: false, runsOnReason: "x" }]) {
        assert.throws(() => parseModsState(state([entry(invalid)])), Error, JSON.stringify(invalid));
    }
    assert.doesNotThrow(() => parseModsState(state([entry({ issues: ["no-server-submodule", "no-render-tag-removed", "headless-server-unsupported", "dedicated-server-tag-removed"] })])));
    assert.doesNotThrow(() => parseModsState(state([entry({ runsOn: "players", runsOnLocked: false, issues: ["submodule-class-missing:FamilyAppearanceEditor.SubModule+Inner"] })])));
    assert.doesNotThrow(() => parseModsState(state([entry({ runsOn: "players", runsOnLocked: false, issues: ["submodule-dll-missing:My Mod.Core.dll"] })])));
});

test("accepts a load-order entry's runsOn only when it is a known value", () => {
    const order = (mods: unknown[]) => ({ requestId: REQUEST, serverId: SERVER, expectedRevision: REVISION, mods });
    const changed = order([{ id: "Native", enabled: true }, { id: "SomeMod", enabled: true, runsOn: "players" }]);
    assert.deepEqual(parseModsRequest("load-order", changed).body, changed);
    assert.equal(Object.hasOwn((parseModsRequest("load-order", order([{ id: "SomeMod", enabled: true }])).body as { mods: object[] }).mods[0], "runsOn"), false);
    for (const runsOn of ["both", "", null, true]) assert.throws(() => parseModsRequest("load-order", order([{ id: "SomeMod", enabled: true, runsOn }])));
    assert.throws(() => parseModsRequest("load-order", order([{ id: "SomeMod", enabled: true, runsOnLocked: false }])));
});

test("validates upload results against the request that produced them", () => {
    const session = { uploadId: UPLOAD, chunkBytes: MOD_UPLOAD_CHUNK_BYTES, chunkCount: 2, expiresAt: "2026-10-19T12:00:00.000Z", replaces: false };
    assert.deepEqual(parseModUploadSession(session, MOD_UPLOAD_CHUNK_BYTES + 5), session);
    assert.throws(() => parseModUploadSession(session, 5));
    assert.throws(() => parseModUploadSession({ ...session, chunkBytes: 1_024 }));
    assert.deepEqual(parseModChunkReceipt({ receivedChunks: 1, receivedBytes: 5 }), { receivedChunks: 1, receivedBytes: 5 });
    assert.throws(() => parseModChunkReceipt({ receivedChunks: 99, receivedBytes: 5 }));
    assert.deepEqual(parseModUploadAccepted({ uploadId: UPLOAD, status: "validating" }, UPLOAD), { uploadId: UPLOAD, status: "validating" });
    assert.throws(() => parseModUploadAccepted({ uploadId: UPLOAD, status: "receiving" }));
    assert.throws(() => parseModUploadAccepted({ uploadId: REQUEST, status: "validating" }, UPLOAD));
    assert.deepEqual(parseModUploadStatus({ uploadId: UPLOAD, status: "rejected", error: "mod_archive_invalid" }), { uploadId: UPLOAD, status: "rejected", error: "mod_archive_invalid" });
    assert.equal(parseModUploadStatus({ uploadId: UPLOAD, status: "installed", state: state() }).status, "installed");
    assert.deepEqual(parseModUploadStatus({ uploadId: UPLOAD, status: "quarantined" }), { uploadId: UPLOAD, status: "quarantined" });
    assert.throws(() => parseModUploadStatus({ uploadId: UPLOAD, status: "installed" }));
    assert.throws(() => parseModUploadStatus({ uploadId: UPLOAD, status: "failed", error: "x" }));
    const request = parseModsRequest("status", { serverId: SERVER, uploadId: UPLOAD });
    assert.throws(() => parseModsResult("status", { uploadId: REQUEST, status: "failed" }, request));
});

test("recognizes reserved ids and reads the module named in typed error messages", () => {
    for (const id of ["Native", "coop", "CoopNightly", "DedicatedServer.Linux", "dedicatedserver.Other", "..", "StoryMode"]) assert.equal(isOwnerModId(id), false);
    assert.equal(isOwnerModId("Bannerlord.ButterLib"), true);
    assert.equal(modIdFromErrorMessage("The requested module order is invalid. Module: Bannerlord.Harmony."), "Bannerlord.Harmony");
    assert.equal(modIdFromErrorMessage("The requested module order is invalid."), null);
    assert.equal(modIdFromErrorMessage("The requested module order is invalid. Module: FamilyAppearanceEditor. Issue: submodule-class-missing:FamilyAppearanceEditor.SubModule."), "FamilyAppearanceEditor");
    assert.equal(modIdFromErrorMessage("The requested module order is invalid. Module: Some.Mod. Issue: <script>."), null);
});
