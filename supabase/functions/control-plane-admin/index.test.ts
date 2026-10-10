import assert from "node:assert/strict";
import test from "node:test";
import {
    CONTROL_PLANE_ADMIN_UPSTREAM_TIMEOUT_MILLISECONDS,
    createControlPlaneAdminHandler,
} from "../_shared/control-plane-admin.ts";
import { createRegionRequestNotifier, type RegionRequestNotifier } from "../_shared/region-request-notification.ts";

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

test("reports only its measured authentication and complete upstream durations", async (context) => {
    const times = [100, 127, 228];
    context.mock.method(performance, "now", () => times.shift() ?? 228);
    const handler = createHandler(async (input) => String(input).endsWith("/auth/v1/user")
        ? Response.json(ADMIN)
        : Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result: {} }, {
            headers: { "server-timing": "untrusted-secret;dur=1" },
        }));
    const response = await handler(adminRequest());
    assert.equal(response.headers.get("server-timing"), "edge_auth;dur=27, control_plane;dur=101");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("timing-allow-origin"), null);
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
        assert.equal(response.headers.get("server-timing"), null);
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

/** Creates an isolated Edge handler with injected network. */
function createHandler(fetchImplementation: typeof fetch, defaultContext = true, notifyRegionRequest?: RegionRequestNotifier) {
    return createControlPlaneAdminHandler({
        allowedOrigins: [ORIGIN, "https://bannerlordcoop.netlify.app"],
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "publishable-key-with-enough-characters",
        controlPlaneAdminUrl: "https://control-plane.example.test",
        fetchImplementation: (input, init) => defaultContext && String(input).endsWith("/rpc/website_session_context") ? Promise.resolve(Response.json({ impersonationId: null })) : fetchImplementation(input, init),
        notifyRegionRequest,
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

test("reads changed releases immediately while reauthenticating and correlating each request", async () => {
    let authCalls = 0;
    let upstreamCalls = 0;
    const handler = createHandler(async (input, init) => {
        if (String(input).endsWith("/auth/v1/user")) { authCalls++; return Response.json(ADMIN); }
        upstreamCalls++;
        return Response.json({ version: 1, requestId: JSON.parse(String(init?.body)).requestId, ok: true, result: { items: [{ buildId: `v0.1.${upstreamCalls}` }], nextCursor: null } });
    });
    await handler(releaseRequest());
    const requestId = "33333333-3333-4333-8333-333333333333";
    const current = await handler(releaseRequest(requestId));
    assert.deepEqual(await current.json(), { version: 1, requestId, ok: true, result: { items: [{ buildId: "v0.1.2" }], nextCursor: null } });
    assert.equal(current.headers.get("cache-control"), "no-store");
    assert.equal(upstreamCalls, 2);
    assert.equal(authCalls, 2);
    await handler(releaseRequest());
    assert.equal(upstreamCalls, 3);
});

test("never serves releases after authentication or admin access is lost", async () => {
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

test("forwards every channel, cursor and page size to the current catalog", async () => {
    let upstreamCalls = 0;
    const handler = createHandler(async (input, init) => {
        if (String(input).endsWith("/auth/v1/user")) return Response.json(ADMIN);
        upstreamCalls++;
        return releaseResponse(init);
    });
    await handler(releaseRequest());
    await handler(releaseRequest(REQUEST_ID, "nightly"));
    await handler(releaseRequest());
    assert.equal(upstreamCalls, 3);
    await handler(releaseRequest(REQUEST_ID, "stable", "v0.1.5"));
    await handler(releaseRequest(REQUEST_ID, "stable", "v0.1.5", 20));
    await handler(releaseRequest());
    assert.equal(upstreamCalls, 6);
});

test("does not fall back to the preceding catalog after an upstream failure", async () => {
    let unavailable = false;
    let upstreamCalls = 0;
    const handler = createHandler(async (input, init) => {
        if (String(input).endsWith("/auth/v1/user")) return Response.json(ADMIN);
        upstreamCalls++;
        if (unavailable) throw new Error("private upstream failure");
        return releaseResponse(init);
    });
    await handler(releaseRequest());
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


test("starts user and context together, but never forwards until both validate", async () => {
    let finishUser!: (response: Response) => void;
    let finishContext!: (response: Response) => void;
    const calls: string[] = [];
    const handler = createHandler(async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/auth/v1/user")) return new Promise(resolve => { finishUser = resolve; });
        if (url.endsWith("/rpc/website_session_context")) return new Promise(resolve => { finishContext = resolve; });
        return releaseResponse(init);
    }, false);
    const pending = handler(releaseRequest());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2);
    assert.ok(calls[0].endsWith("/auth/v1/user"));
    assert.ok(calls[1].endsWith("/rpc/website_session_context"));
    finishUser(Response.json(ADMIN));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2);
    finishContext(Response.json({ impersonationId: null }));
    assert.equal((await pending).status, 200);
    assert.equal(calls.length, 3);
});

for (const failure of ["user", "context"] as const) {
    test(`cancels a late ignored-abort response after ${failure} rejects and never forwards`, async () => {
        let finish!: (response: Response) => void;
        let signal: AbortSignal | undefined;
        let upstream = 0;
        const handler = createHandler(async (input, init) => {
            const url = String(input);
            if (url.includes("control-plane.example.test")) { upstream++; return releaseResponse(init); }
            if (url.endsWith("/user") === (failure === "user")) return new Response(null, { status: 401 });
            signal = init?.signal ?? undefined;
            return new Promise(resolve => { finish = resolve; });
        }, false);
        assert.equal((await handler(releaseRequest())).status, 401);
        assert.equal(signal?.aborted, true);
        let cancelled = false;
        finish(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(cancelled, true);
        assert.equal(upstream, 0);
    });
}

test("context rejection cancels and releases an in-progress user body", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    const handler = createHandler(async input => String(input).endsWith("/user")
        ? response : new Response(null, { status: 403 }), false);
    assert.equal((await handler(releaseRequest())).status, 401);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, true);
    assert.equal(response.body?.locked, false);
});

for (const context of [
    {},
    { impersonationId: REQUEST_ID, actorId: REQUEST_ID, targetId: REQUEST_ID, expiresAt: "2099-01-01T00:00:00Z" },
    { impersonationId: REQUEST_ID, actorId: REQUEST_ID, targetId: ADMIN.id, expiresAt: "2000-01-01T00:00:00Z" },
]) {
    test(`rejects invalid, cross-user, or expired context before forwarding: ${JSON.stringify(context)}`, async () => {
        let upstream = 0;
        const handler = createHandler(async (input, init) => {
            const url = String(input);
            if (url.endsWith("/user")) return Response.json(ADMIN);
            if (url.endsWith("/rpc/website_session_context")) return Response.json(context);
            upstream++;
            return releaseResponse(init);
        }, false);
        assert.equal((await handler(releaseRequest())).status, 401);
        assert.equal(upstream, 0);
    });
}

test("reads session revocation freshly after a successful request", async () => {
    let active = true;
    let upstream = 0;
    const handler = createHandler(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/user")) return Response.json(ADMIN);
        if (url.endsWith("/rpc/website_session_context")) return active ? Response.json({ impersonationId: null }) : new Response(null, { status: 403 });
        upstream++;
        return releaseResponse(init);
    }, false);
    assert.equal((await handler(releaseRequest())).status, 200);
    active = false;
    assert.equal((await handler(releaseRequest())).status, 401);
    assert.equal(upstream, 1);
});


test("a completed context is not expired by its fetch timer while the verified user is pending", async () => {
    const originalTimeout = AbortSignal.timeout;
    const contextDeadline = new AbortController();
    const authDeadline = new AbortController();
    let finishUser!: (response: Response) => void;
    AbortSignal.timeout = milliseconds => milliseconds === 4_000 ? contextDeadline.signal : authDeadline.signal;
    try {
        const handler = createHandler(async (input, init) => {
            if (String(input).endsWith("/user")) return new Promise(resolve => { finishUser = resolve; });
            if (String(input).endsWith("/rpc/website_session_context")) return Response.json({ impersonationId: null });
            return releaseResponse(init);
        }, false);
        const pending = handler(releaseRequest());
        await new Promise(resolve => setImmediate(resolve));
        contextDeadline.abort();
        finishUser(Response.json(ADMIN));
        assert.equal((await pending).status, 200);
    } finally { AbortSignal.timeout = originalTimeout; }
});

test("notifies a region requester through internal claim operations and returns the browser envelope", async () => {
    const upstream: Array<{ operation: string; input: unknown }> = [];
    const sent: string[] = [];
    const handler = createHandler(async (input, init) => {
        if (String(input).endsWith("/auth/v1/user")) return Response.json(ADMIN);
        const body = JSON.parse(String(init?.body)) as { requestId: string; operation: string; input: unknown };
        upstream.push({ operation: body.operation, input: body.input });
        return Response.json({ version: 1, requestId: body.requestId, ok: true, result: {
            requestId: REQUEST_ID, region: "germany", requesterEmail: "owner@example.com",
            notifiedAt: "2026-10-10T12:00:00.000Z", claimed: true,
        } });
    }, true, createRegionRequestNotifier({ from: "admin@bannerlordcoop.com", send: async (message) => { sent.push(message.text); } }));
    const response = await handler(adminRequest(JSON.stringify({
        version: 1, requestId: REQUEST_ID, operation: "notify-region-request", input: { requestId: REQUEST_ID },
    })));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
    assert.deepEqual(await response.json(), { version: 1, requestId: REQUEST_ID, ok: true, result: {
        requestId: REQUEST_ID, notifiedAt: "2026-10-10T12:00:00.000Z", sent: true,
    } });
    assert.deepEqual(upstream, [{ operation: "claim-region-request-notification", input: { requestId: REQUEST_ID } }]);
    assert.equal(sent.length, 1);
    assert.match(sent[0] ?? "", /https:\/\/bannerlordcoop\.com\/servers/u);
});

test("refuses browser calls to the internal notification claim operations", async () => {
    let forwarded = 0;
    const handler = createHandler(async (input) => {
        if (String(input).endsWith("/auth/v1/user")) return Response.json(ADMIN);
        forwarded += 1;
        return Response.json({});
    });
    for (const operation of ["claim-region-request-notification", "release-region-request-notification"]) {
        const response = await handler(adminRequest(JSON.stringify({ version: 1, requestId: REQUEST_ID, operation, input: { requestId: REQUEST_ID } })));
        assert.equal(response.status, 400);
    }
    assert.equal(forwarded, 0);
});

test("reports unavailable notifications when SMTP is not configured", async () => {
    const handler = createHandler(async (input) => String(input).endsWith("/auth/v1/user") ? Response.json(ADMIN) : Response.json({}));
    const response = await handler(adminRequest(JSON.stringify({
        version: 1, requestId: REQUEST_ID, operation: "notify-region-request", input: { requestId: REQUEST_ID },
    })));
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "notifications_unavailable");
});
