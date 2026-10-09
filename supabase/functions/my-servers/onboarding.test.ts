import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../_shared/my-servers.ts";
import { parseLegacyOnboardingSummary, parseOnboardingIntent, parseOnboardingResult, parseOnboardingSummary, normalizeOnboardingName, readOnboardingSummary } from "../_shared/server-onboarding-contract.ts";
import type { RegionFullEvent, RegionRequestedEvent } from "../_shared/region-alerts.ts";
import { legacyOnboardingSummary, onboardingSummary, onboardingRegion, onboardingCreated, onboardingRequested, ONBOARDING_TEST_ID, ONBOARDING_TEST_TIME } from "../../../tests/onboarding-fixtures.ts";

const token = "synthetic-jwt-for-contract-tests-only";
function request(body?: unknown, id: string | null = ONBOARDING_TEST_ID, query = body === undefined ? "?resource=onboarding" : "") {
    return new Request(`https://edge.example.test/${query}`, { method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${token}`, ...(id === null ? {} : { "x-request-id": id }), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function handler(result: unknown, calls: unknown[] = [], status = 200, error?: unknown) {
    return createMyServersHandler({ allowedOrigins: ["https://web.example.test"], controlPlaneUrl: "https://backend.example.test",
        fetchImplementation: async (url, init) => {
            assert.equal(String(url), "https://backend.example.test/v1/user/control-plane");
            assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
            const body = JSON.parse(init?.body as string); calls.push(body);
            return Response.json({ version: 1, requestId: body.requestId, ok: error === undefined,
                ...(error === undefined ? { result } : { error }) }, { status });
        } });
}
test("onboarding Edge routes fixed summary/create/request operations and lowercases durable UUIDs", async () => {
    const calls: unknown[] = [];
    assert.equal((await handler(onboardingSummary(), calls)(request())).status, 200);
    assert.equal((await handler(onboardingCreated(), calls)(request({ action: "create-server", displayName: "  My   Campaign  ", region: "us-west" }, ONBOARDING_TEST_ID.toUpperCase()))).status, 200);
    assert.equal((await handler(onboardingRequested(), calls)(request({ action: "request-region", region: "france" }))).status, 200);
    assert.deepEqual(calls, [
        // Region keys only: the control plane resolves them against its stored catalog.
        { version: 1, requestId: ONBOARDING_TEST_ID, operation: "server-onboarding", input: { version: 3 } },
        { version: 1, requestId: ONBOARDING_TEST_ID, operation: "create-server", input: { displayName: "My Campaign", region: "us-west" } },
        { version: 1, requestId: ONBOARDING_TEST_ID, operation: "request-region", input: { region: "france" } },
    ]);
});
test("onboarding Edge forwards a well-formed key the website catalog does not know; the control plane decides", async () => {
    const calls: Array<{ input: unknown }> = [];
    const receipt = { action: "request-region", request: { ...onboardingRequested().request, region: "japan" } };
    assert.equal((await handler(receipt, calls)(request({ action: "request-region", region: "japan" }))).status, 200);
    assert.deepEqual(calls.map((call) => call.input), [{ region: "japan" }]);
});
test("onboarding extension preserves existing backup request ID spelling", async () => {
    const calls: unknown[] = [];
    const response = await handler({ outcome: "enqueued", jobId: ONBOARDING_TEST_ID, action: "backup" }, calls)(request({ action: "create-backup", serverId: ONBOARDING_TEST_ID, expectedUpdatedAt: "2026-09-07T14:00:00.000Z" }, ONBOARDING_TEST_ID.toUpperCase()));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).requestId, ONBOARDING_TEST_ID.toUpperCase());
});
test("onboarding Edge rejects authority/slot/credential fields, invalid UUIDs, regions, names and queries without dispatch", async () => {
    const calls: unknown[] = []; const h = handler(onboardingCreated(), calls);
    const create = { action: "create-server", displayName: "My Campaign", region: "us-west" };
    for (const field of ["ownerId", "roleIds", "provider", "slotId", "hostId", "password", "expectedUpdatedAt", "requestId"]) {
        assert.equal((await h(request({ ...create, [field]: "forbidden" }))).status, 400);
    }
    for (const id of [null, "not-uuid", "00000000-0000-0000-0000-000000000000"]) assert.equal((await h(request(create, id))).status, 400);
    for (const region of ["US-West", "us_west", "x", "-west", "a".repeat(49), "", null, 1]) assert.equal((await h(request({ ...create, region }))).status, 400);
    // The browser can never choose hosts, and neither can the website: no placement is accepted or sent.
    assert.equal((await h(request({ ...create, placement: { countryCodes: ["PL"] } }))).status, 400);
    assert.equal((await h(request({ action: "request-region", region: "france", placement: { countryCodes: ["FR"] } }))).status, 400);
    for (const displayName of ["ab", "x".repeat(49), "@forbidden", "trailing-", "a\u200bb"]) assert.equal((await h(request({ ...create, displayName }))).status, 400);
    assert.equal((await h(request({ action: "request-region", region: "france", displayName: "My Campaign" }))).status, 400);
    assert.equal((await h(request(undefined, ONBOARDING_TEST_ID, "?resource=onboarding&ownerId=1"))).status, 400);
    assert.equal((await h(request(undefined, ONBOARDING_TEST_ID, "?resource=onboarding&resource=onboarding"))).status, 400);
    assert.equal(calls.length, 0);
});
test("onboarding safe DTO parsers reject incomplete, extra, inconsistent and invalid enums at every level", () => {
    const summary = onboardingSummary();
    assert.deepEqual(parseOnboardingSummary(summary), summary);
    for (const key of Object.keys(summary)) { const missing = { ...summary } as Record<string, unknown>; delete missing[key]; assert.throws(() => parseOnboardingSummary(missing)); }
    for (const key of Object.keys(summary.eligibility)) { const missing = { ...summary.eligibility } as Record<string, unknown>; delete missing[key]; assert.throws(() => parseOnboardingSummary({ ...summary, eligibility: missing })); }
    for (const key of Object.keys(summary.regions[0])) { const missing = { ...summary.regions[0] } as Record<string, unknown>; delete missing[key]; assert.throws(() => parseOnboardingSummary({ ...summary, regions: [missing, ...summary.regions.slice(1)] })); }
    const offered = { ...onboardingRequested().request, region: "france" };
    const retired = { ...onboardingRequested().request, region: "atlantis" };
    const stored = (region: string) => ({ region, available: false, request: null });
    assert.deepEqual(parseOnboardingSummary({ ...summary, otherRequests: [retired] }).otherRequests, [retired]);
    // The stored catalog need not equal the website catalog: any 1..32 unique well-formed keys, in stored order.
    for (const regions of [[...summary.regions].reverse(), summary.regions.slice(1), [stored("japan")], Array.from({ length: 32 }, (_, index) => stored(`region-${index}`))]) {
        assert.deepEqual(parseOnboardingSummary({ ...summary, regions }).regions, regions);
    }
    const requested = (region: string, requestId = ONBOARDING_TEST_ID) => ({ ...stored(region), request: { ...retired, region, requestId } });
    const variants = [null, {}, { ...summary, host: "private" }, { ...summary, regions: [] },
        { ...summary, version: 2 }, { ...summary, regions: Array.from({ length: 33 }, (_, index) => stored(`region-${index}`)) },
        { ...summary, regions: [stored("france"), stored("france")] }, { ...summary, regions: [stored("Japan")] }, { ...summary, regions: [stored("j")] },
        { ...summary, regions: null }, { ...summary, regions: [{ ...stored("japan"), label: "Japan" }] },
        { ...summary, otherRequests: [offered] }, { ...summary, otherRequests: [{ ...retired, region: "Atlantis" }] },
        // A request ID may appear only once across the catalog and the requests outside it.
        { ...summary, regions: [requested("france")], otherRequests: [retired] },
        { ...summary, regions: [requested("france"), requested("germany", ONBOARDING_TEST_ID.toUpperCase())] },
        { ...summary, otherRequests: [retired, { ...retired, region: "narnia" }] },
        { ...summary, otherRequests: Array.from({ length: 33 }, () => retired) }, { ...summary, otherRequests: null },
        { ...summary, eligibility: { ...summary.eligibility, roleIds: [] } },
        { ...summary, eligibility: { ...summary.eligibility, reason: "patreon" } },
        { ...summary, eligibility: { ...summary.eligibility, remaining: 2 } },
        { ...summary, eligibility: { ...summary.eligibility, granted: -1 } },
        { ...summary, unavailableReason: "other" }, { ...summary, unavailableReason: "provisioning_paused" }];
    for (const variant of variants) assert.throws(() => parseOnboardingSummary(variant));
    for (const override of [{ region: "Unknown" }, { label: "private hostname" }, { available: "true" }, { slot: "secret" }, { request: {} },
        { request: { ...onboardingRequested().request, region: "germany" } }, { request: { ...onboardingRequested().request, status: "fulfilled" } },
        { request: { ...onboardingRequested().request, createdAt: "2026-02-30T14:00:00.000Z" } }]) {
        const altered = onboardingSummary(); Object.assign(onboardingRegion(altered, "france"), override);
        assert.throws(() => parseOnboardingSummary(altered));
    }
    const created = onboardingCreated(); const expected = { action: "create-server", displayName: "My Campaign", region: "us-west" } as const;
    for (const override of [{ state: "running" }, { passwordManagement: "website" }, { serverId: "private-host" }, { password: "secret" }, { displayName: "Other Campaign" }, { createdAt: "yesterday" }, { region: "germany" }]) assert.throws(() => parseOnboardingResult({ ...created, ...override }, expected));
    assert.deepEqual(parseOnboardingResult(created, expected), created);
    for (const key of Object.keys(created)) { const missing = { ...created } as Record<string, unknown>; delete missing[key]; assert.throws(() => parseOnboardingResult(missing, expected)); }
    for (const key of Object.keys(onboardingRequested().request)) { const missing = { ...onboardingRequested().request } as Record<string, unknown>; delete missing[key]; assert.throws(() => parseOnboardingResult({ action: "request-region", request: missing }, { action: "request-region", region: "france" })); }
    assert.deepEqual(parseOnboardingResult(onboardingRequested(), { action: "request-region", region: "france" }), onboardingRequested());
    assert.equal(normalizeOnboardingName("  Ｍy  Campaign  "), "My Campaign");
    assert.equal(parseOnboardingIntent({ ...expected, requestId: ONBOARDING_TEST_ID.toUpperCase() }).requestId, ONBOARDING_TEST_ID);
});
// The legacy summary in version-3 form: the six fixed regions, in order, without labels or other requests.
function legacyAsVersion3() {
    const { regions, ...rest } = legacyOnboardingSummary();
    return { ...rest, version: 3, regions: regions.map(({ label: _label, ...entry }) => entry), otherRequests: [] };
}
// Serves an older control plane: `{version:3}` is an invalid request, `{}` returns the version-2 summary.
function legacyControlPlane(calls: Array<{ requestId: string; input: unknown }>, legacy: unknown = legacyOnboardingSummary()) {
    return createMyServersHandler({ allowedOrigins: ["https://web.example.test"], controlPlaneUrl: "https://backend.example.test",
        fetchImplementation: async (_url, init) => {
            const body = JSON.parse(init?.body as string); calls.push(body);
            if (body.operation !== "server-onboarding") return Response.json({ version: 1, requestId: body.requestId, ok: true, result: onboardingCreated() });
            if (Object.keys(body.input).length === 0) return Response.json({ version: 1, requestId: body.requestId, ok: true, result: legacy });
            return Response.json({ version: 1, requestId: body.requestId, ok: false,
                error: { code: "invalid_request", message: "The request is invalid.", retryable: false } }, { status: 400 });
        } });
}
test("version-2 summaries map their six fixed regions into the version-3 shape", async () => {
    assert.deepEqual(parseLegacyOnboardingSummary(legacyOnboardingSummary()), legacyAsVersion3());
    const legacy = legacyOnboardingSummary();
    const requested = { ...legacy, regions: legacy.regions.map((entry) => entry.region === "france" ? { ...entry, request: onboardingRequested().request } : entry) };
    assert.deepEqual(onboardingRegion(parseLegacyOnboardingSummary(requested), "france").request, onboardingRequested().request);
    for (const variant of [{ ...legacy, version: 3 }, { ...legacy, regions: [...legacy.regions].reverse() }, { ...legacy, regions: legacy.regions.slice(1) },
        { ...legacy, regions: legacy.regions.map((entry) => ({ ...entry, label: "Elsewhere" })) }, { ...legacy, otherRequests: [] },
        { ...legacy, regions: legacy.regions.map((entry) => ({ ...entry, available: "yes" })) }]) {
        assert.throws(() => parseLegacyOnboardingSummary(variant), JSON.stringify(variant).slice(0, 80));
    }
    // Only a version rejection falls back; any other failure propagates without a second read.
    const reads: unknown[] = [];
    await assert.rejects(readOnboardingSummary(async (request) => { reads.push(request.input); throw new Error("offline"); }, () => false), /offline/u);
    assert.deepEqual(reads, [{ version: 3 }]);
});
test("onboarding Edge falls back to the version-2 summary when an older control plane rejects version 3", async () => {
    const calls: Array<{ requestId: string; input: unknown }> = [];
    const response = await legacyControlPlane(calls)(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: 1, requestId: ONBOARDING_TEST_ID, ok: true, result: legacyAsVersion3() });
    assert.deepEqual(calls.map((call) => call.input), [{ version: 3 }, {}]);
    assert.equal(calls[0].requestId, ONBOARDING_TEST_ID);
    assert.notEqual(calls[1].requestId, ONBOARDING_TEST_ID);
    // A malformed version-2 summary is still rejected, never shown.
    const invalid = await legacyControlPlane([], { ...legacyOnboardingSummary(), regions: [] })(request());
    assert.equal(invalid.status, 502);
    // Key-only Create keeps working against the older control plane.
    const created = await legacyControlPlane(calls)(request({ action: "create-server", displayName: "My Campaign", region: "us-west" }));
    assert.equal(created.status, 200);
});
test("onboarding Edge does not fall back on other summary rejections", async () => {
    const calls: unknown[] = [];
    const response = await handler(null, calls, 403, { code: "forbidden", message: "Current access is required.", retryable: false })(request());
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { version: 1, requestId: ONBOARDING_TEST_ID, ok: false, error: { code: "forbidden", message: "Current access is required.", retryable: false } });
    assert.equal(calls.length, 1);
});
test("onboarding Edge never forwards invalid success DTOs or inconsistent envelopes/status", async () => {
    for (const result of [{ ...onboardingSummary(), hostId: "private" }, { ...onboardingSummary(), regions: [] }, { ...onboardingSummary(), version: 2 }]) {
        const response = await handler(result)(request()); assert.equal(response.status, 502); assert.equal((await response.json()).error.code, "invalid_response");
    }
    const create = { action: "create-server", displayName: "My Campaign", region: "us-west" };
    assert.equal((await handler({ ...onboardingCreated(), state: "running" })(request(create))).status, 502);
    assert.equal((await handler(onboardingCreated(), [], 409)(request(create))).status, 502);
    assert.equal((await handler(null, [], 200, { code: "rate_limited", message: "Wait", retryable: true })(request(create))).status, 502);
});
test("onboarding Edge preserves typed 400/404/409/429 errors and transport uncertainty", async () => {
    for (const [status, code] of [[400, "invalid_request"], [404, "server_not_found"], [409, "request_conflict"], [409, "capacity_unavailable"], [409, "rate_limited"], [429, "rate_limited"]] as const) {
        const response = await handler(null, [], status, { code, message: "Safe rejection", retryable: false })(request({ action: "request-region", region: "france" }));
        assert.equal(response.status, status); assert.equal((await response.json()).error.code, code);
    }
    const h = createMyServersHandler({ allowedOrigins: ["https://web.example.test"], controlPlaneUrl: "https://backend.example.test", fetchImplementation: async () => { throw new Error("lost"); } });
    const response = await h(request()); assert.equal(response.status, 502); assert.equal((await response.json()).error.retryable, true);
});

const JWT = `header.${Buffer.from(JSON.stringify({ sub: ONBOARDING_TEST_ID, email: "Owner@Example.test" }), "utf8").toString("base64url")}.signature`;
const REQUEST_REGION = { action: "request-region", region: "france" };
function alerting(result: unknown, events: RegionRequestedEvent[], options: { status?: number; error?: unknown; fail?: boolean } = {}) {
    return createMyServersHandler({ allowedOrigins: ["https://web.example.test"], controlPlaneUrl: "https://backend.example.test",
        fetchImplementation: async (_url, init) => {
            const body = JSON.parse(init?.body as string);
            return Response.json({ version: 1, requestId: body.requestId, ok: options.error === undefined, ...(options.error === undefined ? { result } : { error: options.error }) }, { status: options.status ?? 200 });
        },
        onRegionRequested: async (event) => { events.push(event); if (options.fail) throw new Error("smtp unavailable"); } });
}
function requestWithToken(body: unknown, bearer: string) {
    return new Request("https://edge.example.test/", { method: "POST", headers: { authorization: `Bearer ${bearer}`, "x-request-id": ONBOARDING_TEST_ID, "content-type": "application/json" }, body: JSON.stringify(body) });
}
test("onboarding Edge alerts once per newly accepted region request, never for dedupes, creates or failures", async () => {
    const events: RegionRequestedEvent[] = [];
    const accepted = await alerting(onboardingRequested(), events)(requestWithToken(REQUEST_REGION, JWT));
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { version: 1, requestId: ONBOARDING_TEST_ID, ok: true, result: onboardingRequested() });
    assert.deepEqual(events, [{ requestId: ONBOARDING_TEST_ID, region: "france", createdAt: ONBOARDING_TEST_TIME, requester: { accountId: ONBOARDING_TEST_ID, email: "owner@example.test" } }]);
    // Opaque bearer tokens still alert, without requester details.
    assert.equal((await alerting(onboardingRequested(), events)(request(REQUEST_REGION))).status, 200);
    assert.deepEqual(events[1], { requestId: ONBOARDING_TEST_ID, region: "france", createdAt: ONBOARDING_TEST_TIME, requester: { accountId: null, email: null } });
    // Dedupe receipts carry the existing request's UUID and must not alert again.
    const deduplicated = { action: "request-region", request: { ...onboardingRequested().request, requestId: "abcdefab-9999-4999-8999-999999999999" } };
    assert.equal((await alerting(deduplicated, events)(request(REQUEST_REGION))).status, 200);
    assert.equal((await alerting(onboardingCreated(), events)(request({ action: "create-server", displayName: "My Campaign", region: "us-west" }))).status, 200);
    assert.equal((await alerting({ action: "request-region", request: { ...onboardingRequested().request, status: "fulfilled" } }, events)(request(REQUEST_REGION))).status, 502);
    assert.equal((await alerting(null, events, { status: 409, error: { code: "capacity_available", message: "Create instead", retryable: false } })(request(REQUEST_REGION))).status, 409);
    assert.equal((await alerting(onboardingRequested(), events)(request({ ...REQUEST_REGION, region: "Spain" }))).status, 400);
    assert.equal(events.length, 2);
});
test("onboarding Edge returns the confirmed receipt unchanged when alerting fails", async () => {
    const events: RegionRequestedEvent[] = [];
    const response = await alerting(onboardingRequested(), events, { fail: true })(request(REQUEST_REGION));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, onboardingRequested());
    assert.equal(events.length, 1);
});

const CREATE_SERVER = { action: "create-server", displayName: "My Campaign", region: "us-west" };
// Serves the create receipt, then the follow-up summary (null simulates a lost summary response).
function creating(summary: unknown, events: RegionFullEvent[], operations: string[] = []) {
    return createMyServersHandler({ allowedOrigins: ["https://web.example.test"], controlPlaneUrl: "https://backend.example.test",
        fetchImplementation: async (_url, init) => {
            const body = JSON.parse(init?.body as string); operations.push(body.operation);
            if (body.operation === "server-onboarding" && summary === null) throw new Error("summary lost");
            return Response.json({ version: 1, requestId: body.requestId, ok: true, result: body.operation === "create-server" ? onboardingCreated() : summary });
        },
        onRegionFull: async (event) => { events.push(event); } });
}
// Builds a summary whose regions all report the given availability.
function summaryWith(available: boolean, unavailableReason: "provisioning_paused" | null = null) {
    return { ...onboardingSummary(), unavailableReason, regions: onboardingSummary().regions.map((entry) => ({ ...entry, available })) };
}
test("onboarding Edge alerts when a created server leaves its region full", async () => {
    const events: RegionFullEvent[] = []; const operations: string[] = [];
    const response = await creating(summaryWith(false), events, operations)(requestWithToken(CREATE_SERVER, JWT));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, onboardingCreated());
    assert.deepEqual(operations, ["create-server", "server-onboarding"]);
    assert.deepEqual(events, [{ region: "us-west", serverId: ONBOARDING_TEST_ID, createdAt: ONBOARDING_TEST_TIME, requester: { accountId: ONBOARDING_TEST_ID, email: "owner@example.test" } }]);
});
test("onboarding Edge sends no full-region alert while capacity remains, provisioning is unavailable or the summary fails", async () => {
    for (const summary of [summaryWith(true), summaryWith(false, "provisioning_paused"), null]) {
        const events: RegionFullEvent[] = [];
        const response = await creating(summary, events)(request(CREATE_SERVER));
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).result, onboardingCreated());
        assert.equal(events.length, 0);
    }
});
