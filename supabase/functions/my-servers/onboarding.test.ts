import assert from "node:assert/strict";
import test from "node:test";
import { createMyServersHandler } from "../_shared/my-servers.ts";
import { parseOnboardingIntent, parseOnboardingResult, parseOnboardingSummary, normalizeOnboardingName } from "../_shared/server-onboarding-contract.ts";
import { onboardingSummary, onboardingCreated, onboardingRequested, ONBOARDING_TEST_ID } from "../../../tests/onboarding-fixtures.ts";

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
        { version: 1, requestId: ONBOARDING_TEST_ID, operation: "server-onboarding", input: {} },
        { version: 1, requestId: ONBOARDING_TEST_ID, operation: "create-server", input: { displayName: "My Campaign", region: "us-west" } },
        { version: 1, requestId: ONBOARDING_TEST_ID, operation: "request-region", input: { region: "france" } },
    ]);
});
test("onboarding extension preserves existing lifecycle request ID spelling", async () => {
    const calls: unknown[] = [];
    const response = await handler({ outcome: "enqueued", jobId: ONBOARDING_TEST_ID, action: "start" }, calls)(request({ action: "start", serverId: ONBOARDING_TEST_ID, expectedUpdatedAt: "2026-09-07T14:00:00.000Z" }, ONBOARDING_TEST_ID.toUpperCase()));
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
    for (const region of ["united-states", "spain", "US-West", "", null]) assert.equal((await h(request({ ...create, region }))).status, 400);
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
    const variants = [null, {}, { ...summary, host: "private" }, { ...summary, regions: summary.regions.slice(1) },
        { ...summary, eligibility: { ...summary.eligibility, roleIds: [] } },
        { ...summary, eligibility: { ...summary.eligibility, reason: "patreon" } },
        { ...summary, eligibility: { ...summary.eligibility, remaining: 2 } },
        { ...summary, eligibility: { ...summary.eligibility, granted: -1 } },
        { ...summary, unavailableReason: "other" }, { ...summary, unavailableReason: "provisioning_paused" }];
    for (const variant of variants) assert.throws(() => parseOnboardingSummary(variant));
    for (const override of [{ region: "unknown" }, { label: "private hostname" }, { available: "true" }, { slot: "secret" }, { request: {} },
        { request: { ...onboardingRequested().request, region: "germany" } }, { request: { ...onboardingRequested().request, status: "fulfilled" } },
        { request: { ...onboardingRequested().request, createdAt: "2026-02-30T14:00:00.000Z" } }]) {
        const altered = onboardingSummary(); Object.assign(altered.regions[2], override);
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
test("onboarding Edge never forwards invalid success DTOs or inconsistent envelopes/status", async () => {
    for (const result of [{ ...onboardingSummary(), hostId: "private" }, { ...onboardingSummary(), regions: [] }]) {
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
