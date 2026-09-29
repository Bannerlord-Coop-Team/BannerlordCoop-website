import assert from "node:assert/strict";
import test from "node:test";
import {
    CONTROL_PLANE_ADMIN_UPSTREAM_TIMEOUT_MILLISECONDS,
    createControlPlaneAdminHandler,
} from "../_shared/control-plane-admin.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "access-token-with-enough-characters";
const ORIGIN = "https://bannerlordcoop.com";
const ADMIN = {
    id: "22222222-2222-4222-8222-222222222222",
    app_metadata: { role: "Admin" },
    identities: [{
        provider: "discord",
        id: "763278507085922325",
        identity_data: { provider_id: "763278507085922325" },
    }],
};

test("keeps the upstream budget above bounded OVH discovery and below the browser budget", () => {
    assert.equal(CONTROL_PLANE_ADMIN_UPSTREAM_TIMEOUT_MILLISECONDS, 65_000);
});

test("allows only the configured browser origin", async () => {
    const handler = createHandler(async () => new Response(null, { status: 500 }));
    const allowed = await handler(new Request("https://function.example.test", {
        method: "OPTIONS",
        headers: { origin: ORIGIN },
    }));
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);

    const denied = await handler(new Request("https://function.example.test", {
        method: "OPTIONS",
        headers: { origin: "https://attacker.example" },
    }));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("reauthenticates a Discord Admin and forwards the closed envelope", async () => {
    const calls: Array<{ url: string; authorization: string | null; body: string | null }> = [];
    const handler = createHandler(async (input, init) => {
        const url = String(input);
        calls.push({
            url,
            authorization: new Headers(init?.headers).get("authorization"),
            body: typeof init?.body === "string" ? init.body : null,
        });
        if (url.endsWith("/auth/v1/user")) return Response.json(ADMIN);
        return Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result: { healthy: true } });
    });
    const response = await handler(adminRequest());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.url, "https://control-plane.example.test/v1/admin/control-plane");
    assert.equal(calls[1]?.authorization, `Bearer ${TOKEN}`);
    assert.match(calls[1]?.body ?? "", new RegExp(REQUEST_ID, "u"));
});

test("rejects non-admin sessions before the upstream call", async () => {
    for (const user of [
        { ...ADMIN, app_metadata: { role: "User" } },
        { ...ADMIN, app_metadata: { role: "Server Manager" }, identities: [] },
    ]) {
        let calls = 0;
        const handler = createHandler(async (input) => {
            calls += 1;
            assert.match(String(input), /\/auth\/v1\/user$/u);
            return Response.json(user);
        });
        const response = await handler(adminRequest());
        assert.equal(response.status, 403);
        assert.equal(calls, 1);
    }
});

test("rejects malformed and oversized request envelopes", async () => {
    const handler = createHandler(async () => Response.json(ADMIN));
    const malformed = await handler(adminRequest(JSON.stringify({ version: 1, operation: "overview" })));
    assert.equal(malformed.status, 400);

    const oversized = await handler(adminRequest(JSON.stringify({
        version: 1,
        requestId: REQUEST_ID,
        operation: "overview",
        padding: "x".repeat(70_000),
    })));
    assert.equal(oversized.status, 413);
});

test("accepts authenticated server-side calls without emitting CORS", async () => {
    const handler = createHandler(async (input) => String(input).endsWith("/auth/v1/user")
        ? Response.json(ADMIN)
        : Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result: {} }));
    const response = await handler(adminRequest(undefined, false));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
});

/** Creates an isolated Edge handler with injected network and clock. */
function createHandler(fetchImplementation: typeof fetch, now?: () => number) {
    return createControlPlaneAdminHandler({
        allowedOrigins: [ORIGIN, "https://bannerlordcoop.netlify.app"],
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "publishable-key-with-enough-characters",
        controlPlaneAdminUrl: "https://control-plane.example.test",
        fetchImplementation,
        now,
    });
}

/** Creates an authenticated request with the requested envelope. */
function adminRequest(body = JSON.stringify({ version: 1, requestId: REQUEST_ID, operation: "overview" }), includeOrigin = true) {
    return new Request("https://function.example.test", {
        method: "POST",
        headers: {
            authorization: `Bearer ${TOKEN}`,
            "content-type": "application/json",
            ...(includeOrigin ? { origin: ORIGIN } : {}),
        },
        body,
    });
}

for (const identities of [undefined, [], [{ provider: "google", id: "google", identity_data: {} }]]) {
    test(`allows an Admin without Discord identity: ${JSON.stringify(identities)}`, async () => {
        let calls = 0;
        const handler = createHandler(async (input) => {
            calls += 1;
            return String(input).endsWith("/auth/v1/user")
                ? Response.json({ ...ADMIN, identities })
                : Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result: {} });
        });
        assert.equal((await handler(adminRequest())).status, 200);
        assert.equal(calls, 2);
    });
}

/** Creates the same paginated release-list envelope used by the admin website. */
function releaseRequest(requestId = REQUEST_ID, channel = "stable", cursor: string | null = null, limit = 100) {
    return adminRequest(JSON.stringify({ version: 1, requestId, operation: "builds", input: { channel, cursor, limit } }));
}

/** Returns a successful release page correlated with the forwarded request. */
function releaseResponse(init?: RequestInit) {
    const request = JSON.parse(String(init?.body));
    return Response.json({ version: 1, requestId: request.requestId, ok: true,
        result: { items: [{ buildId: "v0.1.5", channel: request.input.channel }], nextCursor: null } });
}

test("caches release pages for five minutes while reauthenticating and correlating each request", async () => {
    let now = 0;
    let authCalls = 0;
    let upstreamCalls = 0;
    const handler = createHandler(async (input, init) => {
        if (String(input).endsWith("/auth/v1/user")) { authCalls++; return Response.json(ADMIN); }
        upstreamCalls++;
        return releaseResponse(init);
    }, () => now);
    await handler(releaseRequest());
    now = 299_999;
    const requestId = "33333333-3333-4333-8333-333333333333";
    const cached = await handler(releaseRequest(requestId));
    assert.equal((await cached.json()).requestId, requestId);
    assert.equal(cached.headers.get("cache-control"), "no-store");
    assert.equal(upstreamCalls, 1);
    assert.equal(authCalls, 2);
    now = 300_000;
    await handler(releaseRequest());
    assert.equal(upstreamCalls, 2);
});

test("never serves a warm release cache after authentication or admin access is lost", async () => {
    let role = "Admin";
    let upstreamCalls = 0;
    const handler = createHandler(async (input, init) => {
        if (String(input).endsWith("/auth/v1/user")) return role === "expired"
            ? new Response(null, { status: 401 }) : Response.json({ ...ADMIN, app_metadata: { role } });
        upstreamCalls++;
        return releaseResponse(init);
    });
    await handler(releaseRequest());
    role = "User";
    assert.equal((await handler(releaseRequest())).status, 403);
    role = "expired";
    assert.equal((await handler(releaseRequest())).status, 401);
    assert.equal(upstreamCalls, 1);
});

test("isolates channel, cursor and page size and bounds the cache to one page per channel", async () => {
    let upstreamCalls = 0;
    const handler = createHandler(async (input, init) => {
        if (String(input).endsWith("/auth/v1/user")) return Response.json(ADMIN);
        upstreamCalls++;
        return releaseResponse(init);
    });
    await handler(releaseRequest());
    await handler(releaseRequest(REQUEST_ID, "nightly"));
    await handler(releaseRequest());
    assert.equal(upstreamCalls, 2);
    await handler(releaseRequest(REQUEST_ID, "stable", "v0.1.5"));
    await handler(releaseRequest(REQUEST_ID, "stable", "v0.1.5", 20));
    await handler(releaseRequest());
    assert.equal(upstreamCalls, 5);
});

test("does not serve expired releases or cache failed upstream requests", async () => {
    let now = 0;
    let unavailable = false;
    let upstreamCalls = 0;
    const handler = createHandler(async (input, init) => {
        if (String(input).endsWith("/auth/v1/user")) return Response.json(ADMIN);
        upstreamCalls++;
        if (unavailable) throw new Error("private upstream failure");
        return releaseResponse(init);
    }, () => now);
    await handler(releaseRequest());
    now = 300_000;
    unavailable = true;
    assert.equal((await handler(releaseRequest())).status, 502);
    assert.equal((await handler(releaseRequest())).status, 502);
    unavailable = false;
    assert.equal((await handler(releaseRequest())).status, 200);
    assert.equal(upstreamCalls, 4);
});

test("does not cache error envelopes, malformed pages or mismatched request IDs", async () => {
    for (const response of [
        { version: 1, requestId: REQUEST_ID, ok: false, error: { code: "forbidden" } },
        { version: 1, requestId: REQUEST_ID, ok: true, result: {} },
        { version: 1, requestId: "other", ok: true, result: { items: [], nextCursor: null } },
    ]) {
        let upstreamCalls = 0;
        const handler = createHandler(async (input) => {
            if (String(input).endsWith("/auth/v1/user")) return Response.json(ADMIN);
            upstreamCalls++;
            return Response.json(response);
        });
        await handler(releaseRequest());
        await handler(releaseRequest());
        assert.equal(upstreamCalls, 2);
    }
});

test("does not cache lifecycle operations or requests with unknown release fields", async () => {
    let upstreamCalls = 0;
    const handler = createHandler(async (input, init) => {
        if (String(input).endsWith("/auth/v1/user")) return Response.json(ADMIN);
        upstreamCalls++;
        return releaseResponse(init);
    });
    for (const envelope of [
        { operation: "start-server", input: { channel: "stable", cursor: null, limit: 100 } },
        { operation: "builds", input: { channel: "stable", cursor: null, limit: 100, unknown: true } },
    ]) {
        const raw = JSON.stringify({ version: 1, requestId: REQUEST_ID, ...envelope });
        await handler(adminRequest(raw));
        await handler(adminRequest(raw));
    }
    assert.equal(upstreamCalls, 4);
});
