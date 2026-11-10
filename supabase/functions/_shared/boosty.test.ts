import assert from "node:assert/strict";
import test from "node:test";
import { BOOSTY_API_ORIGIN, BoostyAuthError, boostyUrl, createBoostyApi, parseSubscriberPage, type BoostyApi, type BoostySubscriber } from "./boosty-api.ts";
import { BOOSTY_TOKEN_URL, BoostyCredentialUnavailable, createBoostyCredential, type BoostyCredentialRpc } from "./boosty-credential.ts";
import { circuitBreakerTripped, decideBoostyEvidence, type LinkedBoostyHead } from "./boosty-evidence.ts";
import { extractLinkCode, generateLinkCode, LINK_CODE, linkCodeHash } from "./boosty-link-code.ts";
import { parseDialogPage, parseMessagePage } from "./boosty-messages.ts";
import { createBoostyMembershipHandler, fetchCompleteSubscribers, type BoostySyncRpc } from "./boosty-membership.ts";
import { parseBoostyPolicy, type BoostyPolicy } from "./boosty-policy.ts";
import { parseFundingSnapshot } from "./funding-provider.ts";
import type { CreatorTokenProvider } from "./patreon-creator-token.ts";
import { createWebsiteAccountHandler } from "./website-account.ts";

const policy: BoostyPolicy = { blog: "coop-team", qualifyingLevelIds: ["555", "556"], minimumPrice: 500, priceField: "RUB", creatorName: "Coop Team", maximumDropFraction: 0.25, policyVersion: "boosty-paid-v1" };
const accountId = "aaaaaaaa-1111-4111-8111-111111111111";
const head: LinkedBoostyHead = { accountId, providerUserId: "4242", linkGeneration: "3", absentSince: null };
const polledAt = "2026-11-10T12:00:00.000Z";
type Expected = { method: string; url: string; headers: Record<string, string>; body?: string; reply: () => Response };

/** A strict fake transport: every request must equal the next expected one exactly, in order. */
function strictFetch(expected: Expected[]): typeof fetch & { remaining: () => number } {
    const queue = [...expected];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
        const next = queue.shift();
        assert.ok(next, `unexpected request ${String(input)}`);
        assert.equal(String(input), next.url);
        assert.equal(init?.method ?? "GET", next.method);
        assert.equal(init?.redirect, "error");
        assert.deepEqual(Object.fromEntries(new Headers(init?.headers).entries()), next.headers);
        assert.equal(init?.body === undefined ? undefined : String(init.body), next.body);
        return next.reply();
    }) as typeof fetch & { remaining: () => number };
    fetcher.remaining = () => queue.length;
    return fetcher;
}

/** A fixed token provider that records replacement requests. */
function tokens(current: string, replacement: string | null) {
    const replaced: string[] = [];
    const provider: CreatorTokenProvider = { current: async () => current, replace: async rejected => { replaced.push(rejected); return replacement; } };
    return { provider, replaced };
}

const apiHeaders = (token: string) => ({ accept: "application/json", authorization: `Bearer ${token}`, "user-agent": "BannerlordCoop - website membership sync" });

test("policy is strict, closed and disabled when unset", () => {
    assert.equal(parseBoostyPolicy(undefined), null); assert.equal(parseBoostyPolicy(" "), null);
    assert.deepEqual(parseBoostyPolicy(JSON.stringify(policy)), policy);
    for (const bad of [{ ...policy, blog: "Coop" }, { ...policy, qualifyingLevelIds: [] }, { ...policy, qualifyingLevelIds: ["1", "1"] }, { ...policy, minimumPrice: 0 }, { ...policy, minimumPrice: 1.5 },
        { ...policy, priceField: "GBP" }, { ...policy, creatorName: "" }, { ...policy, creatorName: "a\nb" }, { ...policy, maximumDropFraction: 1 }, { ...policy, policyVersion: "patreon-paid-usd20-v1" }, { ...policy, extra: true }]) {
        assert.throws(() => parseBoostyPolicy(JSON.stringify(bad)), JSON.stringify(bad));
    }
});

test("link codes are canonical, hash-only and matched only when exactly one appears in a message", async () => {
    const code = generateLinkCode(bytes => bytes.fill(0xff));
    assert.equal(code, "BLC-ZZZZZ-ZZZZZ"); assert.match(generateLinkCode(), LINK_CODE);
    assert.equal(await linkCodeHash(code), await linkCodeHash("BLC-ZZZZZ-ZZZZZ"));
    await assert.rejects(linkCodeHash("blc-zzzzz-zzzzz"));
    assert.equal(extractLinkCode("my code: blc-ab12c-de34f thanks"), "BLC-AB12C-DE34F");
    assert.equal(extractLinkCode('["BLC-AB12C-DE34F","unstyled",[]]'), "BLC-AB12C-DE34F", "Draft.js-encoded content still matches");
    assert.equal(extractLinkCode("BLC-AB12C-DE34F and again BLC-AB12C-DE34F"), "BLC-AB12C-DE34F");
    for (const text of ["", "BLC-AB12C-DE34F BLC-AB12C-DE34G", "XBLC-AB12C-DE34F", "BLC-AB12C-DE34FF", "BLC-AB1IC-DE34F", "BLC-AB12-DE34F"]) assert.equal(extractLinkCode(text), null, text);
});

test("only the allowlisted routes exist, each with an exact query", () => {
    assert.equal(BOOSTY_API_ORIGIN, "https://api.boosty.to");
    assert.equal(boostyUrl({ route: "subscribers", blog: "coop-team", offset: 200 }).href, "https://api.boosty.to/v1/blog/coop-team/subscribers?limit=100&offset=200&sort_by=on_time&order=gt&with_follow=false");
    assert.equal(boostyUrl({ route: "dialogs", offset: null }).href, "https://api.boosty.to/v1/dialog/?limit=20");
    assert.equal(boostyUrl({ route: "dialogs", offset: "40" }).href, "https://api.boosty.to/v1/dialog/?limit=20&offset=40");
    assert.equal(boostyUrl({ route: "messages", dialogId: "900" }).href, "https://api.boosty.to/v1/dialog/900/message/?limit=20");
    for (const bad of [{ route: "subscribers", blog: "../x", offset: 0 }, { route: "subscribers", blog: "coop-team", offset: -1 }, { route: "subscribers", blog: "coop-team", offset: 5001 },
        { route: "dialogs", offset: "1&x=1" }, { route: "messages", dialogId: "1/../2" }, { route: "messages", dialogId: "0" }, { route: "levels" }] as never[]) assert.throws(() => boostyUrl(bad), JSON.stringify(bad));
});

test("the client sends exact GETs, replaces a rejected token once and reports a surviving 401 as a credential failure", async () => {
    const page = { data: [{ id: 4242, name: "x", email: "private@example.com", subscribed: true, isBlackListed: false, nextPayTime: 4_000_000_000, level: { id: 555, price: 7, currencyPrices: { RUB: 500, USD: 5 } } }], total: 1, offset: 0, limit: 100 };
    const json = (body: unknown) => () => Response.json(body);
    const fetcher = strictFetch([
        { method: "GET", url: "https://api.boosty.to/v1/blog/coop-team/subscribers?limit=100&offset=0&sort_by=on_time&order=gt&with_follow=false", headers: apiHeaders("old-access-token-x"), reply: () => new Response("", { status: 401 }) },
        { method: "GET", url: "https://api.boosty.to/v1/blog/coop-team/subscribers?limit=100&offset=0&sort_by=on_time&order=gt&with_follow=false", headers: apiHeaders("new-access-token-x"), reply: json(page) },
    ]);
    const { provider, replaced } = tokens("old-access-token-x", "new-access-token-x");
    const api = createBoostyApi({ blog: "coop-team", priceField: "RUB", credential: provider, fetchImplementation: fetcher });
    assert.deepEqual(await api.subscribers(0), { subscribers: [{ id: "4242", subscribed: true, blacklisted: false, levelId: "555", price: 500 }], total: 1 });
    assert.deepEqual(replaced, ["old-access-token-x"]); assert.equal(fetcher.remaining(), 0);
    const rejected = strictFetch([{ method: "GET", url: "https://api.boosty.to/v1/dialog/?limit=20", headers: apiHeaders("old-access-token-x"), reply: () => new Response("", { status: 401 }) }]);
    const denied = createBoostyApi({ blog: "coop-team", priceField: "RUB", credential: tokens("old-access-token-x", null).provider, fetchImplementation: rejected });
    await assert.rejects(denied.dialogs(null), BoostyAuthError);
    const outage = createBoostyApi({ blog: "coop-team", priceField: "RUB", credential: tokens("access-token-xxxxxx", null).provider,
        fetchImplementation: strictFetch([{ method: "GET", url: "https://api.boosty.to/v1/dialog/900/message/?limit=20", headers: apiHeaders("access-token-xxxxxx"), reply: () => new Response("busy", { status: 502 }) }]) });
    await assert.rejects(outage.messages("900"), (error: Error) => !(error instanceof BoostyAuthError));
    const html = createBoostyApi({ blog: "coop-team", priceField: "RUB", credential: tokens("access-token-xxxxxx", null).provider,
        fetchImplementation: strictFetch([{ method: "GET", url: "https://api.boosty.to/v1/dialog/?limit=20", headers: apiHeaders("access-token-xxxxxx"), reply: () => new Response("<html>", { headers: { "content-type": "text/html" } }) }]) });
    await assert.rejects(html.dialogs(null));
});

test("subscriber, dialog and message parsers read only the allowlisted subset and fail closed on identity", () => {
    assert.deepEqual(parseSubscriberPage({ data: [{ id: 1, subscribed: "yes", level: { id: 9, price: 300 } }, { id: 2 }, { id: 3, isBlackListed: 1, levelId: 7 }], total: 3 }, "price").subscribers, [
        { id: "1", subscribed: null, blacklisted: false, levelId: "9", price: 300 }, { id: "2", subscribed: null, blacklisted: false, levelId: null, price: null },
        { id: "3", subscribed: null, blacklisted: null, levelId: "7", price: null }]);
    for (const bad of [{ data: [{ id: "1" }], total: 1 }, { data: [{ id: 0 }], total: 1 }, { data: [], total: -1 }, { data: Array.from({ length: 101 }, (_, i) => ({ id: i + 1 })), total: 101 }, { total: 0 }]) {
        assert.throws(() => parseSubscriberPage(bad, "RUB"), JSON.stringify(bad));
    }
    assert.deepEqual(parseDialogPage({ data: [{ id: 900, chatmate: { id: 8888, name: "S" }, lastMessage: { id: 31, createdAt: 1_762_776_000 } }, { id: 901 }], extra: { offset: 20 } }), {
        dialogs: [{ dialogId: "900", chatmateId: "8888", lastMessageId: "31", lastMessageAt: "2025-11-10T12:00:00.000Z" }, { dialogId: "901", chatmateId: null, lastMessageId: null, lastMessageAt: null }], nextOffset: "20" });
    assert.deepEqual(parseDialogPage({ data: [] , extra: { offset: 20 } }), { dialogs: [], nextOffset: null });
    assert.throws(() => parseDialogPage({ data: [{ chatmate: { id: 1 } }] }));
    assert.deepEqual(parseMessagePage({ data: [
        { id: 31, authorId: 8888, createdAt: 1_762_776_000, data: [{ type: "text", content: '["BLC-AB12C-DE34F","unstyled",[]]', modificator: "" }, { type: "text", content: "", modificator: "BLOCK_END" }] },
        { id: 32, author: { id: 1, name: "Creator" }, data: [{ type: "link", content: "BLC-AB12C-DE34F", url: "https://x" }] },
        { id: 33, authorId: 8888, isDeleted: true, data: [{ type: "text", content: "BLC-AB12C-DE34F" }] }, { authorId: 8888 }] }), [
        { messageId: "31", authorId: "8888", messageAt: "2025-11-10T12:00:00.000Z", code: "BLC-AB12C-DE34F" },
        { messageId: "32", authorId: "1", messageAt: null, code: null }]);
});

test("evidence: qualifying, explicit unsubscribe loss, two-poll absence, no-loss uncertainty and nextPayTime ignored", async () => {
    const decide = (subscriber: BoostySubscriber | undefined, at = polledAt, absentSince: string | null = null) => decideBoostyEvidence(policy, { ...head, absentSince }, subscriber, at);
    const listed = (overrides: Partial<BoostySubscriber> = {}): BoostySubscriber => ({ id: "4242", subscribed: true, blacklisted: false, levelId: "555", price: 500, ...overrides });
    const qualifying = await decide(listed());
    assert.deepEqual({ ...qualifying.evidence, evidenceSha256: "x" }, { verification: "qualifying", programId: "coop-team", memberId: null, tierIds: ["555"], verifiedAt: polledAt, paidThroughAt: null, policyVersion: "boosty-paid-v1", evidenceSha256: "x" });
    assert.match(qualifying.evidence.evidenceSha256, /^[a-f0-9]{64}$/u); assert.equal(qualifying.absentSince, null);
    assert.equal((await decide(listed())).evidence.evidenceSha256, qualifying.evidence.evidenceSha256, "the digest is deterministic");
    const unsubscribed = await decide(listed({ subscribed: false }));
    assert.deepEqual([unsubscribed.evidence.verification, unsubscribed.evidence.tierIds, unsubscribed.evidence.paidAccessEndedAt], ["nonqualifying", [], polledAt]);
    const firstAbsence = await decide(undefined);
    assert.deepEqual([firstAbsence.evidence.verification, firstAbsence.evidence.paidAccessEndedAt, firstAbsence.absentSince], ["nonqualifying", undefined, polledAt]);
    const soon = await decide(undefined, "2026-11-10T12:59:59.999Z", polledAt);
    assert.deepEqual([soon.evidence.paidAccessEndedAt, soon.absentSince], [undefined, polledAt]);
    const confirmed = await decide(undefined, "2026-11-10T13:00:00.000Z", polledAt);
    assert.deepEqual([confirmed.evidence.verification, confirmed.evidence.tierIds, confirmed.evidence.paidAccessEndedAt, confirmed.absentSince], ["nonqualifying", [], "2026-11-10T13:00:00.000Z", polledAt]);
    for (const [name, overrides, verification, tiers] of [
        ["blacklisted", { blacklisted: true }, "nonqualifying", []], ["other level", { levelId: "999" }, "nonqualifying", ["999"]], ["cheap", { price: 499 }, "nonqualifying", ["555"]],
        ["unknown subscribed", { subscribed: null }, "unknown", []], ["unknown blacklist", { blacklisted: null }, "unknown", []], ["no level", { levelId: null }, "unknown", []], ["no price", { price: null }, "unknown", []],
    ] as const) {
        const decision = await decide(listed(overrides));
        assert.deepEqual([decision.evidence.verification, decision.evidence.tierIds, decision.evidence.paidAccessEndedAt, decision.absentSince], [verification, tiers, undefined, null], name);
    }
    // Every decided evidence object satisfies the CP version 2 Boosty grammar exactly.
    for (const decision of [qualifying, unsubscribed, firstAbsence, confirmed]) {
        parseFundingSnapshot({ version: 2, provider: "boosty", accountId, discordUserId: null, providerUserId: "4242", linkGeneration: "3", revision: "9", linkState: "linked", ...decision.evidence }, accountId, "boosty");
    }
    assert.equal(circuitBreakerTripped(policy, null, 0), false); assert.equal(circuitBreakerTripped(policy, 100, 75), false);
    assert.equal(circuitBreakerTripped(policy, 100, 74), true); assert.equal(circuitBreakerTripped(policy, 0, 0), false);
});

test("a subscriber list is complete only when it reaches its stated total without duplicates", async () => {
    const pages = (...results: { ids: number[]; total: number }[]): BoostyApi & { offsets: number[] } => {
        const offsets: number[] = [];
        return { offsets, dialogs: async () => { throw new Error("unused"); }, messages: async () => { throw new Error("unused"); },
            subscribers: async offset => { offsets.push(offset); const next = results.shift()!; return { total: next.total, subscribers: next.ids.map(id => ({ id: String(id), subscribed: true, blacklisted: false, levelId: "555", price: 500 })) }; } };
    };
    const full = pages({ ids: Array.from({ length: 100 }, (_, i) => i + 1), total: 150 }, { ids: Array.from({ length: 50 }, (_, i) => i + 101), total: 150 });
    assert.equal((await fetchCompleteSubscribers(full, Infinity, Date.now)).size, 150); assert.deepEqual(full.offsets, [0, 100]);
    assert.equal((await fetchCompleteSubscribers(pages({ ids: [], total: 0 }), Infinity, Date.now)).size, 0);
    for (const broken of [pages({ ids: [1, 2], total: 3 }, { ids: [], total: 3 }), pages({ ids: [1, 2], total: 4 }, { ids: [2, 3], total: 4 }), pages({ ids: [1], total: 2 }, { ids: [2], total: 3 })]) {
        await assert.rejects(fetchCompleteSubscribers(broken, Infinity, Date.now), /incomplete|IncompletePoll|short_list|duplicate|total_changed/iu);
    }
    await assert.rejects(fetchCompleteSubscribers(pages({ ids: [1], total: 5 }), 0, () => 1), /deadline/u);
});

test("the credential seeds once, stores a rotated pair before using it and alerts on refusal without leaking tokens", async () => {
    const events: string[] = [];
    let state: Record<string, unknown> = { configured: false, generation: 0 };
    const rpc: BoostyCredentialRpc = async (operation, input) => {
        events.push(`rpc:${operation}`);
        if (operation === "read") return state;
        if (operation === "seed") { assert.deepEqual(input, { deviceId: "device-fixture-1", refreshToken: "refresh-token-fixture-1" }); state = { configured: true, deviceId: "device-fixture-1", refreshToken: "refresh-token-fixture-1", accessToken: null, generation: 1, refreshDue: true }; return { seeded: true }; }
        if (operation === "rotate") { assert.deepEqual(input, { generation: 1, accessToken: "access-token-fixture-2", refreshToken: "refresh-token-fixture-2", expiresIn: 86400 }); state = { ...state, accessToken: "access-token-fixture-2", refreshToken: "refresh-token-fixture-2", generation: 2, refreshDue: false }; return { rotated: true }; }
        assert.deepEqual(input, { generation: state.generation, reason: "rejected" }); return { recorded: true, alert: events.filter(event => event === "alert:rejected").length === 0 };
    };
    const fetcher = strictFetch([{ method: "POST", url: BOOSTY_TOKEN_URL, body: "device_id=device-fixture-1&device_os=web&grant_type=refresh_token&refresh_token=refresh-token-fixture-1",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "BannerlordCoop - website membership sync" },
        reply: () => { events.push("http:token"); return Response.json({ access_token: "access-token-fixture-2", refresh_token: "refresh-token-fixture-2", expires_in: 86400 }); } }]);
    const logs: string[] = [];
    const credential = createBoostyCredential({ bootstrap: { deviceId: "device-fixture-1", refreshToken: "refresh-token-fixture-1" }, rpc, fetchImplementation: fetcher,
        alert: async reason => { events.push(`alert:${reason}`); }, log: message => logs.push(message) });
    assert.equal(BOOSTY_TOKEN_URL, "https://api.boosty.to/oauth/token/");
    assert.equal(await credential.current(), "access-token-fixture-2");
    assert.deepEqual(events, ["rpc:read", "rpc:seed", "rpc:read", "http:token", "rpc:rotate"], "the rotated pair is stored before current() returns it");
    assert.equal(await credential.current(), "access-token-fixture-2"); assert.equal(fetcher.remaining(), 0);
    await credential.reportFailure("rejected"); await credential.reportFailure("rejected");
    assert.deepEqual(events.filter(event => event.startsWith("alert")), ["alert:rejected"], "alerts are rate-limited by the store");
    assert.ok(logs.every(line => !/token-fixture|device-fixture/u.test(line)));
});

test("refresh refusal, outage and an unstored rotation never yield a token or loss", async () => {
    for (const [status, reason] of [[401, "rejected"], [400, "rejected"], [503, "unavailable"]] as const) {
        const failures: string[] = [], alerts: string[] = [];
        const rpc: BoostyCredentialRpc = async (operation, input) => {
            if (operation === "read") return { configured: true, deviceId: "device-fixture-1", refreshToken: "refresh-token-fixture-1", accessToken: null, generation: 4, refreshDue: true };
            if (operation === "failed") { failures.push(String(input.reason)); return { recorded: true, alert: true }; }
            throw new Error(`unexpected ${operation}`);
        };
        const credential = createBoostyCredential({ bootstrap: { deviceId: "device-fixture-1", refreshToken: "refresh-token-fixture-1" }, rpc, alert: async kind => { alerts.push(kind); }, log: () => undefined,
            fetchImplementation: async () => new Response("denied", { status }) });
        await assert.rejects(credential.current(), BoostyCredentialUnavailable);
        assert.deepEqual([failures, alerts], [[reason], [reason]]);
    }
    const alerts: string[] = [];
    let reads = 0;
    const lost = createBoostyCredential({ bootstrap: { deviceId: "device-fixture-1", refreshToken: "refresh-token-fixture-1" }, alert: async kind => { alerts.push(kind); }, log: () => undefined,
        rpc: async operation => { if (operation === "read") { reads++; return { configured: true, deviceId: "device-fixture-1", refreshToken: "refresh-token-fixture-1", accessToken: null, generation: 4, refreshDue: true }; }
            if (operation === "rotate") throw new Error("store down"); return { recorded: true, alert: true }; },
        fetchImplementation: async () => Response.json({ access_token: "access-token-fixture-9", refresh_token: "refresh-token-fixture-9", expires_in: 3600 }) });
    await assert.rejects(lost.current(), BoostyCredentialUnavailable);
    assert.deepEqual(alerts, ["unavailable"]); assert.equal(reads, 2, "an unacknowledged rotation is checked against the store before giving up");
});

test("worker failures freeze evidence: no evidence write, stale-only marking, alerts and closed replies", async () => {
    const syncSecret = "boosty-sync-secret-fixture";
    const lease = { token: "bbbbbbbb-1111-4111-8111-111111111111", pollDue: true, lastCompleteCount: 100, now: polledAt };
    // Builds a worker over a recording RPC and the given API behavior.
    const harness = (api: Partial<BoostyApi>, credential: { reportFailure?: (reason: string) => Promise<void> } = {}) => {
        const calls: { operation: string; input: Record<string, unknown> }[] = [], alerts: string[] = [], reports: string[] = [];
        const rpc: BoostySyncRpc = async (operation, input) => {
            calls.push({ operation, input });
            if (operation === "acquire") return lease;
            if (operation === "linked") return [{ accountId, providerUserId: "4242", linkGeneration: "3", absentSince: null }];
            if (operation === "polled") return { alert: true };
            return {};
        };
        const fullApi: BoostyApi = { dialogs: async () => ({ dialogs: [], nextOffset: null }), messages: async () => [], subscribers: async () => ({ subscribers: [], total: 0 }), ...api };
        const handler = createBoostyMembershipHandler({ adapter: { policy, api: fullApi, credential: { current: async () => "a", replace: async () => null, reportFailure: credential.reportFailure ?? (async reason => { reports.push(reason); }) } },
            syncSecret, rpc, alert: async kind => { alerts.push(kind); }, log: () => undefined });
        const wake = async (key = syncSecret, method = "POST") => { const response = await handler(new Request("https://edge.invalid/boosty-membership", { method, headers: { "x-boosty-sync-key": key } })); return { status: response.status, code: (await response.json() as { code: string }).code }; };
        return { calls, alerts, reports, wake, operations: () => calls.map(call => call.operation) };
    };
    const unauthorized = harness({});
    assert.deepEqual(await unauthorized.wake("wrong-secret-value-x"), { status: 401, code: "unauthorized" });
    assert.deepEqual(await unauthorized.wake(syncSecret, "GET"), { status: 405, code: "method_not_allowed" });
    assert.deepEqual(unauthorized.calls, []);
    const disabled = createBoostyMembershipHandler({ adapter: null, syncSecret, rpc: async () => { throw new Error("no rpc"); }, alert: async () => undefined });
    assert.equal((await disabled(new Request("https://edge.invalid/", { method: "POST", headers: { "x-boosty-sync-key": syncSecret } }))).status, 503);

    const rejected = harness({ subscribers: async () => { throw new BoostyAuthError("x"); } });
    assert.deepEqual(await rejected.wake(), { status: 503, code: "credential_unavailable" });
    assert.deepEqual(rejected.operations(), ["acquire", "linked", "stale", "polled", "release"]); assert.deepEqual(rejected.reports, ["rejected"]);
    const shortList = harness({ subscribers: async () => ({ subscribers: [], total: 3 }) });
    assert.deepEqual(await shortList.wake(), { status: 503, code: "sync_incomplete" });
    assert.deepEqual(shortList.operations(), ["acquire", "linked", "stale", "polled", "release"]); assert.deepEqual(shortList.alerts, []);
    const outage = harness({ subscribers: async () => { throw new Error("Boosty unavailable"); } });
    assert.deepEqual(await outage.wake(), { status: 503, code: "sync_incomplete" });
    assert.ok(!outage.operations().includes("evidence"));
    const dropped = harness({ subscribers: async () => ({ subscribers: [{ id: "1", subscribed: true, blacklisted: false, levelId: "555", price: 500 }], total: 1 }) });
    assert.deepEqual(await dropped.wake(), { status: 503, code: "sync_incomplete" });
    assert.deepEqual(dropped.operations(), ["acquire", "linked", "stale", "polled", "release"]); assert.deepEqual(dropped.alerts, ["breaker_tripped"]);
    assert.deepEqual(dropped.calls.find(call => call.operation === "polled")?.input, { token: lease.token, complete: false, tripped: true, total: null });
    const dialogFailure = harness({ dialogs: async () => { throw new Error("Boosty unavailable"); }, subscribers: async () => ({ subscribers: Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1), subscribed: true, blacklisted: false, levelId: "555", price: 500 })), total: 100 }) });
    assert.deepEqual(await dialogFailure.wake(), { status: 503, code: "sync_incomplete" });
    assert.deepEqual(dialogFailure.operations(), ["acquire", "linked", "evidence", "polled", "release"], "a failed link scan does not block a complete poll");
    const evidence = dialogFailure.calls.find(call => call.operation === "evidence")!.input.results as { evidence: { verification: string; paidAccessEndedAt?: string }; absentSince: string }[];
    assert.deepEqual([evidence[0].evidence.verification, evidence[0].evidence.paidAccessEndedAt, typeof evidence[0].absentSince], ["nonqualifying", undefined, "string"], "a first absence is not loss");
});

test("website-account Boosty operations are strict and inert while the adapter is unconfigured", async () => {
    const paths: string[] = [];
    const handler = createWebsiteAccountHandler({ supabaseUrl: "https://project.supabase.co", serviceRoleKey: "synthetic-service-key", policy: null, boosty: null,
        fetch: async input => {
            const path = new URL(String(input)).pathname; paths.push(path);
            if (path === "/rest/v1/rpc/website_session_context") return Response.json({ impersonationId: null });
            if (path === "/auth/v1/user") return Response.json({ id: accountId, identities: [] });
            throw new Error(`unexpected ${path}`);
        } });
    // Sends one authenticated website-account request.
    const call = async (body: unknown) => { const response = await handler(new Request("https://project.supabase.co/functions/v1/website-account", { method: "POST", headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" }, body: JSON.stringify(body) })); return { status: response.status, body: await response.json() }; };
    assert.deepEqual(await call({ operation: "boosty-status" }), { status: 200, body: { version: 1, configured: false } });
    assert.deepEqual(await call({ operation: "boosty-start" }), { status: 409, body: { error: "not_configured" } });
    for (const bad of [{ operation: "boosty-status", code: "BLC-AB12C-DE34F", extra: 1 }, { operation: "boosty-status", code: "blc-ab12c-de34f" }, { operation: "boosty-link" }]) assert.equal((await call(bad)).status, 400);
    assert.ok(paths.every(path => !path.startsWith("/rest/v1/rpc/boosty")));
});
