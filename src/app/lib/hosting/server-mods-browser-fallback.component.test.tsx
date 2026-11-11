import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { MOD_UPLOAD_CHUNK_BYTES } from "../../../../supabase/functions/_shared/server-mods-contract";
import { buildResumableModArchive, type ModFolderFile } from "./server-mod-archive";
import { createBrowserServerModCatalog, webSha256 } from "./server-mods-transport";

const SERVER_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "22222222-2222-4222-8222-222222222222";
const REVISION = "a".repeat(64);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function folder(): ModFolderFile[] {
    const entries: [string, Uint8Array<ArrayBuffer>][] = [
        ["SmallMod/SubModule.xml", new TextEncoder().encode('<Module><Id value="SmallMod"/><Name value="Small Mod"/><Version value="v1"/></Module>')],
        ["SmallMod/payload.bin", Uint8Array.from({ length: 1024 }, (_, index) => index % 251)],
    ];
    return entries.map(([path, bytes]) => ({ webkitRelativePath: path, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer }));
}

for (const storage of ["absent", "open throws"] as const) {
    const condition = storage === "absent" ? "IndexedDB is absent" : "IndexedDB.open throws";
    it(`uploads a small folder through the production browser catalog when ${condition}`, async () => {
        vi.stubGlobal("crypto", webcrypto);
        vi.stubGlobal("indexedDB", storage === "absent" ? undefined : { open: vi.fn(() => { throw new DOMException("Storage denied", "SecurityError"); }) });
        const archive = await buildResumableModArchive(folder());
        expect(archive.source).toBeUndefined();
        expect(archive.bytes.byteLength).toBeGreaterThan(0);
        const createId = "33333333-3333-4333-8333-333333333333";
        const completeId = "44444444-4444-4444-8444-444444444444";
        vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(createId).mockReturnValueOnce(completeId);
        const digest = await webSha256(archive.bytes);
        const installed = { revision: "b".repeat(64), restartRequired: false, mods: [{ ...archive.manifest, enabled: true, pinned: false, required: false,
            sizeBytes: archive.uncompressedBytes, sha256: digest, dependsOn: [], issues: [] }] };
        const requests: string[] = [];
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(init?.cache).toBe("no-store");
            expect(init?.credentials).toBe("same-origin");
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            const url = String(input);
            requests.push(url);
            const expected = [
                `/api/servers/${SERVER_ID}/mods?route=uploads`,
                `/api/servers/${SERVER_ID}/mods/chunk?uploadId=${UPLOAD_ID}&index=0`,
                `/api/servers/${SERVER_ID}/mods?route=complete`,
                `/api/servers/${SERVER_ID}/mods?route=status`,
            ];
            expect(url).toBe(expected[requests.length - 1]);
            if (requests.length === 2) {
                expect(init?.method).toBe("PUT");
                expect(init?.headers).toEqual({ "content-type": "application/octet-stream", "x-chunk-sha256": digest });
                expect(init?.body).toEqual(archive.bytes);
                return Response.json({ ok: true, result: { receivedChunks: 1, receivedBytes: archive.bytes.byteLength } });
            }
            expect(init?.method).toBe("POST");
            expect(init?.headers).toEqual({ "content-type": "application/json" });
            const body = JSON.parse(init?.body as string);
            if (requests.length === 1) {
                expect(body).toEqual({ requestId: createId, serverId: SERVER_ID, expectedRevision: REVISION,
                    manifest: archive.manifest, totalBytes: archive.bytes.byteLength, uncompressedBytes: archive.uncompressedBytes, sha256: digest });
                return Response.json({ ok: true, result: { uploadId: UPLOAD_ID, chunkCount: 1, chunkBytes: MOD_UPLOAD_CHUNK_BYTES,
                    expiresAt: "2026-11-12T00:00:00.000Z", replaces: false } });
            }
            if (requests.length === 3) {
                expect(body).toEqual({ requestId: completeId, uploadId: UPLOAD_ID, expectedRevision: REVISION });
                return Response.json({ ok: true, result: { uploadId: UPLOAD_ID, status: "validating" } });
            }
            expect(body).toEqual({ serverId: SERVER_ID, uploadId: UPLOAD_ID });
            return Response.json({ ok: true, result: { uploadId: UPLOAD_ID, status: "installed", state: installed } });
        });
        vi.stubGlobal("fetch", fetchMock);
        const catalog = createBrowserServerModCatalog();
        await expect(catalog.pendingServerModUpload!(SERVER_ID)).resolves.toBeNull();
        await expect(catalog.uploadServerMod(SERVER_ID, REVISION, archive)).resolves.toEqual(installed);
        expect(fetchMock).toHaveBeenCalledTimes(4);
        await expect(catalog.pendingServerModUpload!(SERVER_ID)).resolves.toBeNull();
    });

    it(`refuses a large folder before reading its payload when ${condition}`, async () => {
        vi.stubGlobal("indexedDB", storage === "absent" ? undefined : { open: vi.fn(() => { throw new DOMException("Storage denied", "SecurityError"); }) });
        const payload = vi.fn(async (): Promise<ArrayBuffer> => { throw new Error("Must not read a large in-memory payload"); });
        await expect(buildResumableModArchive([...folder(), { webkitRelativePath: "SmallMod/large.bin", size: 101 * 1_048_576,
            arrayBuffer: payload }])).rejects.toMatchObject({ problem: "browser-storage" });
        expect(payload).not.toHaveBeenCalled();
    });
}
