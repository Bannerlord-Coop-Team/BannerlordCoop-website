import assert from "node:assert/strict";
import test from "node:test";
import {
    getMyServerBackupStatus,
    listAllMyServerBackups,
    listAllMyServers,
    MyServersApiError,
    requestMyServerBackupOperation,
    requestMyServerOperation,
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

test("submits a correlated strict server operation through the same Edge boundary", async () => {
    configureEnvironment();
    let request: Request | undefined;
    globalThis.fetch = async (input, init) => {
        request = new Request(input, init);
        return Response.json({
            version: 1,
            requestId: request.headers.get("x-request-id"),
            ok: true,
            result: {
                outcome: "enqueued",
                jobId: "55555555-5555-4555-8555-555555555555",
                action: "restart-game",
            },
        });
    };

    try {
        const result = await requestMyServerOperation(TOKEN, {
            serverId: FIRST_SERVER.serverId,
            action: "restart-game",
            expectedUpdatedAt: FIRST_SERVER.updatedAt,
        }, "11111111-1111-4111-8111-111111111111");
        assert.deepEqual(result, {
            outcome: "enqueued",
            jobId: "55555555-5555-4555-8555-555555555555",
            action: "restart-game",
        });
        assert.equal(request?.method, "POST");
        assert.equal(request?.headers.get("content-type"), "application/json");
        assert.equal(request?.headers.get("x-request-id"), "11111111-1111-4111-8111-111111111111");
        assert.deepEqual(JSON.parse(await request?.text() ?? "{}"), {
            serverId: FIRST_SERVER.serverId,
            action: "restart-game",
            expectedUpdatedAt: FIRST_SERVER.updatedAt,
        });
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

test("rejects an operation response containing additional fields", async () => {
    configureEnvironment();
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        return Response.json({
            version: 1,
            requestId: request.headers.get("x-request-id"),
            ok: true,
            result: {
                outcome: "enqueued",
                jobId: "55555555-5555-4555-8555-555555555555",
                action: "start",
                providerResourceId: "private-provider-resource",
            },
        });
    };

    try {
        await assert.rejects(
            requestMyServerOperation(TOKEN, {
                serverId: FIRST_SERVER.serverId,
                action: "start",
                expectedUpdatedAt: FIRST_SERVER.updatedAt,
            }, "11111111-1111-4111-8111-111111111111"),
            (error: unknown) => error instanceof MyServersApiError && error.code === "invalid_response",
        );
    } finally {
        restoreEnvironment();
    }
});

test("rejects an invalid lifecycle idempotency request ID before fetch", async () => {
    configureEnvironment();
    let called = false;
    globalThis.fetch = async () => {
        called = true;
        return new Response();
    };

    try {
        await assert.rejects(
            requestMyServerOperation(TOKEN, {
                serverId: FIRST_SERVER.serverId,
                action: "start",
                expectedUpdatedAt: FIRST_SERVER.updatedAt,
            }, "not-a-request-id"),
            (error: unknown) => error instanceof MyServersApiError && error.code === "invalid_request",
        );
        assert.equal(called, false);
    } finally {
        restoreEnvironment();
    }
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
