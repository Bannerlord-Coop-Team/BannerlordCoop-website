import assert from "node:assert/strict";
import { test } from "node:test";
import { createPatreonHandler, type PatreonConfig } from "./patreon.ts";

type State = { operation_id?: string; expected_generation?: number; return_path?: string; evidence?: unknown; token_hash: string; kind: string; user_id: string; expires_at: string; patreon_user_id?: string };

function fixture() {
    const states: State[] = [];
    const accounts: { user_id: string; patreon_user_id: string }[] = [];
    const receipts = new Map<string, { userId: string; result: unknown }>();
    let tokenExchanges = 0;
    let failExchange = false;
    const config: PatreonConfig = {
        supabaseUrl: "https://project.supabase.co", serviceRoleKey: "service-secret",
        clientId: "client-id", clientSecret: "client-secret",
        redirectUri: "https://project.supabase.co/functions/v1/patreon-callback",
        siteUrl: "https://website.example",
        fetch: async (input, init) => {
            const url = new URL(String(input));
            const headers = new Headers(init?.headers);
            if (url.pathname === "/auth/v1/user") {
                const auth = headers.get("Authorization");
                return auth === "Bearer user-a" || auth === "Bearer user-b"
                    ? Response.json({ id: auth.slice(7), identities: [] }) : new Response("Unauthorized", { status: 401 });
            }
            if (url.pathname.startsWith("/rest/v1/")) {
                assert.equal(headers.get("Authorization"), "Bearer service-secret");
                if (url.pathname.endsWith("rpc/membership_begin")) {
                    const body = JSON.parse(String(init?.body));
                    states.push({ token_hash: body.p_token_hash, user_id: body.p_account_id, kind: "ticket", expires_at: new Date(Date.now()+600000).toISOString(), operation_id: body.p_operation_id, expected_generation: 0, return_path: body.p_return_path });
                    return Response.json({ started: true });
                }
                if (url.pathname.endsWith("rpc/membership_complete")) {
                    const body = JSON.parse(String(init?.body));
                    const receipt = receipts.get(body.p_token_hash);
                    if (receipt) return receipt.userId === body.p_account_id ? Response.json(receipt.result) : new Response("conflict", { status: 409 });
                    const row = states.find(s => s.token_hash === body.p_token_hash && s.kind === "complete" && s.user_id === body.p_account_id && Date.parse(s.expires_at) > Date.now());
                    if (!row || accounts.some(a => a.patreon_user_id === row.patreon_user_id && a.user_id !== row.user_id)) return new Response("conflict", { status: 409 });
                    accounts.push({ user_id: row.user_id, patreon_user_id: row.patreon_user_id! });
                    const result = { linked: true, operationId: row.operation_id, returnPath: row.return_path };
                    receipts.set(body.p_token_hash, { userId: row.user_id, result }); states.splice(states.indexOf(row),1);
                    return Response.json(result);
                }
                if (url.pathname.endsWith("patreon_oauth_states")) {
                    if (init?.method === "POST") {
                        states.push(JSON.parse(String(init.body)));
                        return Response.json([]);
                    }
                    assert.equal(init?.method, "DELETE");
                    const matched = states.filter((row) => [...url.searchParams].every(([key, condition]) => {
                        const value = row[key as keyof State] ?? "";
                        if (condition.startsWith("eq.")) return value === condition.slice(3);
                        if (condition.startsWith("gt.")) return value > condition.slice(3);
                        if (condition.startsWith("lt.")) return value < condition.slice(3);
                        throw new Error("Unknown filter");
                    }));
                    for (const row of matched) states.splice(states.indexOf(row), 1);
                    return Response.json(matched);
                }
                if (url.pathname.endsWith("patreon_accounts")) {
                    const account = JSON.parse(String(init?.body));
                    if (accounts.some((row) => row.patreon_user_id === account.patreon_user_id && row.user_id !== account.user_id)) {
                        return new Response("unique constraint details", { status: 409 });
                    }
                    const existing = accounts.findIndex((row) => row.user_id === account.user_id);
                    if (existing >= 0) accounts.splice(existing, 1);
                    accounts.push(account);
                    return Response.json([account]);
                }
            }
            if (url.href === "https://www.patreon.com/api/oauth2/token") {
                tokenExchanges++;
                const body = new URLSearchParams(String(init?.body));
                assert.equal(body.get("client_secret"), "client-secret");
                assert.equal(body.get("redirect_uri"), config.redirectUri);
                return failExchange ? new Response("sensitive provider error", { status: 400 }) : Response.json({ access_token: "patreon-secret" });
            }
            if (url.pathname === "/api/oauth2/v2/identity") {
                assert.equal(headers.get("Authorization"), "Bearer patreon-secret");
                return Response.json({ data: { type: "user", id: "123" } });
            }
            throw new Error(`Unexpected request: ${url}`);
        },
    };
    const start = createPatreonHandler(config, "start");
    const callback = createPatreonHandler(config, "callback");
    const complete = createPatreonHandler(config, "complete");
    async function begin() {
        const response = await start(new Request("https://project.supabase.co/functions/v1/patreon-start", {
            method: "POST", headers: { Authorization: "Bearer user-a", "Content-Type": "application/json" }, body: JSON.stringify({ returnPath: "/servers" }),
        }));
        assert.equal(response.status, 200);
        const { url } = await response.json();
        const authorize = await callback(new Request(url));
        assert.equal(authorize.status, 303);
        const location = new URL(authorize.headers.get("Location")!);
        assert.equal(location.origin, "https://www.patreon.com");
        assert.equal(location.searchParams.get("scope"), "identity identity.memberships");
        const cookie = authorize.headers.get("Set-Cookie")!;
        assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
        return { state: location.searchParams.get("state")!, cookie: cookie.split(";")[0], ticketUrl: url };
    }
    function returnFromPatreon(state: string, cookie: string, extra = "code=code-123") {
        return callback(new Request(`${config.redirectUri}?state=${state}&${extra}`, { headers: { Cookie: cookie } }));
    }
    function finish(token: string, user = "user-a") {
        return complete(new Request("https://project.supabase.co/functions/v1/patreon-complete", {
            method: "POST", headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        }));
    }
    return { start, callback, begin, returnFromPatreon, finish, states, accounts,
        exchanges: () => tokenExchanges, failExchange: () => { failExchange = true; } };
}

test("start requires a valid signed-in user and POST", async () => {
    const f = fixture();
    assert.equal((await f.start(new Request("https://example.com"))).status, 405);
    assert.equal((await f.start(new Request("https://example.com", { method: "POST" }))).status, 401);
    assert.equal((await f.start(new Request("https://example.com", { method: "POST", headers: { Authorization: "Bearer fake" } }))).status, 401);
    assert.equal(f.states.length, 0);
});

test("links only after session confirmation; state is single-use and completion receipts replay", async () => {
    const f = fixture();
    const { state, cookie, ticketUrl } = await f.begin();
    assert.ok(f.states.every((row) => row.token_hash !== state));
    assert.match((await f.callback(new Request(ticketUrl))).headers.get("Location")!, /patreon=error/);
    const returned = await f.returnFromPatreon(state, cookie);
    assert.equal(returned.headers.get("Cache-Control"), "no-store");
    const location = new URL(returned.headers.get("Location")!);
    assert.equal(location.origin, "https://website.example");
    assert.equal(location.pathname, "/account/patreon/callback");
    assert.equal(f.accounts.length, 0);
    const completion = location.searchParams.get("token")!;
    assert.equal((await f.finish(completion)).status, 200);
    assert.equal(f.accounts[0].user_id, "user-a");
    assert.equal(f.accounts[0].patreon_user_id, "123");
    assert.equal((await f.finish(completion)).status, 200);
    assert.equal(f.accounts.length, 1);
    assert.match((await f.returnFromPatreon(state, cookie)).headers.get("Location")!, /patreon=error/);
    assert.equal(f.exchanges(), 1);
});

test("missing or mismatched browser cookie never exchanges the code", async () => {
    const f = fixture();
    const { state } = await f.begin();
    for (const cookie of ["", "__Host-patreon-state=wrong"]) {
        const response = await f.returnFromPatreon(state, cookie);
        assert.match(response.headers.get("Location")!, /patreon=error/);
    }
    assert.equal(f.exchanges(), 0);
});

test("expired state and provider cancellation do not link accounts", async () => {
    const f = fixture();
    const first = await f.begin();
    f.states[0].expires_at = new Date(0).toISOString();
    assert.match((await f.returnFromPatreon(first.state, first.cookie)).headers.get("Location")!, /patreon=error/);
    const second = await f.begin();
    assert.match((await f.returnFromPatreon(second.state, second.cookie, "error=access_denied")).headers.get("Location")!, /patreon=cancelled/);
    assert.equal(f.exchanges(), 0);
    assert.equal(f.accounts.length, 0);
});

test("completion rejects a different site user (including a forwarded initiation URL)", async () => {
    const f = fixture();
    const { state, cookie } = await f.begin();
    const returned = await f.returnFromPatreon(state, cookie);
    const completion = new URL(returned.headers.get("Location")!).searchParams.get("token")!;
    assert.equal((await f.finish(completion, "user-b")).status, 503);
    assert.equal(f.accounts.length, 0);
    assert.equal((await f.finish(completion, "user-a")).status, 200);
});

test("provider failures do not expose provider responses", async () => {
    const f = fixture();
    const { state, cookie } = await f.begin();
    f.failExchange();
    const returned = await f.returnFromPatreon(state, cookie);
    assert.equal(returned.headers.get("Location"), "https://website.example/account?patreon=error");
    assert.equal(await returned.text(), "");
    assert.equal(f.accounts.length, 0);
});

test("a Patreon identity already linked to another user is not reassigned", async () => {
    const f = fixture();
    f.accounts.push({ user_id: "user-b", patreon_user_id: "123" });
    const { state, cookie } = await f.begin();
    const returned = await f.returnFromPatreon(state, cookie);
    const completion = new URL(returned.headers.get("Location")!).searchParams.get("token")!;
    const response = await f.finish(completion);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), "Unable to link Patreon account");
    assert.deepEqual(f.accounts, [{ user_id: "user-b", patreon_user_id: "123" }]);
});
