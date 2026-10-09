import assert from "node:assert/strict";
import test from "node:test";
import {
    createCreatorTokenProvider, createCreatorTokenRpc, fetchWithCreatorToken, PATREON_TOKEN_URL, staticCreatorToken,
    type CreatorTokenOperation,
} from "./patreon-creator-token.ts";

const bootstrap = { accessToken: "bootstrap-access-token-fixture", refreshToken: "bootstrap-refresh-token-fixture" };
const client = { clientId: "client-id-fixture", clientSecret: "client-secret-fixture" };

// In-memory model of the patreon_creator_token RPC: seed once, lease-guarded rotation, generations.
function store(initial: { accessToken: string; refreshToken: string; refreshDue?: boolean } | null = null) {
    const state = {
        generation: initial ? 1 : 0, accessToken: initial?.accessToken ?? "", refreshToken: initial?.refreshToken ?? "",
        refreshDue: initial?.refreshDue ?? false, lease: null as number | null, failures: [] as string[],
    };
    const calls: { operation: CreatorTokenOperation; input: Record<string, unknown> }[] = [];
    const rpc = async (operation: CreatorTokenOperation, input: Record<string, unknown>) => {
        calls.push({ operation, input });
        if (operation === "read") {
            return state.generation === 0 ? { configured: false, generation: 0 }
                : { configured: true, accessToken: state.accessToken, generation: state.generation, refreshDue: state.refreshDue };
        }
        if (operation === "seed") {
            if (state.generation > 0) return { stale: true, generation: state.generation };
            Object.assign(state, { generation: 1, accessToken: input.accessToken, refreshToken: input.refreshToken, refreshDue: true });
            return { seeded: true, generation: 1 };
        }
        if (input.generation !== state.generation) return { stale: true, generation: state.generation };
        if (operation === "refresh_begin") {
            if (state.lease !== null) return { busy: true };
            state.lease = state.generation;
            return { refreshToken: state.refreshToken, generation: state.generation };
        }
        if (state.lease !== state.generation) return { stale: true, generation: state.generation };
        state.lease = null;
        if (operation === "refresh_failed") { state.failures.push(String(input.reason)); return { recorded: true }; }
        Object.assign(state, { generation: state.generation + 1, accessToken: input.accessToken, refreshToken: input.refreshToken, refreshDue: false });
        return { rotated: true, generation: state.generation };
    };
    return { state, calls, rpc };
}

function patreon(expectRefreshToken: string, issue = { access_token: "rotated-access-token-fixture", refresh_token: "rotated-refresh-token-fixture", expires_in: 2_678_400 }) {
    const requests: URLSearchParams[] = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
        assert.equal(String(input), PATREON_TOKEN_URL);
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "error");
        const body = new URLSearchParams(String(init?.body));
        requests.push(body);
        assert.deepEqual(Object.fromEntries(body), {
            grant_type: "refresh_token", refresh_token: expectRefreshToken, client_id: client.clientId, client_secret: client.clientSecret,
        });
        return Response.json(issue);
    };
    return { requests, fetchImplementation };
}

test("static provider returns the fixed token and never offers a replacement", async () => {
    const provider = staticCreatorToken("fixed-creator-token-fixture");
    assert.equal(await provider.current(), "fixed-creator-token-fixture");
    assert.equal(await provider.replace("fixed-creator-token-fixture"), null);
    assert.throws(() => staticCreatorToken("short"));
    assert.throws(() => staticCreatorToken("has whitespace inside the token"));
});

test("first use seeds the store from the function secrets and rotates immediately because expiry is unknown", async () => {
    const { state, calls, rpc } = store();
    const { requests, fetchImplementation } = patreon(bootstrap.refreshToken);
    const logs: string[] = [];
    const provider = createCreatorTokenProvider({ ...client, bootstrap, rpc, fetchImplementation, log: (m) => logs.push(m) });
    assert.equal(await provider.current(), "rotated-access-token-fixture");
    assert.deepEqual(calls.map((c) => c.operation), ["read", "seed", "read", "refresh_begin", "refresh_commit"]);
    assert.deepEqual(calls[1].input, bootstrap);
    assert.equal(requests.length, 1);
    assert.equal(state.generation, 2);
    assert.equal(state.refreshToken, "rotated-refresh-token-fixture");
    assert.deepEqual(logs, []);
    // The rotated token is cached briefly; no further store reads for the next call.
    assert.equal(await provider.current(), "rotated-access-token-fixture");
    assert.equal(calls.length, 5);
});

test("a stored token that is not due is used without touching Patreon", async () => {
    const { calls, rpc } = store({ accessToken: "stored-access-token-fixture", refreshToken: "stored-refresh-token-fixture" });
    const provider = createCreatorTokenProvider({ ...client, bootstrap, rpc, fetchImplementation: async () => { throw new Error("must not refresh"); } });
    assert.equal(await provider.current(), "stored-access-token-fixture");
    assert.deepEqual(calls.map((c) => c.operation), ["read"]);
});

test("a 401 replaces the token once through the refresh token and retries the request", async () => {
    const { state, rpc } = store({ accessToken: "stored-access-token-fixture", refreshToken: "stored-refresh-token-fixture" });
    const { fetchImplementation: tokenEndpoint } = patreon("stored-refresh-token-fixture");
    const seen: string[] = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
        if (String(input) === PATREON_TOKEN_URL) return tokenEndpoint(input, init);
        const token = new Headers(init?.headers).get("authorization") ?? "";
        seen.push(token);
        return token === "Bearer rotated-access-token-fixture" ? Response.json({ ok: true }) : new Response(null, { status: 401 });
    };
    const provider = createCreatorTokenProvider({ ...client, bootstrap, rpc, fetchImplementation });
    const response = await fetchWithCreatorToken(provider, fetchImplementation, new URL("https://www.patreon.com/api/oauth2/v2/campaigns/1/members"), {
        headers: { "user-agent": "test" }, redirect: "error",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(seen, ["Bearer stored-access-token-fixture", "Bearer rotated-access-token-fixture"]);
    assert.equal(state.generation, 2);
    // A rejection that cannot be repaired is returned as-is: one retry per request, never a loop.
    const rejecting: typeof fetch = async (input) => new Response(null, { status: String(input) === PATREON_TOKEN_URL ? 400 : 401 });
    const stuck = createCreatorTokenProvider({ ...client, bootstrap, rpc, fetchImplementation: rejecting });
    const again = await fetchWithCreatorToken(stuck, rejecting, new URL("https://www.patreon.com/api/oauth2/v2/members/x"), { headers: {} });
    assert.equal(again.status, 401);
    assert.deepEqual(state.failures, ["rejected"]);
    assert.equal(state.generation, 2);
});

test("a token already rotated by another worker is adopted without spending the refresh token", async () => {
    const { calls, rpc } = store({ accessToken: "newer-access-token-fixture", refreshToken: "stored-refresh-token-fixture" });
    const provider = createCreatorTokenProvider({ ...client, bootstrap, rpc, fetchImplementation: async () => { throw new Error("must not refresh"); } });
    assert.equal(await provider.replace("older-access-token-fixture"), "newer-access-token-fixture");
    assert.deepEqual(calls.map((c) => c.operation), ["read"]);
});

test("rejected, unavailable, malformed and busy refreshes keep the current token and record the outcome", async () => {
    for (const [reply, failure] of [
        [new Response(null, { status: 400 }), "rejected"],
        [new Response(null, { status: 401 }), "rejected"],
        [new Response(null, { status: 503 }), "unavailable"],
        [Response.json({ access_token: "x", refresh_token: "y" }), "unavailable"],
        [Response.json({ access_token: "same-token-value-fixture", refresh_token: "same-token-value-fixture", expires_in: 100 }), "unavailable"],
        [Response.json({ access_token: "rotated-access-token-fixture", refresh_token: "rotated-refresh-token-fixture", expires_in: 10 }), "unavailable"],
        [new Response("<html>", { headers: { "content-type": "text/html" } }), "unavailable"],
        [null, "unavailable"],
    ] as const) {
        const { state, rpc } = store({ accessToken: "stored-access-token-fixture", refreshToken: "stored-refresh-token-fixture", refreshDue: true });
        const logs: string[] = [];
        const provider = createCreatorTokenProvider({ ...client, bootstrap, rpc, log: (m) => logs.push(m),
            fetchImplementation: async () => { if (reply === null) throw new Error("network down: secret"); return reply; } });
        assert.equal(await provider.current(), "stored-access-token-fixture");
        assert.deepEqual(state.failures, [failure]);
        assert.equal(state.generation, 1);
        assert.equal(state.lease, null);
        assert.deepEqual(logs, [failure === "rejected" ? "Patreon creator token refresh rejected" : "Patreon creator token refresh unavailable"]);
        assert.ok(logs.every((line) => !line.includes("secret") && !line.includes("token-fixture")));
    }
    const busy = store({ accessToken: "stored-access-token-fixture", refreshToken: "stored-refresh-token-fixture", refreshDue: true });
    busy.state.lease = 1;
    const provider = createCreatorTokenProvider({ ...client, bootstrap, rpc: busy.rpc, fetchImplementation: async () => { throw new Error("must not refresh"); } });
    assert.equal(await provider.current(), "stored-access-token-fixture");
    assert.equal(await provider.replace("stored-access-token-fixture"), null);
    assert.deepEqual(busy.state.failures, []);
});

test("an unreachable store falls back to the bootstrap secret instead of failing the worker", async () => {
    const logs: string[] = [];
    const provider = createCreatorTokenProvider({ ...client, bootstrap, log: (m) => logs.push(m),
        rpc: async () => { throw new Error("creator_token_rpc_failed"); }, fetchImplementation: async () => { throw new Error("must not refresh"); } });
    assert.equal(await provider.current(), bootstrap.accessToken);
    assert.equal(await provider.replace(bootstrap.accessToken), null);
    assert.deepEqual(logs, ["Patreon creator token store unavailable; using bootstrap token"]);
});

test("bootstrap and client credentials are validated and distinct", () => {
    const rpc = async () => ({ configured: false, generation: 0 });
    assert.throws(() => createCreatorTokenProvider({ ...client, bootstrap: { accessToken: "short", refreshToken: bootstrap.refreshToken }, rpc }));
    assert.throws(() => createCreatorTokenProvider({ ...client, bootstrap: { accessToken: bootstrap.accessToken, refreshToken: bootstrap.accessToken }, rpc }));
    assert.throws(() => createCreatorTokenProvider({ clientId: "same-value", clientSecret: "same-value", bootstrap, rpc }));
});

test("RPC adapter only calls the fixed service-role function and never exposes failures bodies", async () => {
    const rpc = createCreatorTokenRpc({
        supabaseUrl: "https://project.supabase.co", serviceKey: "fixture-service-role-key-value",
        fetchImplementation: async (url, init) => {
            assert.equal(String(url), "https://project.supabase.co/rest/v1/rpc/patreon_creator_token");
            assert.equal(init?.redirect, "error");
            assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-service-role-key-value");
            const body = JSON.parse(String(init?.body));
            if (body.p_operation === "read") return Response.json({ configured: false, generation: 0 });
            return Response.json({ message: "secret detail" }, { status: 500 });
        },
    });
    assert.deepEqual(await rpc("read", {}), { configured: false, generation: 0 });
    await assert.rejects(rpc("seed", {}), { message: "creator_token_rpc_failed" });
    assert.throws(() => createCreatorTokenRpc({ supabaseUrl: "http://project.supabase.co", serviceKey: "fixture-service-role-key-value" }));
    assert.throws(() => createCreatorTokenRpc({ supabaseUrl: "https://project.supabase.co/path", serviceKey: "fixture-service-role-key-value" }));
});
