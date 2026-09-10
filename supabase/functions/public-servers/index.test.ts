import assert from "node:assert/strict";
import test from "node:test";
import { createPublicServersHandler } from "../_shared/public-servers.ts";
import { parsePublicServerPage } from "../_shared/server-visibility-contract.ts";

const requestId = "aaaaaaaa-1111-4111-8111-111111111111";
const server = { serverId: requestId, displayName: "Public campaign", friendlyRegion: "Europe", observedGameState: "running", connectionIp: "203.0.113.4", gamePorts: [4200] };
function handler(fetchImplementation: typeof fetch) {
    return createPublicServersHandler({ allowedOrigins: ["https://website.test"], controlPlaneUrl: "https://cp.test", fetchImplementation });
}
function request(path = "", options: RequestInit = {}) {
    return new Request(`https://edge.test/public-servers${path}`, { headers: { "x-request-id": requestId }, ...options });
}
function ok(result: unknown) {
    return Response.json({ version: 1, requestId, ok: true, result });
}

test("anonymous proxy only forwards public listing, no credentials, no cache", async () => {
    const run = handler(async (url, init) => {
        assert.equal(String(url), "https://cp.test/v1/public/control-plane");
        assert.equal(init?.cache, "no-store");
        assert.equal(init?.redirect, "error");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), null);
        assert.equal(headers.get("cookie"), null);
        assert.deepEqual(JSON.parse(String(init?.body)), { version: 1, requestId, operation: "public-servers", input: { cursor: null, limit: 50 } });
        return ok({ items: [server], nextCursor: null });
    });
    const response = await run(request("", { headers: { "x-request-id": requestId, authorization: "Bearer do-not-forward", cookie: "session=do-not-forward" } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual((await response.json()).result, { items: [server], nextCursor: null });
});

test("rejects nonpublic operations, methods, invalid pagination and disallowed origins without upstream access", async () => {
    let calls = 0;
    const run = handler(async () => { calls++; throw new Error("Unexpected fetch"); });
    for (const req of [request("?operation=my-servers"), request("?limit=101"), request("?limit=1&limit=2"), request("?cursor="), request("", { method: "POST", body: "{}" }), request("", { headers: { origin: "https://evil.test" } })]) {
        assert.ok((await run(req)).status >= 400);
    }
    assert.equal(calls, 0);
    const preflight = await run(request("", { method: "OPTIONS", headers: { origin: "https://website.test" } }));
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://website.test");
});

test("rejects unexpected fields instead of leaking infrastructure or private inventory", async () => {
    for (const item of [{ ...server, ownerDiscordId: "secret-owner" }, { ...server, agentPort: 9876 }, { ...server, accessRole: "owner" }, { ...server, connectionIp: "internal-hostname" }, { ...server, gamePorts: [0] }]) {
        const response = await handler(async () => ok({ items: [item], nextCursor: null }))(request());
        assert.equal(response.status, 502);
        assert.doesNotMatch(await response.text(), /secret-owner|9876|internal-hostname|203\.0\.113/);
    }
});

test("sanitizes upstream failures, bad envelopes, oversized responses and redirects", async () => {
    for (const fetcher of [
        async () => new Response("secret", { status: 503 }),
        async () => Response.json({ version: 1, requestId: "wrong", ok: true, result: { items: [server], nextCursor: null } }),
        async () => new Response("x".repeat(256 * 1024 + 1), { headers: { "content-type": "application/json" } }),
        async () => { throw new Error("redirect to secret"); },
    ]) {
        const response = await handler(fetcher)(request());
        assert.equal(response.status, 502);
        assert.doesNotMatch(await response.text(), /secret|203\.0\.113/);
    }
});

test("accepts empty/unassigned endpoints but rejects malformed or duplicated summaries", () => {
    assert.deepEqual(parsePublicServerPage({ items: [{ ...server, connectionIp: null, gamePorts: [] }], nextCursor: null }).items[0].gamePorts, []);
    assert.equal(parsePublicServerPage({ items: [{ ...server, connectionIp: "2001:db8::1" }], nextCursor: null }).items.length, 1);
    assert.throws(() => parsePublicServerPage({ items: [server, server], nextCursor: null }));
    assert.throws(() => parsePublicServerPage({ items: [{ ...server, connectionIp: "999.0.0.1" }], nextCursor: null }));
});
