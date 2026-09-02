import assert from "node:assert/strict";
import test from "node:test";
import {
    listAllMyServers,
    MyServersApiError,
} from "./my-servers";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const TOKEN = "access-token-with-enough-characters";
const FIRST_SERVER = server("4789e6c3-708e-44d1-ab83-b68c705a6022", "Official EU Campaign");
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
