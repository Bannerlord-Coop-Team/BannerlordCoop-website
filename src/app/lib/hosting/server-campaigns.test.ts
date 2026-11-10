import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { createMyServersHandler } from "../../../../supabase/functions/_shared/my-servers.ts";
import { campaignResetStatusMessage } from "../../../../supabase/functions/_shared/server-campaign-contract.ts";
import { getMyServerCampaignResetStatus, resetMyServerCampaign } from "./server-campaigns.ts";
import { MyServersApiError } from "./my-servers.ts";

const fixture = JSON.parse(readFileSync(new URL("../../../../test/fixtures/campaign-reset/v1.json", import.meta.url), "utf8"));
const { serverId, jobId } = fixture;
const originalFetch = globalThis.fetch;
const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [["NEXT_PUBLIC_SUPABASE_URL", previous.url], ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", previous.key]]) {
        if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
});

function wire(response: (requestId: string) => Response) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://website.fixture.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable-key-for-reset-contract";
    let edgeCalls = 0; let upstreamCalls = 0;
    const requestFailures: unknown[] = [];
    const edge = createMyServersHandler({ allowedOrigins: ["https://website.fixture.invalid"], controlPlaneUrl: "https://cp.fixture.invalid", waitUntil: () => undefined, fetchImplementation: async (url, init) => {
        upstreamCalls++;
        try {
        assert.equal(String(url), "https://cp.fixture.invalid/v1/user/control-plane");
        assert.equal(init?.method, "POST");
        assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic-owner-token");
        const body = JSON.parse(String(init.body));
        assert.deepEqual(Object.keys(body).sort(), ["input", "operation", "requestId", "version"]);
        assert.equal(body.version, 1);
        assert.equal(new Headers(init.headers).get("x-request-id"), body.requestId);
        assert.deepEqual([...new Headers(init.headers).keys()].sort(), ["authorization", "content-type", "x-request-id"]);
        assert.deepEqual(body.input, { serverId, jobId });
        assert.equal(body.operation, "reset-campaign-status");
        return response(body.requestId);
        } catch (error) { requestFailures.push(error); throw error; }
    } });
    globalThis.fetch = async (input, init) => {
        edgeCalls++;
        try {
        const url = new URL(String(input));
        assert.equal(url.origin + url.pathname, "https://website.fixture.invalid/functions/v1/my-servers");
        assert.deepEqual(Object.fromEntries(url.searchParams), { resource: "reset-campaign-status", serverId, jobId });
        assert.equal(init?.method, "GET"); assert.equal(init.body, undefined);
        assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic-owner-token");
        assert.deepEqual([...new Headers(init.headers).keys()].sort(), ["accept", "apikey", "authorization", "x-request-id"]);
        assert.equal(init.cache, "no-store");
        return edge(new Request(url, init));
        } catch (error) { requestFailures.push(error); throw error; }
    };
    return () => { assert.deepEqual(requestFailures, []); assert.equal(edgeCalls, 1); assert.equal(upstreamCalls, 1); };
}

test("real Website client and Edge consume the fixed refusal without submitting another reset", async () => {
    const { state, errorCode, instruction } = fixture.terminalFailures[0];
    const failure = { state, errorCode, instruction };
    const result = { serverId, jobId, ...failure };
    const check = wire(requestId => Response.json({ version: 1, requestId, ok: true, result }));
    const status = await getMyServerCampaignResetStatus("synthetic-owner-token", serverId, jobId);
    assert.deepEqual(status, result);
    assert.equal(campaignResetStatusMessage(status), failure.instruction);
    check();
});

test("reader-first deployment tolerates only structured old-peer refusals and never resubmits Reset", async () => {
    for (const peer of fixture.unsupported) {
        const check = wire(requestId => Response.json({ version: 1, requestId, ok: false,
            error: { code: peer.code, message: "The requested operation is unavailable.", retryable: peer.retryable } }, { status: peer.status }));
        assert.equal(await getMyServerCampaignResetStatus("synthetic-owner-token", serverId, jobId), null);
        check();
    }
    for (const [code, status, retryable] of [["forbidden", 404, false], ["control_plane_unavailable", 502, true], ["operation_unavailable", 503, true]]) {
        const check = wire(requestId => Response.json({ version: 1, requestId, ok: false,
            error: { code, message: "Unavailable", retryable } }, { status: Number(status) }));
        await assert.rejects(getMyServerCampaignResetStatus("synthetic-owner-token", serverId, jobId), MyServersApiError);
        check();
    }
});

test("bad reset status is not treated as legacy support and identity validation precedes every read", async () => {
    const check = wire(requestId => Response.json({ version: 1, requestId, ok: true,
        result: { serverId, jobId, state: "failed", errorCode: "agent_capability_unavailable", instruction: "private debug output" } }));
    await assert.rejects(getMyServerCampaignResetStatus("synthetic-owner-token", serverId, jobId), (error: unknown) => error instanceof MyServersApiError && error.code === "invalid_response");
    check();
    globalThis.fetch = async () => { throw Error("Invalid input must not dispatch"); };
    await assert.rejects(getMyServerCampaignResetStatus("synthetic-owner-token", "invalid", jobId), (error: unknown) => error instanceof MyServersApiError && error.code === "invalid_request");
});

test("reset submission keeps its exact durable POST and does not poll or retry on its own", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://website.fixture.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable-key-for-reset-contract";
    const input = { action: "reset-campaign" as const, serverId, expectedUpdatedAt: "2026-11-10T14:47:35.000Z" };
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
        calls++; assert.equal(init?.method, "POST"); assert.deepEqual(JSON.parse(String(init.body)), input);
        return Response.json({ version: 1, requestId: jobId, ok: true, result: { outcome: "enqueued", jobId, action: "reset-campaign" } });
    };
    assert.deepEqual(await resetMyServerCampaign("synthetic-owner-token", jobId, input), { outcome: "enqueued", jobId, action: "reset-campaign" });
    assert.equal(calls, 1);
});
