import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../_shared/my-servers.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "access-token-with-enough-characters";
const ORIGIN = "https://bannerlordcoop.com";

test("allows only configured browser origins", async () => {
    const handler = createHandler(async () => new Response(null, { status: 500 }));
    const allowed = await handler(new Request("https://function.example.test", {
        method: "OPTIONS",
        headers: { origin: ORIGIN, "x-request-id": REQUEST_ID },
    }));
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(allowed.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");

    const denied = await handler(new Request("https://function.example.test", {
        method: "OPTIONS",
        headers: { origin: "https://attacker.example", "x-request-id": REQUEST_ID },
    }));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("routes a bounded list request through my-servers without caller identity fields", async () => {
    let upstreamRequest: Request | undefined;
    const handler = createHandler(async (input, init) => {
        upstreamRequest = new Request(input, init);
        return successEnvelope({ items: [], nextCursor: null });
    });
    const response = await handler(listRequest("?limit=25&cursor=next-page"));
    const body = await response.json();
    const upstreamBody = JSON.parse(await upstreamRequest?.text() ?? "{}");

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(upstreamRequest?.url, "https://control-plane.example.test/v1/user/control-plane");
    assert.equal(upstreamRequest?.method, "POST");
    assert.equal(upstreamRequest?.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(upstreamRequest?.headers.get("x-request-id"), REQUEST_ID);
    assert.equal(upstreamRequest?.headers.get("apikey"), null);
    assert.deepEqual(upstreamBody, {
        version: 1,
        requestId: REQUEST_ID,
        operation: "my-servers",
        input: { cursor: "next-page", limit: 25 },
    });
});

test("routes a direct restart with only serverId and verified bearer identity", async () => {
    let upstreamRequest: Request | undefined;
    const handler = createHandler(async (input, init) => {
        upstreamRequest = new Request(input, init);
        return Response.json({ ok: true, result: { exitCode: 0 } });
    });
    const response = await handler(operationRequest({
        serverId: "22222222-2222-4222-8222-222222222222", action: "restart-game",
    }));
    assert.equal(response.status, 200);
    assert.equal(upstreamRequest?.url, "https://control-plane.example.test/api/v1/restart");
    assert.equal(upstreamRequest?.method, "POST");
    assert.equal(upstreamRequest?.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.deepEqual(await upstreamRequest?.json(), { serverId: "22222222-2222-4222-8222-222222222222" });
    assert.deepEqual(await response.json(), { version: 1, requestId: REQUEST_ID, ok: true, result: { exitCode: 0 } });
});

test("passes a save-in-progress refusal of direct Stop and Restart through unchanged", async () => {
    const error = { code: "save_in_progress", message: "The game is saving right now. Wait a few seconds for the save to finish, then try again.", retryable: true };
    const handler = createHandler(async () => Response.json({ ok: false, error }, { status: 409 }));
    for (const action of ["stop", "restart-game"]) {
        const response = await handler(operationRequest({ serverId: "22222222-2222-4222-8222-222222222222", action }));
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { version: 1, requestId: REQUEST_ID, ok: false, error });
    }
});

test("rejects malformed save-in-progress refusals as invalid responses", async () => {
    const error = { code: "save_in_progress", message: "The game is saving right now.", retryable: true };
    for (const [body, status] of [
        [{ ok: false, error }, 200],
        [{ ok: false, error: { ...error, detail: "private" } }, 409],
        [{ ok: false, error: { ...error, retryable: "yes" } }, 409],
        [{ ok: false, error: { ...error, message: "" } }, 409],
        [{ ok: false, error: { ...error, message: "Saving\u0000" } }, 409],
        [{ ok: false, error, stage: "save" }, 409],
        [{ ok: false, result: { exitCode: 1 }, error }, 409],
    ] as const) {
        const handler = createHandler(async () => Response.json(body, { status }));
        const response = await handler(operationRequest({ serverId: "22222222-2222-4222-8222-222222222222", action: "stop" }));
        assert.equal(response.status, 502);
        assert.equal((await response.json()).error.code, "invalid_response");
    }
});

test("routes update now through the stale-safe owner update operation", async () => {
    let upstreamBody: unknown;
    const handler = createHandler(async (input, init) => {
        upstreamBody = await new Request(input, init).json();
        return successEnvelope({
            outcome: "enqueued", jobId: "55555555-5555-4555-8555-555555555555", action: "update",
        });
    });
    const response = await handler(operationRequest({
        serverId: "22222222-2222-4222-8222-222222222222",
        action: "update-now",
        expectedUpdatedAt: "2026-09-20T12:00:00.000Z",
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(upstreamBody, {
        version: 1,
        requestId: REQUEST_ID,
        operation: "update-server",
        input: {
            serverId: "22222222-2222-4222-8222-222222222222",
            expectedUpdatedAt: "2026-09-20T12:00:00.000Z",
        },
    });
});

test("routes bounded backup history and status requests through closed operations", async () => {
    const upstreamBodies: unknown[] = [];
    const handler = createHandler(async (input, init) => {
        const request = new Request(input, init);
        upstreamBodies.push(JSON.parse(await request.text()));
        return successEnvelope({ items: [], nextCursor: null });
    });

    const backups = await handler(listRequest(
        "?resource=backups&serverId=22222222-2222-4222-8222-222222222222&limit=25&cursor=next-page",
    ));
    const status = await handler(listRequest(
        "?resource=backup-status&serverId=22222222-2222-4222-8222-222222222222",
    ));
    const deletion = await handler(listRequest(
        "?resource=deletion-status&serverId=22222222-2222-4222-8222-222222222222",
    ));

    assert.equal(backups.status, 200);
    assert.equal(status.status, 200);
    assert.equal(deletion.status, 502);
    assert.deepEqual(upstreamBodies, [
        {
            version: 1,
            requestId: REQUEST_ID,
            operation: "server-backups",
            input: {
                serverId: "22222222-2222-4222-8222-222222222222",
                cursor: "next-page",
                limit: 25,
            },
        },
        {
            version: 1,
            requestId: REQUEST_ID,
            operation: "server-backup-status",
            input: { serverId: "22222222-2222-4222-8222-222222222222" },
        },
        {
            version: 1,
            requestId: REQUEST_ID,
            operation: "server-deletion-status",
            input: { serverId: "22222222-2222-4222-8222-222222222222" },
        },
    ]);
});

test("validates a durable deletion status response", async () => {
    const handler = createHandler(async () => successEnvelope({
        serverId: "22222222-2222-4222-8222-222222222222",
        updatedAt: "2026-09-02T14:46:07.479Z",
        operationState: "deletion-pending",
        job: {
            jobId: "55555555-5555-4555-8555-555555555555",
            state: "running",
            progress: "Removing the hosted server safely",
            createdAt: "2026-09-02T14:45:37.479Z",
            updatedAt: "2026-09-02T14:46:07.479Z",
        },
    }));
    const response = await handler(listRequest(
        "?resource=deletion-status&serverId=22222222-2222-4222-8222-222222222222",
    ));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result.job.state, "running");
});

test("maps create and restore requests without forwarding a control-plane method", async () => {
    const upstreamBodies: unknown[] = [];
    const handler = createHandler(async (input, init) => {
        const request = new Request(input, init);
        upstreamBodies.push(JSON.parse(await request.text()));
        return successEnvelope({
            outcome: "enqueued",
            jobId: "55555555-5555-4555-8555-555555555555",
            action: upstreamBodies.length === 1 ? "backup" : "restore",
        });
    });

    const create = await handler(operationRequest({
        serverId: "22222222-2222-4222-8222-222222222222",
        action: "create-backup",
        expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
    }));
    const restore = await handler(operationRequest({
        serverId: "22222222-2222-4222-8222-222222222222",
        backupId: "33333333-3333-4333-8333-333333333333",
        action: "restore-backup",
        expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
    }));

    assert.equal(create.status, 200);
    assert.equal(restore.status, 200);
    assert.deepEqual(upstreamBodies, [
        {
            version: 1,
            requestId: REQUEST_ID,
            operation: "create-backup",
            input: {
                serverId: "22222222-2222-4222-8222-222222222222",
                expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
            },
        },
        {
            version: 1,
            requestId: REQUEST_ID,
            operation: "restore-backup",
            input: {
                serverId: "22222222-2222-4222-8222-222222222222",
                backupId: "33333333-3333-4333-8333-333333333333",
                expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
            },
        },
    ]);
});

test("rejects missing authentication and unsupported inputs before upstream", async () => {
    let calls = 0;
    const handler = createHandler(async () => {
        calls += 1;
        return successEnvelope({ items: [], nextCursor: null });
    });

    const unauthenticated = await handler(new Request("https://function.example.test", {
        headers: { origin: ORIGIN, "x-request-id": REQUEST_ID },
    }));
    assert.equal(unauthenticated.status, 401);

    for (const request of [
        listRequest("?ownerDiscordUserId=192469416892432384"),
        listRequest("?limit=0"),
        listRequest("?limit=101"),
        listRequest("?limit=1&limit=2"),
        listRequest("?cursor=first&cursor=second"),
        listRequest("?cursor="),
        listRequest(`?cursor=${"x".repeat(4_100)}`),
        listRequest("?resource=backups"),
        listRequest("?resource=backups&serverId=22222222-2222-4222-8222-222222222222&limit=51"),
        listRequest("?resource=backups&resource=backup-status&serverId=22222222-2222-4222-8222-222222222222"),
        listRequest("?resource=backup-status&serverId=22222222-2222-4222-8222-222222222222&cursor=forged"),
        listRequest("?resource=server-backups&serverId=22222222-2222-4222-8222-222222222222"),
        listRequest("", "PUT"),
        new Request("https://function.example.test", {
            method: "POST",
            headers: {
                authorization: `Bearer ${TOKEN}`,
                origin: ORIGIN,
                "x-request-id": REQUEST_ID,
            },
            body: "{}",
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "start",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
        }, "?ownerDiscordUserId=192469416892432384"),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "delete",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
        }),
        operationRequest({
            serverId: "not-a-server",
            action: "start",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "stop",
            expectedUpdatedAt: "not-a-time",
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "stop",
            expectedUpdatedAt: "2026-09-02T16:45:07.479+02:00",
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "start",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
            roleIds: ["1286659364455252022"],
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "create-backup",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
            actorDiscordUserId: "192469416892432384",
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            action: "restore-backup",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            backupId: "not-a-backup",
            action: "restore-backup",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
        }),
        operationRequest({
            serverId: "22222222-2222-4222-8222-222222222222",
            backupId: "33333333-3333-4333-8333-333333333333",
            action: "restore-backup",
            expectedUpdatedAt: "2026-09-02T14:45:07.479Z",
            operation: "rollback-server",
        }),
        new Request("https://function.example.test", {
            method: "POST",
            headers: {
                authorization: `Bearer ${TOKEN}`,
                "content-type": "application/json",
                origin: ORIGIN,
                "x-request-id": REQUEST_ID,
            },
            body: "x".repeat(16 * 1_024 + 1),
        }),
    ]) {
        const response = await handler(request);
        assert.ok([400, 405, 413, 414, 415].includes(response.status));
    }
    assert.equal(calls, 0);
});

test("preserves typed control-plane errors", async () => {
    const handler = createHandler(async () => Response.json({
        version: 1,
        requestId: REQUEST_ID,
        ok: false,
        error: {
            code: "role_authority_unavailable",
            message: "Role verification is unavailable.",
            retryable: true,
        },
    }, { status: 503 }));
    const response = await handler(listRequest());
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error.code, "role_authority_unavailable");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("rejects a mismatched control-plane envelope", async () => {
    const handler = createHandler(async () => Response.json({
        version: 1,
        requestId: "22222222-2222-4222-8222-222222222222",
        ok: true,
        result: { items: [], nextCursor: null },
    }));
    const response = await handler(listRequest());
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.error.code, "invalid_response");
});

function createHandler(fetchImplementation: typeof fetch) {
    return createMyServersHandler({
        allowedOrigins: [ORIGIN, "https://bannerlordcoop.netlify.app"],
        controlPlaneUrl: "https://control-plane.example.test",
        waitUntil: () => {},
        fetchImplementation,
    });
}

function successEnvelope(result: unknown) {
    return Response.json({ version: 1, requestId: REQUEST_ID, ok: true, result });
}

test("deletion forwards exact confirmation, generation and required request ID through the closed owner API", async () => {
    const input = { action: "delete-server", serverId: "22222222-2222-4222-8222-222222222222",
        expectedUpdatedAt: "2026-10-07T12:00:00.000Z", confirmationText: "The Northern March" };
    const calls: { url: string; body: unknown }[] = [];
    let leak = false;
    const handler = createHandler(async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return successEnvelope({ outcome: "enqueued", jobId: REQUEST_ID, action: "delete", ...(leak ? { requestPayload: {} } : {}) });
    });
    assert.equal((await handler(operationRequest(input))).status, 200);
    const { action, ...expectedInput } = input;
    assert.equal(action, "delete-server");
    assert.deepEqual(calls[0].body, { version: 1, requestId: REQUEST_ID, operation: "delete-server", input: expectedInput });
    assert.ok(calls[0].url.endsWith("/v1/user/control-plane"));
    for (const invalid of [{ ...input, actor: "owner" }, { ...input, confirmationText: "" }, { ...input, confirmationText: "x".repeat(49) },
        { ...input, confirmationText: undefined }, { ...input, expectedUpdatedAt: "yesterday" }]) {
        assert.equal((await handler(operationRequest(invalid))).status, 400);
    }
    const missingId = operationRequest(input); missingId.headers.delete("x-request-id");
    assert.equal((await handler(missingId)).status, 400); assert.equal(calls.length, 1);
    leak = true; assert.equal((await handler(operationRequest(input))).status, 502);
});

function listRequest(query = "", method = "GET") {
    return new Request(`https://function.example.test${query}`, {
        method,
        headers: {
            authorization: `Bearer ${TOKEN}`,
            origin: ORIGIN,
            "x-request-id": REQUEST_ID,
        },
    });
}

function operationRequest(input: Record<string, unknown>, query = "") {
    return new Request(`https://function.example.test${query}`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${TOKEN}`,
            "content-type": "application/json",
            origin: ORIGIN,
            "x-request-id": REQUEST_ID,
        },
        body: JSON.stringify(input),
    });
}

test("direct commands preserve admission failures and do not retry transport loss", async () => {
    const input = { serverId: "22222222-2222-4222-8222-222222222222", action: "restart-game" };
    for (const status of [401, 403, 404]) {
        const error = { code: status === 404 ? "server_not_found" : "unauthenticated", message: "Access denied.", retryable: false };
        const body = status === 404 ? { ok: false, error } : { version: 1, requestId: REQUEST_ID, ok: false, error };
        const handler = createHandler(async () => Response.json(body, { status }));
        const response = await handler(operationRequest(input));
        assert.equal(response.status, status);
        assert.deepEqual((await response.json()).error, error);
    }
    let calls = 0;
    const handler = createHandler(async () => { calls++; throw new Error("Connection lost"); });
    const response = await handler(operationRequest(input));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "control_plane_unavailable");
    assert.equal(calls, 1);
});

test("hosting settings preserve generation and receipt identity while rejecting unsupported controls", async () => {
    const serverId = "22222222-2222-4222-8222-222222222222";
    const mutation = { serverId, expectedUpdatedAt: "2026-10-01T00:00:00.000Z", patch: { displayName: "Renamed QA", maintenanceSlot: "18:00-19:00" } };
    const input = { action: "save-server-settings", ...mutation };
    const upstream: unknown[] = [];
    let leak = false;
    const handler = createHandler(async (_url, init) => {
        upstream.push(JSON.parse(String(init?.body)));
        return successEnvelope({ outcome: "updated", serverId, updatedAt: "2026-10-01T00:00:01.000Z", ...(leak ? { password: "withheld" } : {}) });
    });
    const response = await handler(operationRequest(input));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.serverId, serverId);
    assert.deepEqual(upstream, [{ version: 1, requestId: REQUEST_ID, operation: "save-server-settings", input: mutation }]);
    for (const invalid of [{ ...input, actor: "owner" }, { ...input, patch: {} }, { ...input, patch: { releaseChannel: "nightly" } },
        { ...input, patch: { configuration: {} } }, { ...input, patch: { timezone: "UTC" } }, { ...input, patch: { maintenanceSlot: "12:00-13:00" } }]) {
        assert.equal((await handler(operationRequest(invalid))).status, 400);
    }
    const missingId = operationRequest(input); missingId.headers.delete("x-request-id");
    assert.equal((await handler(missingId)).status, 400);
    assert.equal(upstream.length, 1);
    leak = true;
    const rejected = await handler(operationRequest(input));
    assert.equal(rejected.status, 502);
    assert.ok(!(await rejected.text()).includes("withheld"));
});

test("website password controls preserve actor, generation and request ID without returning secrets", async () => {
    const input = { action: "set-password", serverId: "22222222-2222-4222-8222-222222222222", expectedUpdatedAt: "2026-09-28T00:00:00.000Z", password: "Private-fixture-password" };
    const upstream: unknown[] = [];
    let leak = false;
    const handler = createHandler(async (_url, init) => {
        upstream.push(JSON.parse(String(init?.body)));
        return successEnvelope({ changed: true, restartQueued: false, ...(leak ? { password: input.password } : {}) });
    });
    const response = await handler(operationRequest(input));
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes(input.password));
    const expectedInput = { serverId: input.serverId, expectedUpdatedAt: input.expectedUpdatedAt, password: input.password };
    assert.deepEqual(upstream, [{ version: 1, requestId: REQUEST_ID, operation: "set-password", input: expectedInput }]);
    for (const invalid of [{ ...input, ownerDiscordUserId: "123456789012345678" }, { ...input, password: "" }, { ...input, expectedUpdatedAt: "yesterday" }]) assert.equal((await handler(operationRequest(invalid))).status, 400);
    assert.equal(upstream.length, 1);
    leak = true;
    const rejected = await handler(operationRequest(input));
    assert.equal(rejected.status, 502);
    assert.ok(!(await rejected.text()).includes(input.password));
});

test("routes autosave generations and earlier-autosave restores through closed operations", async () => {
    const serverId = "22222222-2222-4222-8222-222222222222";
    const saveId = "77777777-7777-4777-8777-777777777777";
    const current = { generation: "current", byteSize: 4_096, lastModifiedAt: "2026-10-16T09:56:00.000Z", observedAt: "2026-10-16T09:58:00.000Z" };
    let generations: unknown = { serverId, saveId, items: [current, { ...current, generation: "backup1" }] };
    let receipt: unknown = { outcome: "enqueued", jobId: "55555555-5555-4555-8555-555555555555", action: "restore" };
    const upstreamBodies: { operation: string }[] = [];
    const handler = createHandler(async (input, init) => {
        const body = JSON.parse(await new Request(input, init).text());
        upstreamBodies.push(body);
        return successEnvelope(body.operation === "server-save-generations" ? generations : receipt);
    });
    const restore = { action: "restore-save-generation", serverId, saveId, generation: "backup1", expectedUpdatedAt: "2026-10-16T09:58:00.000Z" };

    const read = await handler(listRequest(`?resource=save-generations&serverId=${serverId}&saveId=${saveId}`));
    assert.equal(read.status, 200);
    assert.deepEqual((await read.json()).result, generations);
    const restored = await handler(operationRequest(restore));
    assert.equal(restored.status, 200);
    assert.deepEqual((await restored.json()).result, receipt);
    const confirmedAt = "2026-10-16T09:55:00.000Z";
    assert.equal((await handler(operationRequest({ ...restore, expectedLastModifiedAt: confirmedAt }))).status, 200);
    assert.deepEqual(upstreamBodies, [
        { version: 1, requestId: REQUEST_ID, operation: "server-save-generations", input: { serverId, saveId } },
        { version: 1, requestId: REQUEST_ID, operation: "restore-save-generation",
            input: { serverId, saveId, generation: "backup1", expectedUpdatedAt: restore.expectedUpdatedAt } },
        { version: 1, requestId: REQUEST_ID, operation: "restore-save-generation",
            input: { serverId, saveId, generation: "backup1", expectedLastModifiedAt: confirmedAt, expectedUpdatedAt: restore.expectedUpdatedAt } },
    ]);

    // Requests outside the closed shapes never reach the control plane.
    const missingId = operationRequest(restore);
    missingId.headers.delete("x-request-id");
    for (const request of [
        listRequest(`?resource=save-generations&serverId=${serverId}`),
        listRequest(`?resource=save-generations&serverId=${serverId}&saveId=not-a-save`),
        listRequest(`?resource=save-generations&serverId=${serverId}&saveId=${saveId}&saveId=${saveId}`),
        listRequest(`?resource=save-generations&serverId=${serverId}&saveId=${saveId}&generation=backup1`),
        listRequest(`?resource=save-generations&saveId=${saveId}`),
        operationRequest({ ...restore, generation: "current" }),
        operationRequest({ ...restore, generation: "backup3" }),
        operationRequest({ ...restore, generation: undefined }),
        operationRequest({ ...restore, saveId: "not-a-save" }),
        operationRequest({ ...restore, expectedUpdatedAt: "2026-10-16T11:58:00.000+02:00" }),
        operationRequest({ ...restore, backupId: "33333333-3333-4333-8333-333333333333" }),
        operationRequest({ ...restore, actorDiscordUserId: "192469416892432384" }),
        operationRequest({ ...restore, expectedLastModifiedAt: "2026-10-16T09:55:00Z" }),
        operationRequest({ ...restore, expectedLastModifiedAt: null }),
        operationRequest({ ...restore, expectedLastModifiedAt: "yesterday" }),
        missingId,
    ]) assert.equal((await handler(request)).status, 400);
    assert.equal(upstreamBodies.length, 3);

    // Responses that do not match the requested campaign or the closed receipt are withheld.
    for (const invalid of [
        { serverId, saveId: "88888888-8888-4888-8888-888888888888", items: [] },
        { serverId, saveId, items: [{ ...current, generation: "backup2" }, { ...current, generation: "backup1" }] },
        { serverId, saveId, items: [current, current] },
        { serverId, saveId, items: [{ ...current, objectKey: "private/save" }] },
    ]) {
        generations = invalid;
        assert.equal((await handler(listRequest(`?resource=save-generations&serverId=${serverId}&saveId=${saveId}`))).status, 502);
    }
    for (const invalid of [
        { outcome: "enqueued", jobId: "55555555-5555-4555-8555-555555555555", action: "backup" },
        { outcome: "enqueued", jobId: "55555555-5555-4555-8555-555555555555", action: "restore", saveId },
    ]) {
        receipt = invalid;
        assert.equal((await handler(operationRequest(restore))).status, 502);
    }
});

test("relays an autosave precondition failure unchanged", async () => {
    const error = { code: "operation_failed", message: "Stop the game server before restoring an earlier autosave.", retryable: false };
    const handler = createHandler(async () => Response.json({ version: 1, requestId: REQUEST_ID, ok: false, error }, { status: 409 }));
    const response = await handler(operationRequest({
        action: "restore-save-generation", serverId: "22222222-2222-4222-8222-222222222222",
        saveId: "77777777-7777-4777-8777-777777777777", generation: "backup2", expectedUpdatedAt: "2026-10-16T09:58:00.000Z",
    }));
    assert.equal(response.status, 409);
    assert.deepEqual((await response.json()).error, error);
});
