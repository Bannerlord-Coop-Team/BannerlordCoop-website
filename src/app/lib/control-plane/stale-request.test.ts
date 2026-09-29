import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { requestControlPlaneAdminWithRefresh } from "./stale-request";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const input = { serverId: "11111111-1111-4111-8111-111111111111", expectedUpdatedAt: "2026-09-06T12:00:00.000Z", action: "start", reason: "Keep this reason" };
const options = { accessToken: "test-token", requestId: "22222222-2222-4222-8222-222222222222", operation: "server-operation", input };
const updatedAt = "2026-09-06T13:00:00.000Z";
type RequestBody = typeof options;
let calls: RequestBody[];
let refreshes: number;
const refresh = () => { refreshes++; };
function response(body: RequestBody, result: unknown, code?: string) {
    return Response.json({ version: 1, requestId: body.requestId, ok: !code,
        ...(code ? { error: { code, message: "Failure", retryable: false } } : { result }) }, { status: code ? 409 : 200 });
}
function mock(handler: (body: RequestBody, index: number) => Response | Promise<Response>) {
    globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as RequestBody;
        calls.push(body);
        return handler(body, calls.length);
    };
}
beforeEach(() => {
    calls = []; refreshes = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key-long-enough";
});
afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
});

test("stale admin job refreshes exact target and continues original UUID and intent once", async () => {
    mock((body, index) => {
        if (index === 1) return response(body, null, "stale_interaction");
        if (index === 2) return response(body, { dashboard: { server: { serverId: input.serverId, updatedAt } } });
        return response(body, { jobId: "job" });
    });
    assert.deepEqual(await requestControlPlaneAdminWithRefresh(options, refresh), { jobId: "job" });
    assert.equal(calls.length, 3);
    assert.equal(calls[1].operation, "server-dashboard");
    assert.deepEqual(calls[1].input, { serverId: input.serverId });
    assert.equal(calls[2].requestId, options.requestId);
    assert.deepEqual(calls[2].input, { ...input, expectedUpdatedAt: updatedAt });
    assert.equal(refreshes, 1);
});

test("second stale is bounded and still refreshes", async () => {
    mock((body, index) => index === 2
        ? response(body, { dashboard: { server: { serverId: input.serverId, updatedAt } } })
        : response(body, null, "stale_interaction"));
    await assert.rejects(requestControlPlaneAdminWithRefresh(options, refresh));
    assert.equal(calls.length, 3); assert.equal(refreshes, 1);
});

for (const code of ["control_plane_unavailable", "operation_timeout", "busy", "forbidden"]) {
    test(`does not retry or refresh unrelated/ambiguous ${code}`, async () => {
        mock((body) => response(body, null, code));
        await assert.rejects(requestControlPlaneAdminWithRefresh(options, refresh));
        assert.equal(calls.length, 1); assert.equal(refreshes, 0);
    });
}

test("network failure never retries", async () => {
    mock(() => { throw new Error("Network lost"); });
    await assert.rejects(requestControlPlaneAdminWithRefresh(options, refresh));
    assert.equal(calls.length, 1); assert.equal(refreshes, 0);
});

for (const operation of ["update-settings", "retry-job", "cancel-job", "acknowledge-job-failure"]) {
    test(`${operation} refreshes on stale without replaying changed state/attempt`, async () => {
        mock((body) => response(body, null, "stale_interaction"));
        await assert.rejects(requestControlPlaneAdminWithRefresh({ ...options, operation }, refresh));
        assert.equal(calls.length, 1); assert.equal(refreshes, 1);
    });
}

test("uncorrelated stale envelope is not proof of rejection", async () => {
    mock((body) => response({ ...body, requestId: "unrelated" }, null, "stale_interaction"));
    await assert.rejects(requestControlPlaneAdminWithRefresh(options, refresh));
    assert.equal(calls.length, 1); assert.equal(refreshes, 0);
});

for (const server of [null, { serverId: "other", updatedAt }, { serverId: input.serverId, updatedAt: input.expectedUpdatedAt }]) {
    test(`missing, different or unchanged target is not replayed: ${JSON.stringify(server)}`, async () => {
        mock((body, index) => index === 1 ? response(body, null, "stale_interaction") : response(body, { dashboard: { server } }));
        await assert.rejects(requestControlPlaneAdminWithRefresh(options, refresh));
        assert.equal(calls.length, 2); assert.equal(refreshes, 1);
    });
}

test("an accepted operation ID rules out automatic stale replay", async () => {
    mock((body) => Response.json({ version: 1, requestId: body.requestId, ok: false,
        error: { code: "stale_interaction", message: "Stale", retryable: false, operationId: "accepted-job" } }, { status: 409 }));
    await assert.rejects(requestControlPlaneAdminWithRefresh(options, refresh));
    assert.equal(calls.length, 1); assert.equal(refreshes, 1);
});

test("a successful HTTP response containing a stale error is not rejection evidence", async () => {
    mock((body) => Response.json({ version: 1, requestId: body.requestId, ok: false,
        error: { code: "stale_interaction", message: "Stale", retryable: false } }));
    await assert.rejects(requestControlPlaneAdminWithRefresh(options, refresh));
    assert.equal(calls.length, 1); assert.equal(refreshes, 0);
});
