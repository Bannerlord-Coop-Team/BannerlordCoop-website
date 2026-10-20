import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createMyServersHandler } from "../../../../supabase/functions/_shared/my-servers";
import { serverModsApi, type ServerModsApi } from "./server-mods-api";
import { MODS_REFRESH_SESSION_HEADER } from "./server-mods";
import { createServerModChunkHandler, createServerModsJsonHandler } from "./server-mods-route";

const SITE = "https://bannerlordcoop.com";
const SERVER_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const REVISION = "a".repeat(64);
const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const TOKEN = "session-access-token-long-enough";
const REFRESHED = "refreshed-access-token-long-enough";
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key-with-enough-characters";
});
afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ORIGINAL_KEY;
});

/** A fake Supabase auth client; `expiresIn` is the session's remaining lifetime in seconds. */
function authClient(options: { expiresIn?: number; refresh?: "ok" | "fail"; user?: string | null } = {}) {
    const calls = { refresh: 0 };
    const user = options.user === undefined ? { id: "owner" } : options.user === null ? null : { id: options.user };
    const client = {
        auth: {
            getUser: async () => ({ data: { user }, error: null }),
            getSession: async () => ({ data: { session: { access_token: TOKEN, user: { id: "owner" }, expires_at: NOW / 1_000 + (options.expiresIn ?? 3_600) } }, error: null }),
            refreshSession: async () => {
                calls.refresh += 1;
                return options.refresh === "fail" ? { data: { session: null }, error: new Error("refresh failed") } : { data: { session: { access_token: REFRESHED, user: { id: "owner" } } }, error: null };
            },
        },
    };
    return { client: client as never, calls };
}

/** Builds both handlers around an injected API and auth client. */
function handlers(api: ServerModsApi, auth = authClient()) {
    const dependencies = { getAuthClient: async () => auth.client, api, now: () => NOW };
    return { json: createServerModsJsonHandler(dependencies), chunk: createServerModChunkHandler(dependencies), auth };
}

/** A same-origin JSON request to the mods route. */
function jsonRequest(route: string, body: unknown, headers: Record<string, string> = {}, serverId = SERVER_ID) {
    return [new Request(`${SITE}/api/servers/${serverId}/mods?route=${route}`, {
        method: "POST", headers: { "content-type": "application/json", origin: SITE, "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ serverId }) }] as const;
}

/** A same-origin chunk PUT. */
function chunkRequest(bytes: Uint8Array<ArrayBuffer>, query = `uploadId=${UPLOAD_ID}&index=0`, headers: Record<string, string> = {}) {
    return [new Request(`${SITE}/api/servers/${SERVER_ID}/mods/chunk?${query}`, {
        method: "PUT", headers: { "content-type": "application/octet-stream", origin: SITE, "x-chunk-sha256": "e".repeat(64), ...headers }, body: bytes,
    }), { params: Promise.resolve({ serverId: SERVER_ID }) }] as const;
}

/** A minimal valid mod list. */
function state() {
    return { revision: REVISION, restartRequired: false, mods: [
        { id: "Native", name: "Native", version: "", enabled: true, pinned: true, required: false, sizeBytes: 0, sha256: null, dependsOn: [], issues: [] },
    ] };
}

/** An API that records calls and answers each with `reply`. */
function recordingApi(reply: () => Promise<unknown> = async () => state()) {
    const calls: { kind: string; token: string; value: unknown }[] = [];
    const api: ServerModsApi = {
        request: async (token, request) => { calls.push({ kind: "request", token, value: request }); return reply(); },
        putChunk: async (token, chunk) => { calls.push({ kind: "chunk", token, value: { ...chunk, bytes: [...chunk.bytes] } }); return reply() as never; },
    };
    return { api, calls };
}

test("relays a list end to end through the Edge Function to the fixed adapter path", async () => {
    const upstream: Request[] = [];
    const edge = createMyServersHandler({
        allowedOrigins: [SITE], controlPlaneUrl: "https://control-plane.example.test", waitUntil: () => {},
        fetchImplementation: async (input, init) => {
            const request = new Request(input, init);
            upstream.push(request);
            return Response.json({ ok: true, requestId: request.headers.get("x-request-id"), result: state() });
        },
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        assert.equal(url.origin + url.pathname, "https://project.supabase.co/functions/v1/my-servers");
        return edge(new Request(url, init));
    }) as typeof fetch;
    const { json } = handlers(serverModsApi);
    const response = await json(...jsonRequest("list", { serverId: SERVER_ID }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { ok: true, result: state() });
    assert.equal(upstream[0].url, "https://control-plane.example.test/api/v1/mods/list");
    assert.equal(upstream[0].headers.get("authorization"), `Bearer ${TOKEN}`);
});

test("relays a mutation end to end under the body requestId, which the Edge Function requires in the header", async () => {
    const upstream: { url: string; requestId: string | null; body: unknown }[] = [];
    const edge = createMyServersHandler({
        allowedOrigins: [SITE], controlPlaneUrl: "https://control-plane.example.test", waitUntil: () => {},
        fetchImplementation: async (input, init) => {
            const request = new Request(input, init);
            upstream.push({ url: request.url, requestId: request.headers.get("x-request-id"), body: await request.json() });
            return Response.json({ ok: true, requestId: request.headers.get("x-request-id"), result: state() });
        },
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => edge(new Request(String(input), init))) as typeof fetch;
    const { json } = handlers(serverModsApi);
    const body = { requestId: REQUEST_ID, serverId: SERVER_ID, expectedRevision: REVISION, modId: "Bannerlord.ButterLib" };
    const response = await json(...jsonRequest("delete", body));
    assert.deepEqual(await response.json(), { ok: true, result: state() });
    assert.deepEqual(upstream, [{ url: "https://control-plane.example.test/api/v1/mods/delete", requestId: REQUEST_ID, body }]);
});

test("relays a chunk end to end with its exact bytes, digest and query", async () => {
    const upstream: { url: string; digest: string | null; bytes: number[] }[] = [];
    const edge = createMyServersHandler({
        allowedOrigins: [SITE], controlPlaneUrl: "https://control-plane.example.test", waitUntil: () => {},
        fetchImplementation: async (input, init) => {
            const request = new Request(input, init);
            upstream.push({ url: request.url, digest: request.headers.get("x-chunk-sha256"), bytes: [...new Uint8Array(await request.arrayBuffer())] });
            return Response.json({ ok: true, requestId: request.headers.get("x-request-id"), result: { receivedChunks: 1, receivedBytes: 3 } });
        },
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => edge(new Request(String(input), init))) as typeof fetch;
    const { chunk } = handlers(serverModsApi);
    const response = await chunk(...chunkRequest(new Uint8Array([7, 8, 9])));
    assert.deepEqual(await response.json(), { ok: true, result: { receivedChunks: 1, receivedBytes: 3 } });
    assert.deepEqual(upstream, [{ url: `https://control-plane.example.test/api/v1/mods/uploads/chunk?uploadId=${UPLOAD_ID}&index=0`, digest: "e".repeat(64), bytes: [7, 8, 9] }]);
});

test("refuses cross-site, unknown-route and malformed requests before authenticating", async () => {
    const { api, calls } = recordingApi();
    const { json, chunk } = handlers(api);
    const list = { serverId: SERVER_ID };
    const cases: [Promise<Response>, number][] = [
        [json(...jsonRequest("list", list, { "sec-fetch-site": "cross-site" })), 404],
        [json(...jsonRequest("list", list, { origin: "https://attacker.example" })), 404],
        [json(...jsonRequest("list", list, {}, "not-a-uuid")), 404],
        [json(...jsonRequest("../admin", list)), 404],
        [json(...jsonRequest("list&route=delete", list)), 404],
        [json(...jsonRequest("list", { serverId: "44444444-4444-4444-8444-444444444444" })), 400],
        [json(...jsonRequest("list", { ...list, actor: "admin" })), 400],
        [json(...jsonRequest("list", list, { "content-type": "text/plain" })), 415],
        [chunk(...chunkRequest(new Uint8Array([1]), `uploadId=${UPLOAD_ID}&index=13`)), 400],
        [chunk(...chunkRequest(new Uint8Array([1]), `uploadId=${UPLOAD_ID}&index=0&extra=1`)), 400],
        [chunk(...chunkRequest(new Uint8Array([1]), undefined, { "x-chunk-sha256": "short" })), 400],
        [chunk(...chunkRequest(new Uint8Array([1]), undefined, { "content-type": "application/json" })), 415],
        [chunk(...chunkRequest(new Uint8Array(0))), 400],
        [chunk(...chunkRequest(new Uint8Array(8 * 1_048_576 + 1))), 413],
    ];
    for (const [response, status] of cases) assert.equal((await response).status, status);
    assert.equal(calls.length, 0);
});

test("refreshes a session near expiry or on the forced retry, and fails closed when the forced refresh fails", async () => {
    const fresh = recordingApi();
    await handlers(fresh.api).json(...jsonRequest("list", { serverId: SERVER_ID }));
    assert.equal(fresh.calls[0].token, TOKEN);

    const expiring = recordingApi();
    const nearExpiry = handlers(expiring.api, authClient({ expiresIn: 60 }));
    await nearExpiry.chunk(...chunkRequest(new Uint8Array([1])));
    assert.equal(expiring.calls[0].token, REFRESHED);
    assert.equal(nearExpiry.auth.calls.refresh, 1);

    const forced = recordingApi();
    await handlers(forced.api).json(...jsonRequest("list", { serverId: SERVER_ID }, { [MODS_REFRESH_SESSION_HEADER]: "1" }));
    assert.equal(forced.calls[0].token, REFRESHED);

    const failed = recordingApi();
    const response = await handlers(failed.api, authClient({ refresh: "fail" })).json(...jsonRequest("list", { serverId: SERVER_ID }, { [MODS_REFRESH_SESSION_HEADER]: "1" }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: { code: "unauthenticated", retryable: false, modId: null } });
    assert.equal(failed.calls.length, 0);

    const signedOut = recordingApi();
    assert.equal((await handlers(signedOut.api, authClient({ user: null })).json(...jsonRequest("list", { serverId: SERVER_ID }))).status, 401);
    assert.equal((await handlers(signedOut.api, authClient({ user: "someone-else" })).json(...jsonRequest("list", { serverId: SERVER_ID }))).status, 401);
});

test("maps Edge failures to closed codes, keeps retryability and names the refused module", async () => {
    const { MyServersApiError } = await import("./my-servers");
    const cases: [Error, number, unknown][] = [
        [new MyServersApiError("rate_limited", "Too many.", true), 429, { code: "rate_limited", retryable: true, modId: null }],
        [new MyServersApiError("mod_order_invalid", "The requested module order is invalid. Module: Bannerlord.Harmony.", false), 400, { code: "mod_order_invalid", retryable: false, modId: "Bannerlord.Harmony" }],
        [new MyServersApiError("revision_conflict", "Changed.", false), 409, { code: "revision_conflict", retryable: false, modId: null }],
        [new MyServersApiError("invalid_response", "Bad.", true), 502, { code: "invalid_response", retryable: true, modId: null }],
        [new Error("Result belongs to another upload"), 502, { code: "invalid_response", retryable: true, modId: null }],
    ];
    for (const [error, status, body] of cases) {
        const { api } = recordingApi(async () => { throw error; });
        const response = await handlers(api).json(...jsonRequest("delete", { requestId: REQUEST_ID, serverId: SERVER_ID, expectedRevision: REVISION, modId: "SomeMod" }));
        assert.equal(response.status, status);
        assert.deepEqual((await response.json()).error, body);
    }
});
