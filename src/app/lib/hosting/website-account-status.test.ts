import assert from "node:assert/strict";
import test from "node:test";
import { createWebsiteAccountStatusReader } from "./website-account-status-core";

const accountId = "aaaaaaaa-1111-4111-8111-111111111111";
const status = { version: 1, accountId, hasDiscord: true, configured: true, verificationPending: false,
    membership: { linked: false, verification: "unverified", sync: "applied", verifiedAt: null,
        validUntil: null, retryAt: null, refreshMode: "oauth_reauthorization" } };

test("coalesces only identical in-flight website-account status reads", async () => {
    let calls = 0; let release!: () => void;
    let gate = new Promise<void>(resolve => { release = resolve; });
    const reader = createWebsiteAccountStatusReader(async () => ({ functions: { invoke: async () => {
        calls++; await gate; return { data: status, error: null };
    } } }));
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
    const reader = createWebsiteAccountStatusReader(async () => ({ functions: { invoke: async () => {
        calls++;
        return calls === 1 ? { data: null, error: new Error("synthetic") } : { data: status, error: null };
    } } }));
    await assert.rejects(reader(accountId, "token-a"), /unavailable/);
    assert.deepEqual(await reader(accountId, "token-a"), status);
    assert.equal(calls, 2);
});

test("reuses a render's client while sending its explicit token and reading fresh account status", async () => {
    const calls: unknown[] = [];
    const reader = createWebsiteAccountStatusReader(async () => { throw new Error("duplicate client"); });
    let current = status;
    const client = { functions: { invoke: async (name: string, input: unknown) => {
        calls.push({ name, input });
        return { data: current, error: null };
    } } };
    assert.deepEqual(await reader(accountId, "render-token", client), status);
    current = { ...status, hasDiscord: false };
    assert.deepEqual(await reader(accountId, "render-token", client), current);
    assert.deepEqual(calls, Array.from({ length: 2 }, () => ({ name: "website-account", input: {
        headers: { Authorization: "Bearer render-token" }, body: { operation: "status" },
    } })));
    current = { ...status, accountId: "bbbbbbbb-1111-4111-8111-111111111111" };
    await assert.rejects(reader(accountId, "render-token", client));
});
