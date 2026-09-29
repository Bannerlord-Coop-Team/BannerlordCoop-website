import assert from "node:assert/strict";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import { seedBrowserSession } from "./browser-session.mjs";
import { fixture } from "./seed-auth.mjs";

/** Supplies a test-only GoTrue password response without contacting any service. */
function authResponse(userOverrides = {}) {
    return Response.json({
        access_token: "local-test-access-token", refresh_token: "local-test-refresh-token",
        token_type: "bearer", expires_in: 3600,
        user: { id: fixture.accountId, identities: [{ provider: "email" }], user_metadata: { padding: "x".repeat(5000) }, ...userOverrides },
    });
}

test("local password session round-trips library-generated chunked cookies through Supabase SSR", async () => {
    let installed;
    const result = await seedBrowserSession({ addCookies: async cookies => { installed = cookies; } }, "local-key", async (url, options) => {
        assert.equal(String(url), "https://supabase-tls.localhost:8443/auth/v1/token?grant_type=password");
        assert.equal(options.method, "POST");
        const body = JSON.parse(options.body);
        assert.equal(body.email, fixture.email);
        assert.equal(body.password, fixture.password);
        return authResponse();
    });
    assert.deepEqual(result, { accountId: fixture.accountId });
    assert.ok(installed.length > 1, "Large sessions use the library's cookie chunking");
    for (const cookie of installed) {
        assert.equal(cookie.domain, "supabase-tls.localhost");
        assert.equal(cookie.path, "/");
        assert.equal(cookie.secure, true);
        assert.equal(cookie.sameSite, "Lax");
    }
    const reader = createServerClient("https://supabase-tls.localhost:8443", "local-key", {
        cookies: { getAll: () => installed, setAll: () => {} },
    });
    const { data, error } = await reader.auth.getSession();
    assert.equal(error, null);
    assert.equal(data.session.access_token, "local-test-access-token");
    assert.equal(data.session.user.id, fixture.accountId);
});

for (const invalidUser of [{ id: "another-account" }, { identities: [{ provider: "discord" }] }]) {
    test(`refuses unexpected local identity ${JSON.stringify(invalidUser)}`, async () => {
        await assert.rejects(seedBrowserSession({ addCookies: () => assert.fail("Must not install rejected session") }, "local-key", async () => authResponse(invalidUser)), /expected Discord-free account/);
    });
}

test("missing key fails before contacting Auth", async () => {
    await assert.rejects(seedBrowserSession({}, "", () => assert.fail("Must not dispatch without key")), /PUBLISHABLE_KEY is required/);
});

test("authentication rejection does not install cookies or expose provider error text", async () => {
    await assert.rejects(seedBrowserSession({ addCookies: () => assert.fail("Must not install failed session") }, "local-key", async () => Response.json({ message: "private-provider-detail" }, { status: 400 })), /^Error: Local password authentication failed$/);
});
