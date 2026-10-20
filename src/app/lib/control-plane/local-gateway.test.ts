import assert from "node:assert/strict";
import test from "node:test";
import { createUpstreamFetch, LocalControlPlaneUrlError, localControlPlaneDestination } from "./local-gateway";
import { putServerModChunk, requestServerMods } from "../hosting/server-mods-api";

const SERVER_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "local-session-token-with-enough-characters";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const REVISION = "a".repeat(64);
const VARIABLES = ["NODE_ENV", "CONTROL_PLANE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;

/** A minimal valid mod list as the adapter returns it. */
function modState() {
    return { revision: REVISION, restartRequired: false, mods: [
        { id: "Native", name: "Native", version: "", enabled: true, pinned: true, required: false, sizeBytes: 0, sha256: null, dependsOn: [], issues: [] },
    ] };
}

/** Runs `body` with the given environment and a recording global fetch, then restores both. */
async function withEnvironment(environment: Partial<Record<(typeof VARIABLES)[number], string>>,
    reply: (request: Request) => Response, body: (calls: Request[]) => Promise<void>) {
    // Next types NODE_ENV as read-only; tests write it through a plain record.
    const variables = process.env as Record<string, string | undefined>;
    const saved = Object.fromEntries(VARIABLES.map((name) => [name, variables[name]]));
    const originalFetch = globalThis.fetch;
    const calls: Request[] = [];
    for (const name of VARIABLES) delete variables[name];
    Object.assign(variables, environment);
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        calls.push(request.clone());
        return reply(request);
    };
    try { await body(calls); } finally {
        globalThis.fetch = originalFetch;
        for (const name of VARIABLES) {
            if (saved[name] === undefined) delete variables[name];
            else variables[name] = saved[name];
        }
    }
}

/** The local adapter's success reply, echoing the caller's request ID. */
function adapterSuccess(request: Request, result: unknown) {
    return Response.json({ ok: true, requestId: request.headers.get("x-request-id"), result });
}

test("the gateway is active only under next dev with CONTROL_PLANE_URL set", () => {
    assert.equal(localControlPlaneDestination({ NODE_ENV: "production", CONTROL_PLANE_URL: "http://127.0.0.1:8796" }), null);
    assert.equal(localControlPlaneDestination({ NODE_ENV: "test", CONTROL_PLANE_URL: "http://127.0.0.1:8796" }), null);
    assert.equal(localControlPlaneDestination({ NODE_ENV: "development" }), null);
    assert.equal(localControlPlaneDestination({ NODE_ENV: "development", CONTROL_PLANE_URL: " " }), null);
    assert.equal(localControlPlaneDestination({ NODE_ENV: "development", CONTROL_PLANE_URL: "http://127.0.0.1:8796" })?.href, "http://127.0.0.1:8796/");
    assert.equal(localControlPlaneDestination({ NODE_ENV: "development", CONTROL_PLANE_URL: "https://localhost:9443" })?.href, "https://localhost:9443/");
});

test("a non-loopback or non-origin CONTROL_PLANE_URL fails closed under next dev", () => {
    for (const value of ["http://control-plane.example.com", "http://192.168.1.10:8796", "ws://127.0.0.1:8796", "http://127.0.0.1:8796/api",
        "http://user:pass@127.0.0.1:8796", "http://127.0.0.1:8796/?x=1", "http://127.0.0.1:8796/#a", "not a url"]) {
        assert.throws(() => localControlPlaneDestination({ NODE_ENV: "development", CONTROL_PLANE_URL: value }), LocalControlPlaneUrlError, value);
    }
});

test("the upstream fetch rewrites only the Edge handler's placeholder origin", async () => {
    const seen: string[] = [];
    const upstream = createUpstreamFetch(new URL("http://127.0.0.1:8796"), async (input) => {
        seen.push(String(input));
        return new Response(null, { status: 204 });
    });
    await upstream("https://local-control-plane.invalid/api/v1/mods/list", { method: "POST" });
    await upstream(new URL(`https://local-control-plane.invalid/api/v1/mods/uploads/chunk?uploadId=${UPLOAD_ID}&index=3`), { method: "PUT" });
    assert.deepEqual(seen, ["http://127.0.0.1:8796/api/v1/mods/list", `http://127.0.0.1:8796/api/v1/mods/uploads/chunk?uploadId=${UPLOAD_ID}&index=3`]);
    await assert.rejects(upstream("https://control-plane.bannerlordcoop.com/api/v1/mods/list"), /Unexpected upstream origin/u);
    await assert.rejects(upstream(new Request("https://local-control-plane.invalid/api/v1/mods/list")), /Unexpected upstream request/u);
    assert.equal(seen.length, 2);
});

test("under next dev a mod chunk keeps its uploadId and index query all the way to the local adapter", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await withEnvironment({
        NODE_ENV: "development", CONTROL_PLANE_URL: "http://127.0.0.1:8796",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55421", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key-with-enough-characters",
    }, (request) => adapterSuccess(request, { receivedChunks: 1, receivedBytes: 3 }), async (calls) => {
        const receipt = await putServerModChunk(TOKEN, { uploadId: UPLOAD_ID, index: 0, sha256: "c".repeat(64), bytes });
        assert.deepEqual(receipt, { receivedChunks: 1, receivedBytes: 3 });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].method, "PUT");
        assert.equal(calls[0].url, `http://127.0.0.1:8796/api/v1/mods/uploads/chunk?uploadId=${UPLOAD_ID}&index=0`);
        assert.equal(calls[0].headers.get("x-chunk-sha256"), "c".repeat(64));
        assert.deepEqual(new Uint8Array(await calls[0].arrayBuffer()), new Uint8Array([1, 2, 3]));
    });
});

test("under next dev a mods read runs the Edge handler in process and reaches the local adapter", async () => {
    await withEnvironment({
        NODE_ENV: "development", CONTROL_PLANE_URL: "http://127.0.0.1:8796",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55421", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key-with-enough-characters",
    }, (request) => adapterSuccess(request, modState()), async (calls) => {
        assert.deepEqual(await requestServerMods(TOKEN, { route: "list", body: { serverId: SERVER_ID } }), modState());
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "http://127.0.0.1:8796/api/v1/mods/list");
        assert.equal(calls[0].headers.get("authorization"), `Bearer ${TOKEN}`);
        assert.deepEqual(await calls[0].json(), { serverId: SERVER_ID });
    });
});

test("a production build sends the same read to the hosted Edge Function even with CONTROL_PLANE_URL set", async () => {
    await withEnvironment({
        NODE_ENV: "production", CONTROL_PLANE_URL: "http://127.0.0.1:8796",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key-with-enough-characters",
    }, (request) => Response.json({ version: 1, requestId: request.headers.get("x-request-id"), ok: true, result: modState() }), async (calls) => {
        await requestServerMods(TOKEN, { route: "list", body: { serverId: SERVER_ID } });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "https://project.supabase.co/functions/v1/my-servers?resource=mods&route=list");
    });
});
