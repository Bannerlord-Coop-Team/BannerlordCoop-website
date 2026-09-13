import assert from "node:assert/strict";
import test from "node:test";
import { listPublicServers } from "./public-servers";

const server = { serverId: "aaaaaaaa-1111-4111-8111-111111111111", displayName: "Public", friendlyRegion: null, observedGameState: "running", connectionIp: "203.0.113.4", gamePorts: [4200] };
test("public loader uses anonymous no-store route, bounded pagination, and fails closed", async () => {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-key";
    try {
        let calls = 0;
        const result = await listPublicServers(async (url, init) => {
            calls++;
            assert.equal(new URL(String(url)).pathname, "/functions/v1/public-servers");
            assert.equal(new Headers(init?.headers).get("authorization"), null);
            assert.equal(init?.cache, "no-store");
            assert.equal(init?.redirect, "error");
            const requestId = new Headers(init?.headers).get("x-request-id");
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
