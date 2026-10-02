import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../_shared/my-servers.ts";
import { parseCampaignMutation, parseCampaignPage } from "../_shared/server-campaign-contract.ts";

const requestId = "aaaaaaaa-1111-4111-8111-111111111111";
const serverId = "bbbbbbbb-1111-4111-8111-111111111111";
const saveId = "cccccccc-1111-4111-8111-111111111111";
const updatedAt = "2026-10-02T12:00:00.000Z";
const token = "original-token-with-enough-characters";
const campaign = { saveId, displayName: "Default New Game", byteSize: 6_144, createdAt: updatedAt, lastUsedAt: null, importedBy: "system" };
const page = { serverId, updatedAt, activeSaveId: saveId, items: [campaign], nextCursor: null };
function handler(fetchImplementation: typeof fetch) { return createMyServersHandler({ allowedOrigins: ["https://website.test"], controlPlaneUrl: "https://cp.test", fetchImplementation }); }
function get(query: string) { return new Request(`https://edge.test/my-servers?${query}`, { headers: { authorization: `Bearer ${token}`, "x-request-id": requestId } }); }
function post(body: unknown, id = true) { return new Request("https://edge.test/my-servers", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(id ? { "x-request-id": requestId } : {}) }, body: JSON.stringify(body) }); }

test("campaign listing forwards a bounded page request and only accepts the server's own summaries", async () => {
    const response = await handler(async (url, init) => {
        assert.equal(String(url), "https://cp.test/v1/user/control-plane");
        assert.deepEqual(JSON.parse(String(init?.body)), { version: 1, requestId, operation: "server-saves", input: { serverId, cursor: null, limit: 50 } });
        return Response.json({ version: 1, requestId, ok: true, result: page });
    })(get(`resource=saves&serverId=${serverId}&limit=50`));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, page);
    for (const query of [`resource=saves&serverId=${serverId}&limit=500`, `resource=saves&serverId=nope`, `resource=saves&serverId=${serverId}&saveId=${saveId}`]) {
        assert.equal((await handler(async () => { throw Error("Unexpected fetch"); })(get(query))).status, 400);
    }
    for (const result of [
        { ...page, serverId: requestId },
        { ...page, items: [{ ...campaign, saveObjectKey: "private/object" }] },
        { ...page, items: [{ ...campaign, importedBy: "system:packaged-default" }] },
        { ...page, items: [campaign, campaign] },
    ]) assert.equal((await handler(async () => Response.json({ version: 1, requestId, ok: true, result }))(get(`resource=saves&serverId=${serverId}`))).status, 502);
    assert.deepEqual(parseCampaignPage(page), page);
});

test("campaign selection and reset require a durable request ID, exact fields and a matching result", async () => {
    const select = { action: "select-save", serverId, saveId, expectedUpdatedAt: updatedAt };
    const selected = { serverId, activeSaveId: saveId, updatedAt: "2026-10-02T12:00:01.000Z" };
    const response = await handler(async (_url, init) => {
        assert.equal(new Headers(init?.headers).get("x-request-id"), requestId);
        assert.deepEqual(JSON.parse(String(init?.body)), { version: 1, requestId, operation: "select-save", input: { serverId, saveId, expectedUpdatedAt: updatedAt } });
        return Response.json({ version: 1, requestId, ok: true, result: selected });
    })(post(select));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, selected);
    const reset = { action: "reset-campaign", serverId, expectedUpdatedAt: updatedAt };
    const queued = { outcome: "enqueued", jobId: requestId, action: "reset-campaign" };
    const resetResponse = await handler(async (_url, init) => {
        assert.deepEqual(JSON.parse(String(init?.body)), { version: 1, requestId, operation: "reset-campaign", input: { serverId, expectedUpdatedAt: updatedAt } });
        return Response.json({ version: 1, requestId, ok: true, result: queued });
    })(post(reset));
    assert.equal(resetResponse.status, 200);
    assert.deepEqual((await resetResponse.json()).result, queued);
    let calls = 0;
    const rejecting = handler(async () => { calls++; throw Error("Unexpected fetch"); });
    for (const req of [post(select, false), post(reset, false), post({ ...select, saveId: "nope" }), post({ ...select, expectedUpdatedAt: "yesterday" }),
        post({ ...reset, confirmationText: "yes" }), post({ action: "delete-save", serverId, saveId, expectedUpdatedAt: updatedAt })]) {
        assert.equal((await rejecting(req)).status, 400);
    }
    assert.equal(calls, 0);
    for (const result of [{ ...selected, serverId: requestId }, { ...selected, gamePasswordSecretRef: "leak" }]) {
        assert.equal((await handler(async () => Response.json({ version: 1, requestId, ok: true, result }))(post(select))).status, 502);
    }
    for (const result of [{ ...queued, action: "backup" }, { ...queued, jobId: "nope" }]) {
        assert.equal((await handler(async () => Response.json({ version: 1, requestId, ok: true, result }))(post(reset))).status, 502);
    }
    const conflict = await handler(async () => Response.json({ version: 1, requestId, ok: false, error: { code: "safe_stop_required", message: "Stop the server before starting a new campaign.", retryable: false } }, { status: 409 }))(post(reset));
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, "safe_stop_required");
    assert.deepEqual(parseCampaignMutation(select), select);
    assert.throws(() => parseCampaignMutation({ ...reset, saveId }));
});
