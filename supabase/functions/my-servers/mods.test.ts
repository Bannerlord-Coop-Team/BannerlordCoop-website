import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../_shared/my-servers.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SERVER_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const REVISION = "a".repeat(64);
const TOKEN = "access-token-with-enough-characters";
const ORIGIN = "https://bannerlordcoop.com";
const MIB = 1_048_576;

type Call = { url: string; method: string; headers: Headers; body: Uint8Array };

/** Builds the handler with a recording upstream that answers with `reply`. */
function handlerWith(reply: (call: Call) => Response | Promise<Response>, options: { modsChunkTimeoutMilliseconds?: number } = {}) {
    const calls: Call[] = [];
    const handler = createMyServersHandler({
        allowedOrigins: [ORIGIN],
        controlPlaneUrl: "https://control-plane.example.test",
        waitUntil: () => {},
        ...options,
        fetchImplementation: async (input, init) => {
            const request = new Request(input, init);
            const call = { url: request.url, method: request.method, headers: request.headers, body: new Uint8Array(await request.arrayBuffer()) };
            calls.push(call);
            return reply(call);
        },
    });
    return { handler, calls };
}

/** A browser-side JSON mods request through the Edge Function. */
function modsRequest(route: string, body: unknown, options: { requestId?: string | null; query?: string; method?: string; contentType?: string } = {}) {
    const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, "content-type": options.contentType ?? "application/json" };
    if (options.requestId !== null) headers["x-request-id"] = options.requestId ?? REQUEST_ID;
    return new Request(`https://function.example.test/?${options.query ?? `resource=mods&route=${route}`}`, {
        method: options.method ?? "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

/** A browser-side chunk PUT through the Edge Function. */
function chunkRequest(bytes: Uint8Array | ReadableStream<Uint8Array>, options: { query?: string; digest?: string | null; method?: string; contentType?: string; contentLength?: string } = {}) {
    const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, "content-type": options.contentType ?? "application/octet-stream", "x-request-id": REQUEST_ID };
    if (options.digest !== null) headers["x-chunk-sha256"] = options.digest ?? "C".repeat(64);
    if (options.contentLength !== undefined) headers["content-length"] = options.contentLength;
    return new Request(`https://function.example.test/?${options.query ?? `resource=mod-chunk&uploadId=${UPLOAD_ID}&index=1`}`, {
        method: options.method ?? "PUT", headers, body: bytes, ...(bytes instanceof ReadableStream ? { duplex: "half" } : {}),
    } as RequestInit);
}

/** The adapter's success shape: no version, the echoed request ID and the result. */
function adapterSuccess(result: unknown, status = 200, requestId = REQUEST_ID) {
    return Response.json({ ok: true, requestId, result }, { status });
}

/** The adapter's error shape. */
function adapterError(status: number, code: string, retryable = false, message = "Refused.") {
    return Response.json({ version: 1, requestId: REQUEST_ID, ok: false, error: { code, message, retryable } }, { status });
}

/** A minimal valid mod list. */
function state() {
    return { revision: REVISION, restartRequired: true, mods: [
        { id: "Native", name: "Native", version: "", enabled: true, pinned: true, required: false, sizeBytes: 0, sha256: null, dependsOn: [], issues: [] },
        { id: "Coop", name: "Coop", version: "", enabled: true, pinned: false, required: true, sizeBytes: 0, sha256: null, dependsOn: [], issues: [] },
    ] };
}

test("routes list to its fixed path with only the validated body and returns the website envelope", async () => {
    const { handler, calls } = handlerWith(() => adapterSuccess(state()));
    const response = await handler(modsRequest("list", { serverId: SERVER_ID }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { version: 1, requestId: REQUEST_ID, ok: true, result: state() });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://control-plane.example.test/api/v1/mods/list");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(calls[0].headers.get("x-request-id"), REQUEST_ID);
    assert.equal(calls[0].headers.get("apikey"), null);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(calls[0].body)), { serverId: SERVER_ID });
});

test("forwards each JSON route only to its allowlisted path", async () => {
    const bodies: Record<string, [unknown, unknown, number]> = {
        "load-order": [{ requestId: REQUEST_ID, serverId: SERVER_ID, expectedRevision: REVISION, mods: [{ id: "Native", enabled: true }, { id: "Coop", enabled: true }] }, state(), 200],
        uploads: [{ requestId: REQUEST_ID, serverId: SERVER_ID, expectedRevision: REVISION, manifest: { id: "SomeMod", name: "Some Mod", version: "v1" }, totalBytes: 9 * MIB, sha256: "d".repeat(64) },
            { uploadId: UPLOAD_ID, chunkBytes: 8 * MIB, chunkCount: 2, expiresAt: "2026-10-19T12:00:00.000Z", replaces: false }, 200],
        complete: [{ requestId: REQUEST_ID, uploadId: UPLOAD_ID, expectedRevision: REVISION }, { uploadId: UPLOAD_ID, status: "validating" }, 202],
        status: [{ serverId: SERVER_ID, uploadId: UPLOAD_ID }, { uploadId: UPLOAD_ID, status: "installed", state: state() }, 200],
        delete: [{ requestId: REQUEST_ID, serverId: SERVER_ID, expectedRevision: REVISION, modId: "SomeMod" }, state(), 200],
    };
    const paths: Record<string, string> = { "load-order": "/api/v1/mods/load-order", uploads: "/api/v1/mods/uploads", complete: "/api/v1/mods/uploads/complete", status: "/api/v1/mods/uploads/status", delete: "/api/v1/mods/delete" };
    for (const [route, [body, result, status]] of Object.entries(bodies)) {
        const { handler, calls } = handlerWith(() => adapterSuccess(result, status));
        const response = await handler(modsRequest(route, body));
        assert.equal(response.status, status, route);
        assert.deepEqual((await response.json()).result, result, route);
        assert.equal(calls[0].url, `https://control-plane.example.test${paths[route]}`, route);
        assert.deepEqual(JSON.parse(new TextDecoder().decode(calls[0].body)), body, route);
    }
});

test("requires a mutation's header request ID to equal its body request ID", async () => {
    const body = { requestId: REQUEST_ID, serverId: SERVER_ID, expectedRevision: REVISION, modId: "SomeMod" };
    const { handler, calls } = handlerWith(() => adapterSuccess(state()));
    for (const requestId of [null, "44444444-4444-4444-8444-444444444444"]) {
        assert.equal((await handler(modsRequest("delete", body, { requestId }))).status, 400);
    }
    assert.equal(calls.length, 0);
    const echoed = handlerWith(() => adapterSuccess(state(), 200, "44444444-4444-4444-8444-444444444444"));
    const response = await echoed.handler(modsRequest("delete", body));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "invalid_response");
});

test("rejects unknown routes, paths, queries, fields, methods, types and oversized bodies before any upstream call", async () => {
    const { handler, calls } = handlerWith(() => adapterSuccess(state()));
    const list = { serverId: SERVER_ID };
    const cases: [Request, number][] = [
        [modsRequest("../../v1/admin/control-plane", list), 400],
        [modsRequest("list", list, { query: "resource=mods&route=list&route=delete" }), 400],
        [modsRequest("list", list, { query: "resource=mods&route=list&serverId=x" }), 400],
        [modsRequest("list", list, { query: "resource=mods&resource=mod-chunk&route=list" }), 400],
        [modsRequest("list", { ...list, actor: { discordUserId: "1" } }), 400],
        [modsRequest("list", { serverId: "not-a-uuid" }), 400],
        [modsRequest("list", "{"), 400],
        [modsRequest("list", list, { method: "PUT" }), 405],
        [modsRequest("list", list, { contentType: "text/plain" }), 415],
        [modsRequest("load-order", { requestId: REQUEST_ID, serverId: SERVER_ID, expectedRevision: REVISION, mods: [{ id: "x".repeat(70_000), enabled: true }] }), 413],
    ];
    for (const [request, status] of cases) assert.equal((await handler(request)).status, status, request.url);
    assert.equal(calls.length, 0);
});

test("forwards one chunk with an exact length, its digest and the fixed path", async () => {
    const { handler, calls } = handlerWith(() => adapterSuccess({ receivedChunks: 1, receivedBytes: 3 }));
    const response = await handler(chunkRequest(new Uint8Array([1, 2, 3])));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: 1, requestId: REQUEST_ID, ok: true, result: { receivedChunks: 1, receivedBytes: 3 } });
    assert.equal(calls[0].url, `https://control-plane.example.test/api/v1/mods/uploads/chunk?uploadId=${UPLOAD_ID}&index=1`);
    assert.equal(calls[0].method, "PUT");
    assert.equal(calls[0].headers.get("content-type"), "application/octet-stream");
    assert.equal(calls[0].headers.get("x-chunk-sha256"), "c".repeat(64));
    assert.equal(calls[0].headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.deepEqual([...calls[0].body], [1, 2, 3]);
});

test("forwards a full 8 MiB chunk and refuses anything larger, declared or streamed", async () => {
    const { handler, calls } = handlerWith((call) => adapterSuccess({ receivedChunks: 1, receivedBytes: call.body.byteLength }));
    const full = await handler(chunkRequest(new Uint8Array(8 * MIB)));
    assert.equal(full.status, 200);
    assert.equal(calls[0].body.byteLength, 8 * MIB);
    assert.equal((await handler(chunkRequest(new Uint8Array(8 * MIB + 1)))).status, 413);
    const streamed = new ReadableStream<Uint8Array>({
        start(controller) { for (let index = 0; index < 9; index += 1) controller.enqueue(new Uint8Array(MIB)); controller.close(); },
    });
    assert.equal((await handler(chunkRequest(streamed))).status, 413);
    assert.equal(calls.length, 1);
});

test("rejects malformed chunk requests without relaying them", async () => {
    const { handler, calls } = handlerWith(() => adapterSuccess({ receivedChunks: 1, receivedBytes: 1 }));
    const bytes = () => new Uint8Array([1]);
    const cases: [Request, number][] = [
        [chunkRequest(new Uint8Array(0)), 400],
        [chunkRequest(bytes(), { digest: null }), 400],
        [chunkRequest(bytes(), { digest: "z".repeat(64) }), 400],
        [chunkRequest(bytes(), { query: `resource=mod-chunk&uploadId=${UPLOAD_ID}&index=13` }), 400],
        [chunkRequest(bytes(), { query: `resource=mod-chunk&uploadId=${UPLOAD_ID}&index=01` }), 400],
        [chunkRequest(bytes(), { query: `resource=mod-chunk&uploadId=../x&index=0` }), 400],
        [chunkRequest(bytes(), { query: `resource=mod-chunk&uploadId=${UPLOAD_ID}&index=0&path=/v1/admin` }), 400],
        [chunkRequest(bytes(), { contentType: "application/json" }), 415],
        [chunkRequest(bytes(), { method: "POST" }), 405],
    ];
    for (const [request, status] of cases) assert.equal((await handler(request)).status, status, request.url);
    assert.equal(calls.length, 0);
});

test("passes typed refusals through and keeps unreadable deadline replies retryable", async () => {
    const list = { serverId: SERVER_ID };
    for (const [status, code, retryable] of [[429, "rate_limited", true], [409, "revision_conflict", false], [409, "mods_unavailable", true], [401, "unauthenticated", false], [503, "identity_unavailable", true]] as const) {
        const { handler } = handlerWith(() => adapterError(status, code, retryable));
        const response = await handler(modsRequest("list", list));
        assert.equal(response.status, status);
        assert.deepEqual((await response.json()).error, { code, message: "Refused.", retryable });
    }
    for (const status of [408, 502, 503, 504]) {
        const { handler } = handlerWith(() => new Response("", { status }));
        const response = await handler(chunkRequest(new Uint8Array([1])));
        assert.equal(response.status, 503);
        assert.deepEqual((await response.json()).error, { code: "control_plane_unavailable", message: "The control plane is temporarily unavailable.", retryable: true });
    }
    const proxyLimit = handlerWith(() => new Response("<html>too large</html>", { status: 413 }));
    assert.deepEqual((await (await proxyLimit.handler(chunkRequest(new Uint8Array([1])))).json()).error.code, "request_too_large");
    const unreachable = createMyServersHandler({ allowedOrigins: [ORIGIN], controlPlaneUrl: "https://control-plane.example.test", waitUntil: () => {}, fetchImplementation: async () => { throw new TypeError("network"); } });
    const lost = await unreachable(chunkRequest(new Uint8Array([1])));
    assert.equal(lost.status, 502);
    assert.equal((await lost.json()).error.retryable, true);
});

test("rejects results that break the route's contract", async () => {
    const cases: [string, unknown, unknown][] = [
        ["list", { serverId: SERVER_ID }, { ...state(), revision: "nope" }],
        ["status", { serverId: SERVER_ID, uploadId: UPLOAD_ID }, { uploadId: "44444444-4444-4444-8444-444444444444", status: "failed" }],
        ["uploads", { requestId: REQUEST_ID, serverId: SERVER_ID, expectedRevision: REVISION, manifest: { id: "SomeMod", name: "Some Mod", version: "v1" }, totalBytes: 10, sha256: "d".repeat(64) },
            { uploadId: UPLOAD_ID, chunkBytes: 8 * MIB, chunkCount: 2, expiresAt: "2026-10-19T12:00:00.000Z", replaces: false }],
    ];
    for (const [route, body, result] of cases) {
        const { handler } = handlerWith(() => adapterSuccess(result));
        const response = await handler(modsRequest(route, body));
        assert.equal(response.status, 502, route);
        assert.deepEqual((await response.json()).error.code, "invalid_response");
    }
});

test("bounds the configurable mods deadlines below the Supabase response deadline", () => {
    assert.throws(() => handlerWith(() => adapterSuccess(state()), { modsChunkTimeoutMilliseconds: 150_000 }));
    assert.doesNotThrow(() => handlerWith(() => adapterSuccess(state()), { modsChunkTimeoutMilliseconds: 120_000 }));
});
