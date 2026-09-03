import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../_shared/my-servers.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "access-token-with-enough-characters";
const ORIGIN = "https://bannerlordcoop.com";

test("allows only configured browser origins", async () => {
    const handler = createHandler(async () => new Response(null, { status: 500 }));
    const allowed = await handler(new Request("https://function.example.test", {
        method: "OPTIONS",
        headers: { origin: ORIGIN, "x-request-id": REQUEST_ID },
    }));
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(allowed.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");

    const denied = await handler(new Request("https://function.example.test", {
        method: "OPTIONS",
        headers: { origin: "https://attacker.example", "x-request-id": REQUEST_ID },
    }));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("routes a bounded list request through my-servers without caller identity fields", async () => {
    let upstreamRequest: Request | undefined;
    const handler = createHandler(async (input, init) => {
        upstreamRequest = new Request(input, init);
        return successEnvelope({ items: [], nextCursor: null });
    });
    const response = await handler(listRequest("?limit=25&cursor=next-page"));
    const body = await response.json();
    const upstreamBody = JSON.parse(await upstreamRequest?.text() ?? "{}");

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(upstreamRequest?.url, "https://control-plane.example.test/v1/user/control-plane");
    assert.equal(upstreamRequest?.method, "POST");
    assert.equal(upstreamRequest?.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(upstreamRequest?.headers.get("x-request-id"), REQUEST_ID);
    assert.equal(upstreamRequest?.headers.get("apikey"), null);
    assert.deepEqual(upstreamBody, {
        version: 1,
        requestId: REQUEST_ID,
        operation: "my-servers",
        input: { cursor: "next-page", limit: 25 },
    });
});

test("routes a strict lifecycle operation without caller authority", async () => {
    let upstreamRequest: Request | undefined;
    const handler = createHandler(async (input, init) => {
        upstreamRequest = new Request(input, init);
        return successEnvelope({
            outcome: "enqueued",
            jobId: "55555555-5555-4555-8555-555555555555",
            action: "restart-game",
        });
    });
    const response = await handler(operationRequest({
        serverId: "22222222-2222-4222-8222-222222222222",
        action: "restart-game",
        expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
    }));
    const upstreamBody = JSON.parse(await upstreamRequest?.text() ?? "{}");

    assert.equal(response.status, 200);
    assert.equal(upstreamRequest?.method, "POST");
    assert.deepEqual(upstreamBody, {
        version: 1,
        requestId: REQUEST_ID,
        operation: "server-operation",
        input: {
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "restart-game",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
        },
    });
});

test("rejects missing authentication and unsupported inputs before upstream", async () => {
    let calls = 0;
    const handler = createHandler(async () => {
        calls += 1;
        return successEnvelope({ items: [], nextCursor: null });
    });

    const unauthenticated = await handler(new Request("https://function.example.test", {
        headers: { origin: ORIGIN, "x-request-id": REQUEST_ID },
    }));
    assert.equal(unauthenticated.status, 401);

    for (const request of [
        listRequest("?ownerDiscordUserId=192469416892432384"),
        listRequest("?limit=0"),
        listRequest("?limit=101"),
        listRequest("?limit=1&limit=2"),
        listRequest("?cursor=first&cursor=second"),
        listRequest("?cursor="),
        listRequest(`?cursor=${"x".repeat(4_100)}`),
        listRequest("", "PUT"),
        new Request("https://function.example.test", {
            method: "POST",
            headers: {
                authorization: `Bearer ${TOKEN}`,
                origin: ORIGIN,
                "x-request-id": REQUEST_ID,
            },
            body: "{}",
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "start",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
        }, "?ownerDiscordUserId=192469416892432384"),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "delete",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
        }),
        operationRequest({
            serverId: "not-a-server",
            action: "start",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "stop",
            expectedUpdatedAt: "not-a-time",
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "stop",
            expectedUpdatedAt: "2026-09-02T16:45:07.479+02:00",
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "start",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
            roleIds: ["1286659364455252022"],
        }),
        new Request("https://function.example.test", {
            method: "POST",
            headers: {
                authorization: `Bearer ${TOKEN}`,
                "content-type": "application/json",
                origin: ORIGIN,
                "x-request-id": REQUEST_ID,
            },
            body: "x".repeat(16 * 1_024 + 1),
        }),
    ]) {
        const response = await handler(request);
        assert.ok([400, 405, 413, 414, 415].includes(response.status));
    }
    assert.equal(calls, 0);
});

test("preserves typed control-plane errors", async () => {
    const handler = createHandler(async () => Response.json({
        version: 1,
        requestId: REQUEST_ID,
        ok: false,
        error: {
            code: "role_authority_unavailable",
            message: "Role verification is unavailable.",
            retryable: true,
        },
    }, { status: 503 }));
    const response = await handler(listRequest());
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error.code, "role_authority_unavailable");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("rejects a mismatched control-plane envelope", async () => {
    const handler = createHandler(async () => Response.json({
        version: 1,
        requestId: "22222222-2222-4222-8222-222222222222",
        ok: true,
        result: { items: [], nextCursor: null },
    }));
    const response = await handler(listRequest());
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.error.code, "invalid_response");
});

function createHandler(fetchImplementation: typeof fetch) {
    return createMyServersHandler({
        allowedOrigins: [ORIGIN, "https://bannerlordcoop.netlify.app"],
        controlPlaneUrl: "https://control-plane.example.test",
        fetchImplementation,
    });
}

function successEnvelope(result: unknown) {
    return Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result });
}

function listRequest(query = "", method = "GET") {
    return new Request(`https://function.example.test${query}`, {
        method,
        headers: {
            authorization: `Bearer ${TOKEN}`,
            origin: ORIGIN,
            "x-request-id": REQUEST_ID,
        },
    });
}

function operationRequest(input: Record<string, unknown>, query = "") {
    return new Request(`https://function.example.test${query}`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${TOKEN}`,
            "content-type": "application/json",
            origin: ORIGIN,
            "x-request-id": REQUEST_ID,
        },
        body: JSON.stringify(input),
    });
}
