import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../_shared/my-servers.ts";
import { parseBuildStatus } from "../_shared/server-build-contract.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SERVER_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "access-token-with-enough-characters";
const ORIGIN = "https://bannerlordcoop.com";
const UPDATED_AT = "2026-10-30T12:00:00.000Z";

const steps = (states: string[]) => ["queued", "stopping", "backup", "installing", "starting", "verifying"].map((id, index) => ({ id, state: states[index] }));
const job = (extra: Record<string, unknown> = {}) => ({
    jobId: JOB_ID, state: "running", initiatedBy: "owner", ownerSelected: true, phase: "backup",
    steps: steps(["done", "done", "active", "pending", "pending", "pending"]), completedSteps: 2, totalSteps: 6,
    targetVersion: "0.1.9", previousVersion: "0.1.10", progress: "Creating a safe restore point", backup: null, rolledBack: false,
    failureCode: null, failureMessage: null, nextStep: null, attemptCount: 1, maximumAttempts: 3, nextRetryAt: null,
    createdAt: UPDATED_AT, updatedAt: UPDATED_AT, completedAt: null, ...extra,
});

test("parses the closed update-progress contract and rejects anything else", () => {
    assert.equal(parseBuildStatus({ serverId: SERVER_ID, job: null }, SERVER_ID).job, null);
    assert.equal(parseBuildStatus({ serverId: SERVER_ID, job: job() }, SERVER_ID).job?.phase, "backup");
    // A current control plane adds durable receipt timestamps; an older response without them remains valid.
    const timestamped = parseBuildStatus({ serverId: SERVER_ID, job: job({ steps: steps(["done", "done", "active", "pending", "pending", "pending"]).map((step, index) => ({
        ...step, startedAt: index < 2 ? UPDATED_AT : null, completedAt: index < 2 ? UPDATED_AT : null,
    })) }) }, SERVER_ID);
    assert.deepEqual(timestamped.job?.steps[0], { id: "queued", state: "done", startedAt: UPDATED_AT, completedAt: UPDATED_AT });
    assert.deepEqual(timestamped.job?.steps[2], { id: "backup", state: "active", startedAt: null, completedAt: null });
    assert.equal(parseBuildStatus({ serverId: SERVER_ID, job: job({ backup: { backupId: JOB_ID }, state: "failed", phase: "failed", failureCode: "update_rolled_back", failureMessage: "No change.", nextStep: "Try again." }) }, SERVER_ID).job?.backup?.backupId, JOB_ID);
    for (const bad of [{ extra: 1 }, { phase: "unknown" }, { steps: steps(["done"]).slice(0, 2) }, { completedSteps: 9 }, { progress: "bad\u0000" },
        { backup: { backupId: "x" } }, { state: "paused" }, { steps: steps(["done", "done", "active", "pending", "pending", "weird"]) },
        { steps: steps(["done", "done", "active", "pending", "pending", "pending"]).map(step => ({ ...step, startedAt: "yesterday", completedAt: null })) }]) {
        assert.throws(() => parseBuildStatus({ serverId: SERVER_ID, job: job(bad) }, SERVER_ID), JSON.stringify(Object.keys(bad)));
    }
});

test("customers see bare versions in update progress", () => {
    // The control plane may still spell versions with the registry's v; the website shows 0.1.6 only.
    const status = parseBuildStatus({ serverId: SERVER_ID, job: job({ targetVersion: "v0.1.9", previousVersion: "v0.1.10" }) }, SERVER_ID);
    assert.deepEqual([status.job?.targetVersion, status.job?.previousVersion], ["0.1.9", "0.1.10"]);
});

test("relays the update-progress read through its fixed route and validates the response", async () => {
    const calls: unknown[] = [];
    let status: unknown = { serverId: SERVER_ID, job: job() };
    const handler = createHandler(async (_url, init) => { calls.push(JSON.parse(String(init?.body))); return successEnvelope(status); });
    assert.equal((await handler(listRequest(`?resource=build-status&serverId=${SERVER_ID}`))).status, 200);
    assert.deepEqual(calls, [{ version: 1, requestId: REQUEST_ID, operation: "server-build-status", input: { serverId: SERVER_ID } }]);
    assert.equal((await handler(listRequest(`?resource=build-status&serverId=${SERVER_ID}&extra=1`))).status, 400);
    assert.equal((await handler(listRequest("?resource=build-status&serverId=nope"))).status, 400);
    status = { serverId: SERVER_ID, job: job({ unexpected: true }) };
    assert.equal((await handler(listRequest(`?resource=build-status&serverId=${SERVER_ID}`))).status, 502);
});

test("never relays the retired version selection to the control plane", async () => {
    // ControlPlane #1125 retired server-build-options and set-server-build: servers follow their channel's current build.
    const calls: unknown[] = [];
    const handler = createHandler(async (_url, init) => { calls.push(init?.body); return successEnvelope(null); });
    assert.equal((await handler(listRequest(`?resource=build-options&serverId=${SERVER_ID}`))).status, 400);
    for (const buildId of ["0.1.9", null]) {
        const choice = { action: "set-server-build", serverId: SERVER_ID, buildId, expectedUpdatedAt: UPDATED_AT, acknowledgeSaveRisk: true };
        assert.equal((await handler(operationRequest(choice))).status, 400);
    }
    assert.deepEqual(calls, []);
});

function createHandler(fetchImplementation: typeof fetch) {
    return createMyServersHandler({
        allowedOrigins: [ORIGIN], controlPlaneUrl: "https://control-plane.example.test", waitUntil: () => {}, fetchImplementation,
    });
}

function successEnvelope(result: unknown) {
    return Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result });
}

function listRequest(query: string) {
    return new Request(`https://function.example.test${query}`, {
        method: "GET", headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, "x-request-id": REQUEST_ID },
    });
}

function operationRequest(input: Record<string, unknown>) {
    return new Request("https://function.example.test", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", origin: ORIGIN, "x-request-id": REQUEST_ID },
        body: JSON.stringify(input),
    });
}
