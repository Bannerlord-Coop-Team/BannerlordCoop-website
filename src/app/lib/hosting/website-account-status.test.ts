import assert from "node:assert/strict";
import test from "node:test";
import { createWebsiteAccountStatusReader, readWebsiteAccountStatus } from "./website-account-status-core";
import { DatabaseContention } from "../../../../supabase/functions/_shared/database-contention";
import { MembershipRateLimit } from "../../../../supabase/functions/_shared/membership-store";

const accountId = "aaaaaaaa-1111-4111-8111-111111111111";
const status = { version: 1, accountId, hasDiscord: true, configured: true, verificationPending: false,
    membership: { linked: false, verification: "unverified", sync: "applied", verifiedAt: null,
        validUntil: null, retryAt: null, refreshMode: "oauth_reauthorization" } };

test("coalesces only identical in-flight website-account status reads", async () => {
    let calls = 0; let release!: () => void;
    let gate = new Promise<void>(resolve => { release = resolve; });
    const reader = createWebsiteAccountStatusReader(async () => {
        calls++; await gate; return status;
    });
    const first = reader(accountId, "token-a");
    const duplicate = reader(accountId, "token-a");
    const otherToken = reader(accountId, "token-b");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
    release();
    assert.deepEqual(await Promise.all([first, duplicate, otherToken]), [status, status, status]);

    gate = Promise.resolve();
    await reader(accountId, "token-a");
    assert.equal(calls, 3, "settled results are not cached");
});

test("clears a failed in-flight request so an explicit retry can proceed", async () => {
    let calls = 0;
    const reader = createWebsiteAccountStatusReader(async () => {
        calls++;
        if (calls === 1) throw new Error("unavailable");
        return status;
    });
    await assert.rejects(reader(accountId, "token-a"), /unavailable/);
    assert.deepEqual(await reader(accountId, "token-a"), status);
    assert.equal(calls, 2);
});

test("passes the explicit token, reads settled status afresh, and rejects account mismatches", async () => {
    const calls: string[] = [];
    let current = status;
    const reader = createWebsiteAccountStatusReader(async token => { calls.push(token); return current; });
    assert.deepEqual(await reader(accountId, "render-token"), status);
    current = { ...status, hasDiscord: false };
    assert.deepEqual(await reader(accountId, "render-token"), current);
    assert.deepEqual(calls, ["render-token", "render-token"]);
    current = { ...status, accountId: "bbbbbbbb-1111-4111-8111-111111111111" };
    await assert.rejects(reader(accountId, "render-token"));
});

const token = "synthetic-user-token-123456";
const discordId = "123456789012345678";
const snapshot = { version: 1, accountId, discordUserId: discordId, patreonUserId: null, linkGeneration: "0", revision: "1", linkState: "unlinked",
    verification: "unverified", campaignId: null, memberId: null, tierIds: [], verifiedAt: null, paidThroughAt: null,
    policyVersion: "patreon-paid-usd20-v1", evidenceSha256: null };
const config = { supabaseUrl: "https://fixture.supabase.co", serviceRoleKey: "sb_secret_synthetic", publishableKey: "sb_publishable_synthetic" };
const user = () => Response.json({ id: accountId, identities: [{ provider: "discord", identity_data: { sub: discordId } }] });
const result = () => Response.json({ snapshot, pending: false, verificationPending: false });

test("native account status waits for fresh identity, session and configuration in every completion order", async () => {
    for (const last of ["user", "context", "flag"]) {
        const releases = new Map<string, (response: Response) => void>();
        const starts: string[] = [], writes: unknown[] = [];
        const pending = readWebsiteAccountStatus(token, { ...config, fetch: async (input, init) => {
            const url = new URL(String(input)); const path = url.pathname; const headers = new Headers(init?.headers);
            assert.equal(url.origin, config.supabaseUrl); assert.equal(init?.cache, "no-store");
            assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
            if (path === "/rest/v1/rpc/membership_status") {
                assert.equal(headers.get("apikey"), config.serviceRoleKey);
                assert.equal(headers.get("authorization"), null, "new API keys are not JWTs");
                writes.push(JSON.parse(String(init?.body))); return result();
            }
            const name = path === "/auth/v1/user" ? "user" : path === "/rest/v1/rpc/website_session_context" ? "context" : "flag";
            if (name === "flag") {
                assert.equal(path, "/functions/v1/website-account"); assert.equal(headers.get("authorization"), null);
                assert.equal(headers.get("apikey"), config.publishableKey);
            } else {
                assert.equal(headers.get("authorization"), `Bearer ${token}`);
                if (name === "context") assert.equal(JSON.parse(String(init?.body)).p_action, "membership");
            }
            starts.push(name); return new Promise<Response>(resolve => releases.set(name, resolve));
        } });
        assert.deepEqual(starts, ["user", "context", "flag"]);
        const resolve = (name: string) => releases.get(name)!(name === "user" ? user() : Response.json(name === "context" ? { impersonationId: null } : { version: 1, configured: false }));
        for (const name of starts.filter(name => name !== last)) resolve(name);
        await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(writes, []);
        resolve(last);
        assert.deepEqual(await pending, { ...status, configured: false });
        assert.deepEqual(writes, [{ p_account_id: accountId, p_discord_user_id: discordId }]);
    }
});

test("native status refuses revoked, expired and mismatched sessions or failed Auth before privileged status", async () => {
    const contexts = [Response.json({}, { status: 403 }), Response.json({ impersonationId: "invalid" }),
        Response.json({ impersonationId: accountId, actorId: accountId, targetId: accountId, expiresAt: "2000-01-01T00:00:00Z" }),
        Response.json({ impersonationId: accountId, actorId: accountId, targetId: "bbbbbbbb-1111-4111-8111-111111111111", expiresAt: "2099-01-01T00:00:00Z" })];
    for (const context of [...contexts, null]) {
        let writes = 0;
        await assert.rejects(readWebsiteAccountStatus(token, { ...config, fetch: async input => {
            const path = new URL(String(input)).pathname;
            if (path === "/auth/v1/user") return context ? user() : Response.json({}, { status: 401 });
            if (path === "/rest/v1/rpc/website_session_context") return context ?? Response.json({ impersonationId: null });
            if (path === "/functions/v1/website-account") return Response.json({ version: 1, configured: true });
            writes++; return result();
        } }));
        assert.equal(writes, 0);
    }
});

test("native configuration failures cannot invoke privileged status or a fallback", async () => {
    const flags = [Response.json({ version: 1, configured: "true" }), Response.json({ version: 2, configured: true }),
        Response.json({ version: 1, configured: true, secret: "unexpected" }), Response.json({ version: 1, configured: true, padding: "x".repeat(512) }),
        new Response("html", { headers: { "content-type": "text/html" } }), new Response(null, { status: 302 }),
        Response.json({}, { status: 401 }), Response.json({}, { status: 429 }), Response.json({}, { status: 503 })];
    for (const flag of flags) {
        let writes = 0;
        await assert.rejects(readWebsiteAccountStatus(token, { ...config, fetch: async (input, init) => {
            const path = new URL(String(input)).pathname;
            if (path === "/auth/v1/user") return user();
            if (path === "/rest/v1/rpc/website_session_context") return Response.json({ impersonationId: null });
            if (path === "/functions/v1/website-account" && init?.method !== "POST") return flag;
            writes++; return result();
        } }));
        assert.equal(writes, 0);
    }
    for (const supabaseUrl of ["http://fixture.supabase.co", "https://user:pass@fixture.supabase.co", "https://fixture.supabase.co/path", "https://fixture.supabase.co?query=1"]) {
        await assert.rejects(readWebsiteAccountStatus(token, { ...config, supabaseUrl, fetch: async () => { assert.fail("Invalid origin must not be fetched"); } }));
    }
});

test("native status preserves bounded contention retries and rate-limit failures for legacy and new keys", async () => {
    for (const serviceRoleKey of ["sb_secret_synthetic", "synthetic-legacy-JWT"]) {
        for (const code of ["success", "55P03", "429"] as const) {
            let writes = 0; const delays: number[] = [];
            const read = readWebsiteAccountStatus(token, { ...config, serviceRoleKey, sleep: async delay => { delays.push(delay); }, random: () => 0,
                fetch: async (input, init) => {
                    const path = new URL(String(input)).pathname;
                    if (path === "/auth/v1/user") return user();
                    if (path === "/rest/v1/rpc/website_session_context") return Response.json({ impersonationId: null });
                    if (path === "/functions/v1/website-account") return Response.json({ version: 1, configured: true });
                    assert.equal(path, "/rest/v1/rpc/membership_status"); writes++;
                    assert.equal(new Headers(init?.headers).get("authorization"), serviceRoleKey.startsWith("sb_secret_") ? null : `Bearer ${serviceRoleKey}`);
                    return code === "429" ? Response.json({}, { status: 429 }) : code === "55P03" || writes === 1 ? Response.json({ code: "55P03" }, { status: 409 }) : result();
                } });
            if (code === "success") { assert.deepEqual(await read, status); assert.equal(writes, 2); assert.deepEqual(delays, [20]); }
            else { await assert.rejects(read, code === "55P03" ? DatabaseContention : MembershipRateLimit); assert.equal(writes, code === "55P03" ? 3 : 1); }
        }
    }
});

test("only an older function's GET 405 uses the authenticated POST contract during rollout", async () => {
    const calls: string[] = [];
    const reader = createWebsiteAccountStatusReader(accessToken => readWebsiteAccountStatus(accessToken, { ...config, fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/auth/v1/user") return user();
        if (path === "/rest/v1/rpc/website_session_context") return Response.json({ impersonationId: null });
        assert.equal(path, "/functions/v1/website-account"); calls.push(init?.method ?? "GET");
        if (init?.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
        assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${token}`);
        assert.deepEqual(JSON.parse(String(init.body)), { operation: "status" });
        return Response.json(status);
    } }));
    assert.deepEqual(await reader(accountId, token), status); assert.deepEqual(calls, ["GET", "POST"]);
});

test("native status rejects foreign snapshots and rechecks configuration and status after settlement", async () => {
    let current = { snapshot, pending: false, verificationPending: false }; let configured = true; let reads = 0;
    const reader = createWebsiteAccountStatusReader(accessToken => readWebsiteAccountStatus(accessToken, { ...config, fetch: async input => {
        const path = new URL(String(input)).pathname;
        if (path === "/auth/v1/user") return user();
        if (path === "/rest/v1/rpc/website_session_context") return Response.json({ impersonationId: null });
        if (path === "/functions/v1/website-account") return Response.json({ version: 1, configured });
        reads++; return Response.json(current);
    } }));
    assert.deepEqual(await reader(accountId, token), status);
    configured = false; current = { ...current, pending: true };
    assert.deepEqual(await reader(accountId, token), { ...status, configured: false, membership: { ...status.membership, sync: "pending" } });
    assert.equal(reads, 2);
    for (const foreign of [{ ...snapshot, accountId: "bbbbbbbb-1111-4111-8111-111111111111" }, { ...snapshot, discordUserId: "999456789012345678" }]) {
        current = { ...current, snapshot: foreign }; await assert.rejects(reader(accountId, token), /identity mismatch/);
    }
});
