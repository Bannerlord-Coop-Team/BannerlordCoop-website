import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../_shared/my-servers.ts";
import { parseBuildChangeResult, parseBuildMutation, parseBuildOptions, parseBuildStatus } from "../_shared/server-build-contract.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SERVER_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "access-token-with-enough-characters";
const ORIGIN = "https://bannerlordcoop.com";
const UPDATED_AT = "2026-10-30T12:00:00.000Z";

const option = (buildId: string, extra: Record<string, unknown> = {}) => ({
    buildId, version: buildId, isLatest: false, isInstalled: false, isPinned: false, direction: "older",
    saveCompatibility: "unverified", requiresSaveAcknowledgement: true, ...extra,
});
const options = () => ({
    serverId: SERVER_ID, updatedAt: UPDATED_AT, releaseChannel: "stable", selectable: true, unavailableReason: null,
    installedVersion: "0.1.10", pinnedVersion: null, latestVersion: "0.1.10",
    options: [option("0.1.10", { isLatest: true, isInstalled: true, direction: "same", requiresSaveAcknowledgement: false }), option("0.1.9")],
});
const steps = (states: string[]) => ["queued", "stopping", "backup", "installing", "starting", "verifying"].map((id, index) => ({ id, state: states[index] }));
const job = (extra: Record<string, unknown> = {}) => ({
    jobId: JOB_ID, state: "running", initiatedBy: "owner", ownerSelected: true, phase: "backup",
    steps: steps(["done", "done", "active", "pending", "pending", "pending"]), completedSteps: 2, totalSteps: 6,
    targetVersion: "0.1.9", previousVersion: "0.1.10", progress: "Creating a safe restore point", backup: null, rolledBack: false,
    failureCode: null, failureMessage: null, nextStep: null, attemptCount: 1, maximumAttempts: 3, nextRetryAt: null,
    createdAt: UPDATED_AT, updatedAt: UPDATED_AT, completedAt: null, ...extra,
});

test("parses the closed version-selection contract and rejects anything else", () => {
    assert.equal(parseBuildOptions(options(), SERVER_ID).options.length, 2);
    assert.throws(() => parseBuildOptions({ ...options(), extra: true }, SERVER_ID));
    assert.throws(() => parseBuildOptions(options(), "44444444-4444-4444-8444-444444444444"));
    // A tag this website cannot select is skipped alone; the other versions stay offered.
    const mixed = parseBuildOptions({ ...options(), options: [option("0.1.9"), option("1234567.0.0"), option("latest")] }, SERVER_ID);
    assert.deepEqual(mixed.options.map((entry) => entry.buildId), ["0.1.9"]);
    // The bound is six digits per component on both sides: the largest such tag is kept, one digit more is skipped.
    assert.deepEqual(parseBuildOptions({ ...options(), options: [option("999999.999999.999999"), option("1000000.0.0")] }, SERVER_ID).options.map((entry) => entry.buildId), ["999999.999999.999999"]);
    assert.throws(() => parseBuildOptions({ ...options(), options: [{ ...option("0.1.9"), extra: 1 }, option("0.1.8")] }, SERVER_ID));
    assert.throws(() => parseBuildOptions({ ...options(), options: [option("0.1.9"), option("0.1.9")] }, SERVER_ID));
    assert.throws(() => parseBuildOptions({ ...options(), selectable: false }, SERVER_ID));
    assert.deepEqual(parseBuildOptions({ ...options(), selectable: false, unavailableReason: "nightly-channel", options: [] }, SERVER_ID).options, []);
    assert.throws(() => parseBuildOptions({ ...options(), options: [{ ...option("0.1.9"), extra: 1 }] }, SERVER_ID));

    assert.equal(parseBuildStatus({ serverId: SERVER_ID, job: null }, SERVER_ID).job, null);
    assert.equal(parseBuildStatus({ serverId: SERVER_ID, job: job() }, SERVER_ID).job?.phase, "backup");
    assert.equal(parseBuildStatus({ serverId: SERVER_ID, job: job({ backup: { backupId: JOB_ID }, state: "failed", phase: "failed", failureCode: "update_rolled_back", failureMessage: "No change.", nextStep: "Try again." }) }, SERVER_ID).job?.backup?.backupId, JOB_ID);
    for (const bad of [{ extra: 1 }, { phase: "unknown" }, { steps: steps(["done"]).slice(0, 2) }, { completedSteps: 9 }, { progress: "bad\u0000" },
        { backup: { backupId: "x" } }, { state: "paused" }, { steps: steps(["done", "done", "active", "pending", "pending", "weird"]) }]) {
        assert.throws(() => parseBuildStatus({ serverId: SERVER_ID, job: job(bad) }, SERVER_ID), JSON.stringify(Object.keys(bad)));
    }

    assert.deepEqual(parseBuildChangeResult({ outcome: "pinned", jobId: null, action: "update" }), { outcome: "pinned", jobId: null, action: "update" });
    assert.equal(parseBuildChangeResult({ outcome: "enqueued", jobId: JOB_ID, action: "update" }).jobId, JOB_ID);
    assert.throws(() => parseBuildChangeResult({ outcome: "enqueued", jobId: null, action: "update" }));
    assert.throws(() => parseBuildChangeResult({ outcome: "pinned", jobId: JOB_ID, action: "update" }));

    const mutation = { action: "set-server-build", serverId: SERVER_ID, buildId: "0.1.9", expectedUpdatedAt: UPDATED_AT, acknowledgeSaveRisk: true };
    assert.equal(parseBuildMutation(mutation).buildId, "0.1.9");
    assert.equal(parseBuildMutation({ ...mutation, buildId: null }).buildId, null);
    for (const bad of [{ buildId: "latest" }, { buildId: "v1.2" }, { buildId: "ghcr-stable-" + "a".repeat(64) }, { acknowledgeSaveRisk: "yes" }, { expectedUpdatedAt: "yesterday" }, { extra: 1 }]) {
        assert.throws(() => parseBuildMutation({ ...mutation, ...bad }));
    }
});

test("customers see bare versions; either spelling is accepted and names the same version", () => {
    // The control plane may still spell versions with the registry's v; the website shows and sends 0.1.6 only.
    const tagged = parseBuildOptions({ ...options(), installedVersion: "v0.1.10", latestVersion: "V0.1.10", pinnedVersion: "v0.1.9",
        options: [option("v0.1.10", { isLatest: true, isInstalled: true, version: "v0.1.10" }), option("0.1.9", { isPinned: true })] }, SERVER_ID);
    assert.deepEqual([tagged.installedVersion, tagged.latestVersion, tagged.pinnedVersion], ["0.1.10", "0.1.10", "0.1.9"]);
    assert.deepEqual(tagged.options.map((entry) => [entry.buildId, entry.version]), [["0.1.10", "0.1.10"], ["0.1.9", "0.1.9"]]);
    // A spelling collision is one version offered twice, which is refused.
    assert.throws(() => parseBuildOptions({ ...options(), options: [option("v0.1.9"), option("0.1.9")] }, SERVER_ID));
    const status = parseBuildStatus({ serverId: SERVER_ID, job: job({ targetVersion: "v0.1.9", previousVersion: "v0.1.10" }) }, SERVER_ID);
    assert.deepEqual([status.job?.targetVersion, status.job?.previousVersion], ["0.1.9", "0.1.10"]);
    const mutation = { action: "set-server-build", serverId: SERVER_ID, expectedUpdatedAt: UPDATED_AT, acknowledgeSaveRisk: false };
    for (const spelling of ["0.1.9", "v0.1.9", "V0.1.9"]) assert.equal(parseBuildMutation({ ...mutation, buildId: spelling }).buildId, "0.1.9");
    for (const bad of ["v", "0.1", "vv0.1.9", "0.1.9-rc1", " 0.1.9", "1234567.0.0"]) assert.throws(() => parseBuildMutation({ ...mutation, buildId: bad }), bad);
});

test("relays the build reads through their fixed routes and validates the responses", async () => {
    const calls: unknown[] = [];
    let status: unknown = { serverId: SERVER_ID, job: job() };
    const handler = createHandler(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { operation: string };
        calls.push(body);
        return successEnvelope(body.operation === "server-build-options" ? options() : status);
    });
    const read = await handler(listRequest(`?resource=build-options&serverId=${SERVER_ID}`));
    assert.equal(read.status, 200);
    assert.deepEqual(calls[0], { version: 1, requestId: REQUEST_ID, operation: "server-build-options", input: { serverId: SERVER_ID } });
    assert.equal((await handler(listRequest(`?resource=build-status&serverId=${SERVER_ID}`))).status, 200);
    assert.deepEqual(calls[1], { version: 1, requestId: REQUEST_ID, operation: "server-build-status", input: { serverId: SERVER_ID } });
    assert.equal((await handler(listRequest(`?resource=build-options&serverId=${SERVER_ID}&extra=1`))).status, 400);
    assert.equal((await handler(listRequest("?resource=build-options&serverId=nope"))).status, 400);
    status = { serverId: SERVER_ID, job: job({ unexpected: true }) };
    assert.equal((await handler(listRequest(`?resource=build-status&serverId=${SERVER_ID}`))).status, 502);
});

test("relays a version choice with the caller's request ID and refuses malformed or incomplete ones", async () => {
    const calls: { body: unknown }[] = [];
    let result: unknown = { outcome: "enqueued", jobId: JOB_ID, action: "update" };
    const handler = createHandler(async (_url, init) => { calls.push({ body: JSON.parse(String(init?.body)) }); return successEnvelope(result); });
    const input = { action: "set-server-build", serverId: SERVER_ID, buildId: "0.1.9", expectedUpdatedAt: UPDATED_AT, acknowledgeSaveRisk: true };
    assert.equal((await handler(operationRequest(input))).status, 200);
    assert.deepEqual(calls[0].body, { version: 1, requestId: REQUEST_ID, operation: "set-server-build",
        input: { serverId: SERVER_ID, buildId: "0.1.9", expectedUpdatedAt: UPDATED_AT, acknowledgeSaveRisk: true } });
    // Latest is an explicit null, never an omitted field.
    assert.equal((await handler(operationRequest({ ...input, buildId: null, acknowledgeSaveRisk: false }))).status, 200);
    assert.equal((calls[1].body as { input: { buildId: unknown } }).input.buildId, null);
    for (const invalid of [{ ...input, buildId: "latest" }, { ...input, buildId: undefined }, { ...input, extra: 1 }, { ...input, actor: "owner" }, { ...input, acknowledgeSaveRisk: undefined }]) {
        assert.equal((await handler(operationRequest(invalid))).status, 400);
    }
    const missingId = operationRequest(input); missingId.headers.delete("x-request-id");
    assert.equal((await handler(missingId)).status, 400);
    assert.equal(calls.length, 2);
    result = { outcome: "pinned", jobId: JOB_ID, action: "update" };
    assert.equal((await handler(operationRequest(input))).status, 502);
    result = { outcome: "pinned", jobId: null, action: "update" };
    assert.equal((await handler(operationRequest(input))).status, 200);
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
