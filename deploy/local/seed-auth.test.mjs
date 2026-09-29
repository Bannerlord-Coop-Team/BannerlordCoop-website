import assert from "node:assert/strict";
import test from "node:test";
import { fixture, seedLocalAuth } from "./seed-auth.mjs";

for (const exists of [false, true]) {
    test(`local auth seed ${exists ? "resets" : "creates"} the fixed confirmed account through GoTrue`, async () => {
        const calls = [];
        const result = await seedLocalAuth("https://supabase-tls.localhost:8443", "local-service-key", async (url, options) => {
            calls.push({ url, ...options });
            if (calls.length === 1) return new Response(null, { status: exists ? 200 : 404 });
            return Response.json({ id: fixture.accountId, email: fixture.email });
        });
        assert.deepEqual(result, { accountId: fixture.accountId, email: fixture.email });
        assert.equal(calls[1].method, exists ? "PUT" : "POST");
        const body = JSON.parse(calls[1].body);
        assert.equal(body.email_confirm, true);
        assert.equal(body.password, fixture.password);
        assert.equal(body.id, exists ? undefined : fixture.accountId);
        assert.equal(calls[1].headers.authorization, "Bearer local-service-key");
    });
}

test("seed refuses a remote target without dispatching a request", async () => {
    await assert.rejects(seedLocalAuth("https://example.supabase.co", "key", () => assert.fail("Must not contact remote auth")), /restricted to the local/);
});
