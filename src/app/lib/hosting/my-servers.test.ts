import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../../../../supabase/functions/_shared/my-servers";
import { connectionAddress } from "./connection-address";
import {
    getMyServerBackupStatus,
    listAllMyServerBackups,
    listAllMyServers,
    MyServersApiError,
    requestMyServerBackupOperation,
    requestMyServerOperation,
    requestMyServerUpdate,
    requestServerVisibility,
} from "./my-servers";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const TOKEN = "access-token-with-enough-characters";
const FIRST_SERVER = server("4789e6c3-708e-44d1-ab83-b68c705a6022", "Official EU Campaign");
const BACKUP = {
    backupId: "33333333-3333-4333-8333-333333333333",
    backupType: "manual",
    byteSize: 1_048_576,
    createdAt: "2026-09-02T14:45:07.479Z",
    retentionExpiresAt: "2026-10-02T14:45:07.479Z",
    restoreState: "available",
    restoredAt: null,
    canRestore: true,
};
const SECOND_SERVER = {
    ...server("b62b3f49-61a2-40be-816b-b83dbd0b4fee", "Official US Campaign"),
    accessRole: "support" as const,
    friendlyRegion: "germany" as const,
    operationState: "provisioning" as const,
    observedGameState: "unknown" as const,
    releaseChannel: "nightly" as const,
};

test("loads every owner-scoped managed-server page through the Edge Function", async () => {
    configureEnvironment();
    const requests: Request[] = [];
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const requestId = request.headers.get("x-request-id");
        const cursor = new URL(request.url).searchParams.get("cursor");
        return Response.json({
            version: 1,
            requestId,
            ok: true,
            result: cursor
                ? { items: [SECOND_SERVER], nextCursor: null }
                : { items: [FIRST_SERVER], nextCursor: "next-page" },
        });
    };

    try {
        const result = await listAllMyServers(TOKEN);
        assert.deepEqual(result.map((item) => item.serverId), [FIRST_SERVER.serverId, SECOND_SERVER.serverId]);
        assert.equal(result[0]?.accessRole, "owner");
        assert.deepEqual(Object.keys(result[0] ?? {}).sort(), [
            "accessRole",
            "displayName",
            "friendlyRegion",
            "observedGameState",
            "operationState",
            "releaseChannel",
            "serverId",
            "updatedAt",
        ]);
        assert.equal(requests.length, 2);
        assert.equal(requests[0]?.method, "GET");
        assert.equal(requests[0]?.headers.get("apikey"), "publishable-key-with-enough-characters");
        assert.equal(requests[0]?.headers.get("authorization"), `Bearer ${TOKEN}`);
        assert.equal(new URL(requests[0]?.url ?? "").pathname, "/functions/v1/my-servers");
        assert.equal(new URL(requests[0]?.url ?? "").searchParams.get("limit"), "100");
        assert.equal(new URL(requests[1]?.url ?? "").searchParams.get("cursor"), "next-page");
    } finally {
        restoreEnvironment();
    }
});

test("uses CP #143 connection fields through the authenticated Edge and website client without visibility metadata", async () => {
    configureEnvironment();
    const cases = [
        { accessRole: "owner", connectionIp: "203.0.113.10", gamePorts: [4203], expected: "203.0.113.10:4203" },
        { accessRole: "manager", connectionIp: "203.0.113.20", gamePorts: [4201, 4202], expected: "203.0.113.20:4201" },
        { accessRole: "owner", connectionIp: "2001:db8::1", gamePorts: [4205], expected: "[2001:db8::1]:4205" },
        { accessRole: "owner", connectionIp: null, gamePorts: [], expected: null },
    ];
    try {
        for (const { expected, ...fields } of cases) {
            const summary = { ...FIRST_SERVER, ...fields };
            const edge = createMyServersHandler({
                allowedOrigins: ["https://bannerlordcoop.com"],
                controlPlaneUrl: "https://control-plane.example.test",
                fetchImplementation: async (input, init) => {
                    const request = new Request(input, init);
                    assert.equal(request.url, "https://control-plane.example.test/v1/user/control-plane");
                    assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
                    const body = await request.json();
                    assert.equal(body.operation, "my-servers");
                    assert.deepEqual(body.input, { cursor: null, limit: 100 });
                    return Response.json({ version: 1, requestId: body.requestId, ok: true,
                        result: { items: [summary], nextCursor: null } });
                },
            });
            globalThis.fetch = async (input, init) => {
                const request = new Request(input, init);
                assert.equal(new URL(request.url).pathname, "/functions/v1/my-servers");
                assert.equal(request.cache, "no-store");
                return edge(request);
            };
            const [listed] = await listAllMyServers(TOKEN);
            assert.deepEqual(listed, summary);
            assert.equal(listed.visibility, undefined);
            assert.equal(connectionAddress(listed.connectionIp ?? null, listed.gamePorts ?? []), expected);
        }
    } finally {
        restoreEnvironment();
    }
});

test("accepts CP #144 updated and replay receipts through the Edge and client", async () => {
    configureEnvironment();
    const requestId = "11111111-1111-4111-8111-111111111111";
    const input = { action: "set-server-visibility" as const, serverId: FIRST_SERVER.serverId,
        visibility: "public" as const, expectedUpdatedAt: "2026-09-13T12:00:00.000Z" };
    try {
        for (const outcome of ["updated", "existing"] as const) {
            const result = { outcome, serverId: input.serverId, visibility: input.visibility, updatedAt: "2026-09-13T12:00:01.000Z" };
            const edge = createMyServersHandler({
                allowedOrigins: ["https://bannerlordcoop.com"], controlPlaneUrl: "https://control-plane.example.test",
                fetchImplementation: async (_url, init) => {
                    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
                    assert.deepEqual(JSON.parse(String(init?.body)), { version: 1, requestId,
                        operation: input.action, input: { serverId: input.serverId, visibility: input.visibility, expectedUpdatedAt: input.expectedUpdatedAt } });
                    return Response.json({ version: 1, requestId, ok: true, result });
                },
            });
            globalThis.fetch = async (url, init) => edge(new Request(url, init));
            assert.deepEqual(await requestServerVisibility(TOKEN, input, requestId), result);
        }
    } finally { restoreEnvironment(); }
});

test("loads and validates bounded server-scoped backup pages", async () => {
    configureEnvironment();
    const requests: Request[] = [];
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const requestId = request.headers.get("x-request-id");
        const cursor = new URL(request.url).searchParams.get("cursor");
        return Response.json({
            version: 1,
            requestId,
            ok: true,
            result: cursor
                ? { items: [{ ...BACKUP, backupId: "44444444-4444-4444-8444-444444444444" }], nextCursor: null }
                : { items: [BACKUP], nextCursor: "next-page" },
        });
    };

    try {
        const result = await listAllMyServerBackups(TOKEN, FIRST_SERVER.serverId);
        assert.deepEqual(result.map((item) => item.backupId), [
            BACKUP.backupId,
            "44444444-4444-4444-8444-444444444444",
        ]);
        assert.equal(requests.length, 2);
        const endpoint = new URL(requests[0]?.url ?? "");
        assert.equal(endpoint.searchParams.get("resource"), "backups");
        assert.equal(endpoint.searchParams.get("serverId"), FIRST_SERVER.serverId);
        assert.equal(endpoint.searchParams.get("limit"), "50");
        assert.equal(new URL(requests[1]?.url ?? "").searchParams.get("cursor"), "next-page");
    } finally {
        restoreEnvironment();
    }
});

test("loads a sanitized durable backup-operation status", async () => {
    configureEnvironment();
    let request: Request | undefined;
    globalThis.fetch = async (input, init) => {
        request = new Request(input, init);
        return Response.json({
            version: 1,
            requestId: request.headers.get("x-request-id"),
            ok: true,
            result: {
                serverId: FIRST_SERVER.serverId,
                updatedAt: "2026-09-02T14:46:07.479Z",
                operationState: "maintenance",
                observedGameState: "stopped",
                job: {
                    jobId: "55555555-5555-4555-8555-555555555555",
                    action: "restore",
                    state: "running",
                    progress: "Validating the selected save backup",
                    createdAt: "2026-09-02T14:45:37.479Z",
                    updatedAt: "2026-09-02T14:46:07.479Z",
                },
            },
        });
    };

    try {
        const result = await getMyServerBackupStatus(TOKEN, FIRST_SERVER.serverId);
        assert.equal(result.job?.action, "restore");
        assert.equal(result.job?.state, "running");
        const endpoint = new URL(request?.url ?? "");
        assert.equal(endpoint.searchParams.get("resource"), "backup-status");
        assert.equal(endpoint.searchParams.get("serverId"), FIRST_SERVER.serverId);
    } finally {
        restoreEnvironment();
    }
});

test("submits closed create and restore backup operations", async () => {
    configureEnvironment();
    const requests: Request[] = [];
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const body = JSON.parse(await request.clone().text());
        return Response.json({
            version: 1,
            requestId: request.headers.get("x-request-id"),
            ok: true,
            result: {
                outcome: "enqueued",
                jobId: requests.length === 1
                    ? "55555555-5555-4555-8555-555555555555"
                    : "66666666-6666-4666-8666-666666666666",
                action: body.action === "create-backup" ? "backup" : "restore",
            },
        });
    };

    try {
        const created = await requestMyServerBackupOperation(TOKEN, {
            serverId: FIRST_SERVER.serverId,
            action: "create-backup",
            expectedUpdatedAt: FIRST_SERVER.updatedAt,
        }, "11111111-1111-4111-8111-111111111111");
        const restored = await requestMyServerBackupOperation(TOKEN, {
            serverId: FIRST_SERVER.serverId,
            backupId: BACKUP.backupId,
            action: "restore-backup",
            expectedUpdatedAt: FIRST_SERVER.updatedAt,
        }, "22222222-2222-4222-8222-222222222222");

        assert.equal(created.action, "backup");
        assert.equal(restored.action, "restore");
        assert.deepEqual(JSON.parse(await requests[0]?.text() ?? "{}"), {
            serverId: FIRST_SERVER.serverId,
            action: "create-backup",
            expectedUpdatedAt: FIRST_SERVER.updatedAt,
        });
        assert.deepEqual(JSON.parse(await requests[1]?.text() ?? "{}"), {
            serverId: FIRST_SERVER.serverId,
            backupId: BACKUP.backupId,
            action: "restore-backup",
            expectedUpdatedAt: FIRST_SERVER.updatedAt,
        });
    } finally {
        restoreEnvironment();
    }
});

test("rejects an invalid direct-command server ID before fetch", async () => {
    configureEnvironment();
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response(); };
    try {
        await assert.rejects(requestMyServerOperation(TOKEN, { serverId: "invalid", action: "start" }), { code: "invalid_request" });
        assert.equal(called, false);
    } finally { restoreEnvironment(); }
});

test("rejects private and malformed backup response data", async () => {
    configureEnvironment();
    const invalidItems = [
        { ...BACKUP, serverId: SECOND_SERVER.serverId },
        { ...BACKUP, objectKey: "private/backup-object" },
        { ...BACKUP, createdAt: "2026-09-02T16:45:07.479+02:00" },
        { ...BACKUP, restoreState: "usable" },
        { ...BACKUP, canRestore: "yes" },
    ];

    try {
        for (const item of invalidItems) {
            globalThis.fetch = async (input, init) => {
                const request = new Request(input, init);
                return Response.json({
                    version: 1,
                    requestId: request.headers.get("x-request-id"),
                    ok: true,
                    result: { items: [item], nextCursor: null },
                });
            };
            await assert.rejects(
                listAllMyServerBackups(TOKEN, FIRST_SERVER.serverId),
                (error: unknown) => error instanceof MyServersApiError && error.code === "invalid_response",
            );
        }
    } finally {
        restoreEnvironment();
    }
});

test("rejects malformed or overbroad backup status", async () => {
    configureEnvironment();
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        return Response.json({
            version: 1,
            requestId: request.headers.get("x-request-id"),
            ok: true,
            result: {
                serverId: FIRST_SERVER.serverId,
                updatedAt: "2026-09-02T14:46:07.479Z",
                operationState: "maintenance",
                observedGameState: "stopped",
                job: {
                    jobId: "55555555-5555-4555-8555-555555555555",
                    action: "rollback",
                    state: "running",
                    progress: "Private raw stage",
                    createdAt: "2026-09-02T14:45:37.479Z",
                    updatedAt: "2026-09-02T14:46:07.479Z",
                    requestPayload: { providerResourceId: "private-provider-resource" },
                },
            },
        });
    };

    try {
        await assert.rejects(
            getMyServerBackupStatus(TOKEN, FIRST_SERVER.serverId),
            (error: unknown) => error instanceof MyServersApiError && error.code === "invalid_response",
        );
    } finally {
        restoreEnvironment();
    }
});

test("preserves typed server API errors", async () => {
    configureEnvironment();
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        return Response.json({
            version: 1,
            requestId: request.headers.get("x-request-id"),
            ok: false,
            error: { code: "role_authority_unavailable", message: "Role verification is unavailable.", retryable: true },
        }, { status: 503 });
    };

    try {
        await assert.rejects(
            listAllMyServers(TOKEN),
            (error: unknown) => error instanceof MyServersApiError
                && error.code === "role_authority_unavailable"
                && error.retryable,
        );
    } finally {
        restoreEnvironment();
    }
});

test("rejects duplicate servers across pages", async () => {
    configureEnvironment();
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const cursor = new URL(request.url).searchParams.get("cursor");
        return Response.json({
            version: 1,
            requestId: request.headers.get("x-request-id"),
            ok: true,
            result: { items: [FIRST_SERVER], nextCursor: cursor ? null : "next-page" },
        });
    };

    try {
        await assert.rejects(
            listAllMyServers(TOKEN),
            (error: unknown) => error instanceof MyServersApiError && error.code === "invalid_response",
        );
    } finally {
        restoreEnvironment();
    }
});

function server(serverId: string, displayName: string) {
    return {
        serverId,
        displayName,
        accessRole: "owner" as const,
        friendlyRegion: "united-states",
        operationState: "stopped",
        observedGameState: "stopped",
        releaseChannel: "stable" as const,
        updatedAt: "2026-08-31T20:15:00.000Z",
    };
}

function configureEnvironment() {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key-with-enough-characters";
}

function restoreEnvironment() {
    globalThis.fetch = ORIGINAL_FETCH;
    restoreVariable("NEXT_PUBLIC_SUPABASE_URL", ORIGINAL_URL);
    restoreVariable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ORIGINAL_KEY);
}

function restoreVariable(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

test("direct commands cross the Edge boundary without lifecycle envelopes or retries", async () => {
    configureEnvironment();
    let body: unknown = { ok: true, result: { exitCode: 0 } };
    let status = 200;
    const requests: Request[] = [];
    const handler = createMyServersHandler({
        allowedOrigins: ["https://bannerlordcoop.com"],
        controlPlaneUrl: "https://control-plane.example.test",
        fetchImplementation: async (input, init) => {
            requests.push(new Request(input, init));
            return Response.json(body, { status });
        },
    });
    globalThis.fetch = async (input, init) => handler(new Request(input, init));
    const submit = (action: "start" | "stop" | "restart-game") => requestMyServerOperation(TOKEN, {
        serverId: FIRST_SERVER.serverId, action,
    });
    try {
        for (const action of ["start", "stop", "restart-game"] as const) {
            assert.deepEqual(await submit(action), { exitCode: 0 });
            const request = requests.at(-1)!;
            assert.equal(request.url, `https://control-plane.example.test/api/v1/${action === "restart-game" ? "restart" : action}`);
            assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
            assert.deepEqual(await request.json(), { serverId: FIRST_SERVER.serverId });
        }
        status = 409;
        body = { ok: false, result: { exitCode: 125 }, error: { code: "container_command_failed", message: "Failed", retryable: false } };
        await assert.rejects(submit("restart-game"), { code: "container_command_failed", message: "The container command failed with exit code 125.", retryable: false });
        assert.equal(requests.length, 4);
        body = { ok: false, error: { code: "container_command_unavailable", message: "Not confirmed.", retryable: false } };
        await assert.rejects(submit("start"), { code: "container_command_unavailable", retryable: false });
        for (const invalid of [
            { ok: true, result: { exitCode: 1 } },
            { ok: true, result: { exitCode: 0, stdout: "private" } },
            { ok: false, result: { exitCode: 256 }, error: { code: "container_command_failed" } },
            { ok: true, result: { outcome: "succeeded", jobId: "old-lifecycle" } },
        ]) {
            body = invalid;
            status = invalid.ok ? 200 : 409;
            await assert.rejects(submit("start"), { code: "invalid_response" });
        }
    } finally { restoreEnvironment(); }
});

test("owner updates cross the Edge boundary as one stale-safe durable request", async () => {
    configureEnvironment();
    const requests: Request[] = [];
    const handler = createMyServersHandler({
        allowedOrigins: ["https://bannerlordcoop.com"],
        controlPlaneUrl: "https://control-plane.example.test",
        fetchImplementation: async (input, init) => {
            requests.push(new Request(input, init));
            return Response.json({ version: 1, requestId: "11111111-1111-4111-8111-111111111111", ok: true, result: {
                outcome: "enqueued", jobId: "55555555-5555-4555-8555-555555555555", action: "update",
            } });
        },
    });
    globalThis.fetch = async (input, init) => handler(new Request(input, init));
    try {
        assert.deepEqual(await requestMyServerUpdate(TOKEN, {
            serverId: FIRST_SERVER.serverId,
            expectedUpdatedAt: "2026-09-20T12:00:00.000Z",
        }, "11111111-1111-4111-8111-111111111111"), {
            outcome: "enqueued", jobId: "55555555-5555-4555-8555-555555555555", action: "update",
        });
        assert.deepEqual(await requests[0]?.json(), {
            version: 1,
            requestId: "11111111-1111-4111-8111-111111111111",
            operation: "update-server",
            input: { serverId: FIRST_SERVER.serverId, expectedUpdatedAt: "2026-09-20T12:00:00.000Z" },
        });
    } finally { restoreEnvironment(); }
});
