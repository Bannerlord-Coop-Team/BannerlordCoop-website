import assert from "node:assert/strict";
import test from "node:test";
import { createControlPlaneAdminHandler } from "../_shared/control-plane-admin.ts";

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

test("rejects non-admin and non-Discord sessions before the upstream call", async () => {
    for (const user of [
        { ...ADMIN, app_metadata: { role: "User" } },
        { ...ADMIN, identities: [{ provider: "google", id: "google", identity_data: {} }] },
    ]) {
        let calls = 0;
        const handler = createHandler(async (input) => {
            calls += 1;
            assert.match(String(input), /\/auth\/v1\/user$/u);
            return Response.json(user);
        });
        const response = await handler(adminRequest());
        assert.equal(response.status, user.app_metadata.role === "User" ? 403 : 409);
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
