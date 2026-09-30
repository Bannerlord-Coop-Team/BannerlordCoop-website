import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../_shared/my-servers.ts";
import { parseVisibilityMutation, parseVisibilityResult } from "../_shared/server-visibility-contract.ts";

const requestId = "aaaaaaaa-1111-4111-8111-111111111111";
const input = { action: "set-server-visibility" as const, serverId: requestId, visibility: "public" as const, expectedUpdatedAt: "2026-09-10T00:00:00.000Z" };
const result = { outcome: "updated", serverId: requestId, visibility: "public", updatedAt: "2026-09-10T00:00:01.000Z" };
function request(body: unknown, token: string | null = "original-token-with-enough-characters", id: string | null = requestId) {
    return new Request("https://edge.test/my-servers", { method: "POST", headers: {
        "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(id ? { "x-request-id": id } : {}),
    }, body: JSON.stringify(body) });
}
function handler(fetchImplementation: typeof fetch) {
    return createMyServersHandler({ allowedOrigins: ["https://website.test"], controlPlaneUrl: "https://cp.test", fetchImplementation });
}

test("visibility update forwards original bearer, request ID and stale-generation guard, not actor claims", async () => {
    const run = handler(async (url, init) => {
        assert.equal(String(url), "https://cp.test/v1/user/control-plane");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer original-token-with-enough-characters");
        assert.deepEqual(JSON.parse(String(init?.body)), { version: 1, requestId, operation: "set-server-visibility", input: {
            serverId: input.serverId, visibility: input.visibility, expectedUpdatedAt: input.expectedUpdatedAt,
        } });
        return Response.json({ version: 1, requestId, ok: true, result });
    });
    const response = await run(request(input));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("rejects unauthenticated, request-ID-less, forged-role and malformed visibility updates locally", async () => {
    let calls = 0;
    const run = handler(async () => { calls++; throw new Error("Unexpected fetch"); });
    for (const req of [request(input, null), request(input, "original-token-with-enough-characters", null), request({ ...input, visibility: "friends" }), request({ ...input, role: "owner" }), request({ ...input, expectedUpdatedAt: "bad" })]) {
        assert.ok((await run(req)).status >= 400);
    }
    assert.equal(calls, 0);
});

test("preserves authoritative owner denial and stale-generation errors", async () => {
    for (const code of ["server_not_found", "stale_interaction"]) {
        const run = handler(async () => Response.json({ version: 1, requestId, ok: false, error: { code, message: "Not permitted.", retryable: false } }, { status: 409 }));
        const response = await run(request(input));
        assert.equal(response.status, 409);
        assert.equal((await response.json()).error.code, code);
    }
});

test("rejects uncorrelated mutation results and unknown fields", async () => {
    assert.deepEqual(parseVisibilityMutation(input), input);
    assert.deepEqual(parseVisibilityResult(result, input), result);
    assert.deepEqual(parseVisibilityResult({ ...result, outcome: "existing" }, input), { ...result, outcome: "existing" });
    assert.throws(() => parseVisibilityResult({ ...result, outcome: "enqueued" }, input));
    assert.throws(() => parseVisibilityResult({ serverId: result.serverId, visibility: result.visibility, updatedAt: result.updatedAt }, input));
    assert.throws(() => parseVisibilityResult({ ...result, visibility: "private" }, input));
    assert.throws(() => parseVisibilityResult({ ...result, ownerId: "secret" }, input));
    const response = await handler(async () => Response.json({ version: 1, requestId, ok: true, result: { ...result, serverId: "wrong" } }))(request(input));
    assert.equal(response.status, 502);
});


test("release change forwards the selected channel and preserves the mutation ID", async () => {
    const run = handler(async (_url, init) => {
        assert.deepEqual(JSON.parse(String(init?.body)), { version: 1, requestId, operation: "set-release-channel", input: {
            serverId: input.serverId, releaseChannel: "nightly", expectedUpdatedAt: input.expectedUpdatedAt,
        } });
        return Response.json({ version: 1, requestId, ok: true, result: { outcome: "enqueued", jobId: requestId, action: "update" } });
    });
    assert.equal((await run(request({ action: "set-release-channel", serverId: input.serverId, releaseChannel: "nightly", expectedUpdatedAt: input.expectedUpdatedAt }))).status, 200);
});

test("release requests reject forged authority, invalid channels and missing mutation IDs", async () => {
    let calls = 0;
    const run = handler(async () => { calls++; throw new Error("Unexpected fetch"); });
    const mutation = { action: "set-release-channel", serverId: input.serverId, releaseChannel: "nightly", expectedUpdatedAt: input.expectedUpdatedAt };
    for (const req of [request(mutation, null), request(mutation, "original-token-with-enough-characters", null), request({ ...mutation, releaseChannel: "beta" }), request({ ...mutation, role: "owner" }), request({ ...mutation, expectedUpdatedAt: "bad" })]) {
        assert.ok((await run(req)).status >= 400);
    }
    assert.equal(calls, 0);
});

test("release status forwards the server and rejects private or mismatched results", async () => {
    for (const invalid of [false, true]) {
        const run = handler(async (_url, init) => {
            assert.equal(JSON.parse(String(init?.body)).operation, "server-update-status");
            return Response.json({ version: 1, requestId, ok: true, result: { serverId: input.serverId, releaseChannel: "nightly",
                job: { jobId: requestId, state: "running", progress: "Installing the selected server version", ...(invalid ? { requestPayload: "private" } : {}) } } });
        });
        const response = await run(new Request(`https://edge.test/my-servers?resource=update-status&serverId=${input.serverId}`, { headers: { authorization: "Bearer original-token-with-enough-characters", "x-request-id": requestId } }));
        assert.equal(response.status, invalid ? 502 : 200);
    }
});
