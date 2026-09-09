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
    const calls: Array<{ url: string; method: string | undefined; headers: Headers; redirect: RequestRedirect | undefined; body: string | null }> = [];
    const handler = createHandler(async (input, init) => {
        const url = String(input);
        calls.push({
            url,
            method: init?.method,
            headers: new Headers(init?.headers),
            redirect: init?.redirect,
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
    assert.equal(calls[0]?.url, "https://project.supabase.co/auth/v1/user");
    assert.equal(calls[0]?.method, "GET");
    assert.equal(calls[0]?.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(calls[0]?.headers.get("apikey"), "publishable-key-with-enough-characters");
    assert.equal(calls[1]?.method, "POST");
    assert.deepEqual([...calls[1]!.headers], [["authorization", `Bearer ${TOKEN}`], ["content-type", "application/json"]]);
    assert.ok(calls.every((call) => call.redirect === "error"));
    assert.equal(calls[1]?.body, JSON.stringify({ version: 1, requestId: REQUEST_ID, operation: "overview" }));
});

test("accepts freshly verified Admin accounts regardless of sign-in provider or identities", async () => {
    for (const identities of [
        [{ provider: "google", id: "google", identity_data: {} }],
        [{ provider: "email", identity_data: {} }],
        [],
        undefined,
    ]) {
        let calls = 0;
        const handler = createHandler(async (input) => {
            calls += 1;
            return String(input).endsWith("/auth/v1/user")
                ? Response.json({ ...ADMIN, identities })
                : Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result: {} });
        });
        assert.equal((await handler(adminRequest())).status, 200);
        assert.equal(calls, 2);
    }
});

test("rejects non-Admin and user_metadata spoofing before the upstream call", async () => {
    for (const app_metadata of [{ role: "User" }, { role: "Server Manager" }, { role: "admin" }, {}, null, undefined]) {
        const user = { ...ADMIN, app_metadata, user_metadata: { role: "Admin" } };
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

test("reauthenticates the same stale token after demotion and rejects it before upstream", async () => {
    let role = "Admin";
    let authCalls = 0;
    let upstreamCalls = 0;
    const handler = createHandler(async (input, init) => {
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
        if (String(input).endsWith("/auth/v1/user")) {
            authCalls += 1;
            return Response.json({ ...ADMIN, app_metadata: { role }, user_metadata: { role: "Admin" } });
        }
        upstreamCalls += 1;
        return Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result: {} });
    });
    assert.equal((await handler(adminRequest())).status, 200);
    role = "User";
    assert.equal((await handler(adminRequest())).status, 403);
    assert.equal(authCalls, 2);
    assert.equal(upstreamCalls, 1);
});

test("accepts canonical lowercase RFC UUID versions 1 through 8", async () => {
    for (let version = 1; version <= 8; version += 1) {
        const id = `abcdefab-cdef-${version}abc-abcd-abcdefabcdef`;
        const handler = createHandler(async (input) => String(input).endsWith("/auth/v1/user")
            ? Response.json({ ...ADMIN, id, identities: [] })
            : Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result: {} }));
        assert.equal((await handler(adminRequest())).status, 200, id);
    }
});

test("requires a canonical non-nil Supabase UUID even for Discord Admins", async () => {
    for (const id of [undefined, null, 123, "", "763278507085922325", "22222222222242228222222222222222",
        "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "22222222-2222-9222-8222-222222222222",
        "22222222-2222-4222-7222-222222222222", ` ${ADMIN.id}`, `${ADMIN.id}\n`]) {
        let calls = 0;
        const handler = createHandler(async (input) => {
            calls += 1;
            assert.match(String(input), /\/auth\/v1\/user$/u);
            return Response.json({ ...ADMIN, id });
        });
        const response = await handler(adminRequest());
        assert.equal(response.status, 409, String(id));
        assert.equal((await response.json()).error.code, "identity_unavailable");
        assert.equal(calls, 1);
    }
});

test("fails closed and redacts failed or malformed Auth responses", async () => {
    for (const response of [new Response("private-auth-details", { status: 401 }), new Response("private-auth-details"), Response.json(null)]) {
        let calls = 0;
        const handler = createHandler(async () => { calls += 1; return response; });
        const result = await handler(adminRequest());
        assert.ok([401, 403].includes(result.status));
        assert.doesNotMatch(await result.text(), /private-auth-details/u);
        assert.equal(calls, 1);
    }
});

test("rejects disallowed POST Origin and originless preflight before authentication", async () => {
    let calls = 0;
    const handler = createHandler(async () => { calls += 1; return Response.json(ADMIN); });
    const request = adminRequest();
    request.headers.set("origin", "https://attacker.example");
    assert.equal((await handler(request)).status, 403);
    assert.equal((await handler(new Request("https://function.example.test", { method: "OPTIONS" }))).status, 400);
    assert.equal(calls, 0);
});

test("preserves the exact mutation envelope and Discord customer target", async () => {
    const body = JSON.stringify({ version: 1, requestId: REQUEST_ID, operation: "set-bonus-quota", input: { targetDiscordUserId: "763278507085922325", bonusQuota: 1 } }, null, 2);
    const handler = createHandler(async (input, init) => {
        if (String(input).endsWith("/auth/v1/user")) return Response.json({ ...ADMIN, identities: [] });
        assert.equal(init?.body, body);
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
        return Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result: {} });
    });
    assert.equal((await handler(adminRequest(body))).status, 200);
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

function createHandler(fetchImplementation: typeof fetch) {
    return createControlPlaneAdminHandler({
        allowedOrigins: [ORIGIN, "https://bannerlordcoop.netlify.app"],
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "publishable-key-with-enough-characters",
        controlPlaneAdminUrl: "https://control-plane.example.test",
        fetchImplementation,
    });
}

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
