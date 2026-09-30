import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listPublicServers } from "./public-servers";

const server = { serverId: "aaaaaaaa-1111-4111-8111-111111111111", displayName: "Public", friendlyRegion: null, observedGameState: "running", connectionIp: "203.0.113.4", gamePorts: [4200] };
test("public loader uses anonymous no-store route, bounded pagination, and fails closed", async () => {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    try {
        let calls = 0;
        const result = await listPublicServers(async (url, init) => {
            calls++;
            assert.equal(String(url), "https://control-plane.bannerlordcoop.com/v1/public/control-plane");
            assert.equal(new Headers(init?.headers).get("authorization"), null);
            assert.equal(new Headers(init?.headers).get("cookie"), null);
            assert.equal(new Headers(init?.headers).get("apikey"), null);
            assert.equal(init?.credentials, "omit");
            assert.equal(init?.method, "POST");
            assert.equal(init?.cache, "no-store");
            assert.equal(init?.redirect, "manual");
            const requestId = new Headers(init?.headers).get("x-request-id");
            assert.deepEqual(JSON.parse(String(init?.body)), { version: 1, requestId,
                operation: "public-servers", input: { cursor: calls === 1 ? null : "next", limit: 100 } });
            return Response.json({ version: 1, requestId, ok: true, result: { items: calls === 1 ? [server] : [], nextCursor: calls === 1 ? "next" : null } });
        });
        assert.deepEqual(result, [server]); assert.equal(calls, 2);
        await assert.rejects(listPublicServers(async () => new Response("private data", { status: 403 })), /unavailable/);
        await assert.rejects(listPublicServers(async (_url, init) => Response.json({ version: 1, requestId: new Headers(init?.headers).get("x-request-id"), ok: true, result: { items: [], nextCursor: "loop" } })), /Repeated/);
        await assert.rejects(listPublicServers(async (_url, init) => Response.json({ version: 1, requestId: new Headers(init?.headers).get("x-request-id"), ok: true, result: { items: [{ ...server, ownerId: "private-owner" }], nextCursor: null } })), /Invalid public/);
    } finally {
        if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
        if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
    }
});


test("public loader runs in workerd and rejects redirects without following them", async () => {
    const bundled = await build({
        stdin: {
            contents: `import { listPublicServers } from "./public-servers";
                export default { async fetch() {
                    try { return Response.json(await listPublicServers()); }
                    catch (error) { return Response.json({ error: error.message }, { status: 502 }); }
                } };`,
            resolveDir: dirname(fileURLToPath(import.meta.url)),
        },
        bundle: true, format: "esm", platform: "browser", write: false,
    });
    let redirectStatus = 0;
    const requests: string[] = [];
    const family = { ...server, displayName: "Family 👨‍👩‍👧‍👦" };
    const neighbor = { ...server, serverId: "bbbbbbbb-1111-4111-8111-111111111111", displayName: "Neighbor" };
    const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{
        name: "public-directory-test", modules: true, script: bundled.outputFiles[0].text,
        compatibilityDate: "2026-08-31",
        compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
        outboundService: async request => {
            requests.push(request.url);
            const url = new URL(request.url);
            assert.equal(url.href, "https://control-plane.bannerlordcoop.com/v1/public/control-plane");
            assert.equal(request.method, "POST");
            assert.equal(request.headers.get("authorization"), null);
            assert.equal(request.headers.get("cookie"), null);
            assert.equal(request.headers.get("apikey"), null);
            const payload = await request.json() as { version: number; requestId: string; operation: string;
                input: { cursor: string | null; limit: number } };
            assert.deepEqual(payload, { version: 1, requestId: request.headers.get("x-request-id"),
                operation: "public-servers", input: { cursor: requests.length === 1 ? null : "next", limit: 100 } });
            if (redirectStatus) return new Response(null, {
                status: redirectStatus, headers: { location: "https://other.test/private" },
            });
            const continuation = payload.input.cursor === "next";
            return Response.json({ version: 1, requestId: request.headers.get("x-request-id"), ok: true,
                result: { items: [continuation ? neighbor : family], nextCursor: continuation ? null : "next" } });
        },
    }] }));
    try {
        const response = await runtime.dispatchFetch("http://localhost/");
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), [family, neighbor]);
        assert.equal(requests.length, 2);
        for (const status of [301, 302, 303, 307, 308]) {
            redirectStatus = status;
            requests.length = 0;
            const rejected = await runtime.dispatchFetch("http://localhost/");
            assert.equal(rejected.status, 502);
            assert.deepEqual(await rejected.json(), { error: "Public directory unavailable" });
            assert.equal(requests.length, 1, `must not follow HTTP ${status}`);
        }
    } finally { await runtime.dispose(); }
});
