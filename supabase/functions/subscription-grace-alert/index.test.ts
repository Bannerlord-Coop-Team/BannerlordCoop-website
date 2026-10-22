import assert from "node:assert/strict";
import test from "node:test";
import {
    createSubscriptionGraceAlertHandler, createSubscriptionGraceStore, parseSubscriptionGraceAlerts,
    subscriptionGraceMessage, type SubscriptionGraceAlert, type SubscriptionGraceStore,
} from "../_shared/subscription-grace-alert.ts";
import type { SmtpMessage } from "../_shared/smtp.ts";

const syncSecret = "scheduler-secret-for-fixtures";
const sender = { from: "admin@bannerlordcoop.com", fromName: "Bannerlord Co-op" };
const siteUrl = "https://bannerlordcoop.com";
const claimedAt = "2026-10-12T15:20:00.000Z";

// One pending grace for a server with a verified owner email unless overridden.
function alert(overrides: Partial<SubscriptionGraceAlert> = {}): SubscriptionGraceAlert {
    return {
        serverId: "558f2566-97d7-5920-879a-e323ca593a58", serverName: "GSR",
        graceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", dueAt: "2026-10-15T15:00:00.000Z",
        email: "owner@example.com", ...overrides,
    };
}

// The matching RPC row for an alert.
function row(value: SubscriptionGraceAlert) {
    return { server_id: value.serverId, server_name: value.serverName, grace_id: value.graceId, due_at: value.dueAt, email: value.email };
}

// Records claims, releases and sends against an in-memory claim set.
function harness(pending: SubscriptionGraceAlert[], options: { failSend?: boolean; failRead?: boolean } = {}) {
    const claimed = new Set<string>();
    const calls: string[] = [];
    const sent: SmtpMessage[] = [];
    const store: SubscriptionGraceStore = {
        pending: async () => {
            if (options.failRead) throw new Error("read failed");
            return pending;
        },
        claim: async (serverId, graceId) => {
            calls.push(`claim:${serverId}`);
            if (claimed.has(graceId)) return null;
            claimed.add(graceId);
            return claimedAt;
        },
        release: async (serverId, graceId, at) => {
            calls.push(`release:${serverId}:${at}`);
            return claimed.delete(graceId);
        },
    };
    const handler = createSubscriptionGraceAlertHandler({
        ...sender, syncSecret, siteUrl, store,
        send: async (message) => {
            if (options.failSend) throw new Error("smtp down");
            sent.push(message);
        },
    });
    return { handler, calls, sent, claimed };
}

// Builds a scheduler request with the given key and method.
function scheduled(key = syncSecret, method = "POST") {
    return new Request("https://example.test/functions/v1/subscription-grace-alert", { method, headers: { "x-patreon-sync-key": key } });
}

// Runs the body with console.error silenced, returning the logged lines.
async function quietly(body: () => Promise<void>): Promise<string[]> {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => { logged.push(line); };
    try { await body(); } finally { console.error = originalError; }
    return logged;
}

test("the owner email names the server, the UTC deadline and how to keep it", () => {
    const message = subscriptionGraceMessage({ ...alert(), email: "owner@example.com" }, siteUrl, sender);
    assert.deepEqual(message.to, ["owner@example.com"]);
    assert.equal(message.from, "admin@bannerlordcoop.com");
    assert.equal(message.fromName, "Bannerlord Co-op");
    assert.equal(message.subject, "[BannerlordCoop] Your server \"GSR\" has been stopped and will be removed after 2026-10-15 15:00 UTC");
    assert.match(message.text, /has been stopped because the Patreon membership/u);
    assert.match(message.text, /locked and scheduled for removal after 2026-10-15 15:00 UTC\./u);
    assert.match(message.text, /stays stopped; press Start to run it again\./u);
    assert.match(message.text, /https:\/\/bannerlordcoop\.com\/account/u);
});

test("emails each claimed grace once and skips accounts without an email", async () => {
    const pending = [alert(), alert({ serverId: "11111111-1111-4111-8111-111111111111", graceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: null })];
    const h = harness(pending);
    const response = await h.handler(scheduled());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { code: "checked", pending: 2, sent: 1, skipped: 1, failed: 0 });
    assert.equal(h.sent.length, 1);
    // A second run (or an overlapping one) finds the grace already claimed and sends nothing.
    const again = await h.handler(scheduled());
    assert.deepEqual(await again.json(), { code: "checked", pending: 2, sent: 0, skipped: 2, failed: 0 });
    assert.equal(h.sent.length, 1);
});

test("releases the exact claim when delivery fails so the next run retries", async () => {
    const h = harness([alert()], { failSend: true });
    let response!: Response;
    const logged = await quietly(async () => { response = await h.handler(scheduled()); });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: "checked", pending: 1, sent: 0, skipped: 0, failed: 1 });
    assert.deepEqual(h.calls, [`claim:${alert().serverId}`, `release:${alert().serverId}:${claimedAt}`]);
    assert.equal(h.claimed.size, 0);
    assert.ok(logged.every((line) => !line.includes("owner@example.com")));
});

test("bounds sends per run", async () => {
    const pending = Array.from({ length: 30 }, (_, index) => alert({
        serverId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        graceId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    const h = harness(pending);
    const response = await h.handler(scheduled());
    assert.deepEqual(await response.json(), { code: "checked", pending: 30, sent: 20, skipped: 0, failed: 0 });
});

test("rejects unauthenticated or non-POST requests and reports an unreadable store", async () => {
    const h = harness([alert()]);
    assert.equal((await h.handler(scheduled("wrong-secret-value-123"))).status, 401);
    assert.equal((await h.handler(scheduled(syncSecret, "GET"))).status, 405);
    assert.equal(h.calls.length, 0);
    const unreadable = harness([], { failRead: true });
    let response!: Response;
    await quietly(async () => { response = await unreadable.handler(scheduled()); });
    assert.equal(response.status, 503);
    const store: SubscriptionGraceStore = { pending: async () => [], claim: async () => null, release: async () => false };
    assert.throws(() => createSubscriptionGraceAlertHandler({ ...sender, syncSecret: "short", siteUrl, store, send: async () => undefined }));
});

test("parses RPC rows strictly and drops malformed emails", () => {
    assert.deepEqual(parseSubscriptionGraceAlerts([row(alert())]), [alert()]);
    assert.deepEqual(parseSubscriptionGraceAlerts([row(alert({ email: "not-an-email" }))]), [alert({ email: null })]);
    for (const bad of [
        { ...row(alert()), server_id: "not-a-uuid" },
        { ...row(alert()), grace_id: null },
        { ...row(alert()), server_name: "" },
        { ...row(alert()), server_name: "GSR\r\nBcc: victim@example.com" },
        { ...row(alert()), server_name: "x".repeat(101) },
        { ...row(alert()), due_at: "2026-10-15" },
        { ...row(alert()), email: 42 },
    ]) {
        assert.throws(() => parseSubscriptionGraceAlerts([bad]));
    }
    assert.throws(() => parseSubscriptionGraceAlerts({}));
    assert.throws(() => parseSubscriptionGraceAlerts(Array.from({ length: 101 }, () => row(alert()))));
});

test("the store calls the exact service-role RPCs and validates their results", async () => {
    const requests: { url: string; body: string; auth: string | null }[] = [];
    const replies: unknown[] = [[row(alert())], claimedAt, null, true];
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        requests.push({ url: String(input), body: String(init?.body), auth: headers.get("authorization") });
        return Response.json(replies.shift());
    }) as typeof fetch;
    const store = createSubscriptionGraceStore(fetcher, "https://project.supabase.co", "service-key");
    assert.deepEqual(await store.pending(), [alert()]);
    assert.equal(await store.claim(alert().serverId, alert().graceId), claimedAt);
    assert.equal(await store.claim(alert().serverId, alert().graceId), null);
    assert.equal(await store.release(alert().serverId, alert().graceId, claimedAt), true);
    assert.deepEqual(requests.map((request) => request.url), [
        "https://project.supabase.co/rest/v1/rpc/subscription_grace_alerts",
        "https://project.supabase.co/rest/v1/rpc/claim_subscription_grace_alert",
        "https://project.supabase.co/rest/v1/rpc/claim_subscription_grace_alert",
        "https://project.supabase.co/rest/v1/rpc/release_subscription_grace_alert",
    ]);
    assert.deepEqual(JSON.parse(requests[3]!.body), { p_server_id: alert().serverId, p_grace_id: alert().graceId, p_notified_at: claimedAt });
    assert.ok(requests.every((request) => request.auth === "Bearer service-key"));
    const failing = createSubscriptionGraceStore((async () => new Response("no", { status: 500 })) as typeof fetch, "https://project.supabase.co", "k");
    await assert.rejects(failing.pending());
    const malformed = createSubscriptionGraceStore((async () => Response.json("yesterday")) as typeof fetch, "https://project.supabase.co", "k");
    await assert.rejects(malformed.claim(alert().serverId, alert().graceId));
});
