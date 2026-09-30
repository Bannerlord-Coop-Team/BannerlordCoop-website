import assert from "node:assert/strict";
import test from "node:test";
import { sessionContext } from "./session-context.mjs";

const target = "22222222-2222-4222-8222-222222222222";
const context = { impersonationId: "33333333-3333-4333-8333-333333333333", actorId: "11111111-1111-4111-8111-111111111111", targetId: target, expiresAt: "2099-01-01T00:00:00Z" };
const options = { url: "https://fixture.invalid", key: "isolated-publishable-key", token: "native-target-fixture", userId: target, action: "console.input" };
test("console authorizes native target sessions and rechecks durable context for every operation", async () => {
    let active = true, calls = 0;
    const request = async (url, init) => {
        calls++;
        assert.equal(url.pathname, "/rest/v1/rpc/website_session_context");
        assert.equal(init.headers.authorization, "Bearer native-target-fixture");
        assert.equal(JSON.parse(init.body).p_action, "console.input");
        return Response.json(active ? context : {}, { status: active ? 200 : 403 });
    };
    assert.deepEqual(await sessionContext({ ...options, fetch: request }), context);
    active = false;
    await assert.rejects(sessionContext({ ...options, fetch: request }));
    assert.equal(calls, 2);
    assert.equal(await sessionContext({ ...options, fetch: async () => Response.json({ impersonationId: null }) }), null);
});
test("console rejects stale, malformed, cross-account and oversized session context", async () => {
    for (const body of [null, {}, { ...context, targetId: context.actorId }, { ...context, actorId: "untrusted" }, { ...context, expiresAt: "2000-01-01T00:00:00Z" }, { ...context, expiresAt: "invalid" }, { data: "x".repeat(4096) }]) {
        await assert.rejects(sessionContext({ ...options, fetch: async () => Response.json(body) }));
    }
});
