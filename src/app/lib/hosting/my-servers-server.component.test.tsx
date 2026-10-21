// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getMyServerManagers, getMyServerMoveStatus, getMyServerNotices, getMyServerSummary, getMyServerStartStatus, getServerOnboarding, listAllMyServers } from "./my-servers-server";
import { onboardingRegion, onboardingSummary } from "../../../../tests/onboarding-fixtures";

const TOKEN = "access-token-with-enough-characters";
const headers = { "content-type": "application/json" };
const server = { serverId: "11111111-1111-4111-8111-111111111111", displayName: "Campaign 👨‍👩‍👧‍👦",
    accessRole: "owner", friendlyRegion: "united-states", operationState: "running", observedGameState: "running",
    releaseChannel: "stable", updatedAt: "2026-09-30T22:00:00.000Z", connectionIp: "203.0.113.10", gamePorts: [4203] };
const page = { items: [server], nextCursor: null };
type Input = { requestId: string; operation: string; input: { serverId?: string; cursor?: string | null; limit?: number } };
const input = (init?: RequestInit) => JSON.parse(String(init?.body)) as Input;
const accepted = (request: Input, result: unknown = page) => Response.json({ version: 1, requestId: request.requestId, ok: true, result });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("reads every owner page afresh through the fixed route with current roles and optional join fields", async () => {
    const requestIds = new Set<string>();
    let calls = 0;
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://control-plane.bannerlordcoop.com/v1/user/control-plane");
        expect(init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "manual" });
        const request = input(init), actual = new Headers(init?.headers);
        expect(request).toEqual({ version: 1, requestId: expect.any(String), operation: "my-servers",
            input: { cursor: calls % 2 ? "next-page" : null, limit: 100 } });
        expect(actual.get("authorization")).toBe(`Bearer ${TOKEN}`);
        expect(actual.get("x-request-id")).toBe(request.requestId);
        for (const name of ["cookie", "apikey", "x-control-plane-protected-admin"]) expect(actual.get(name)).toBeNull();
        expect(requestIds.has(request.requestId)).toBe(false); requestIds.add(request.requestId);
        calls++;
        return accepted(request, { items: [{ ...server, serverId: `00000000-0000-4000-8000-${String(calls).padStart(12, "0")}`, accessRole: calls % 2 ? "owner" : "support" }],
            nextCursor: calls % 2 ? "next-page" : null });
    });
    vi.stubGlobal("fetch", fetch);
    const first = await listAllMyServers(TOKEN), second = await listAllMyServers(TOKEN);
    expect(first.map(row => row.serverId.slice(-1))).toEqual(["1", "2"]);
    expect(second.map(row => row.serverId.slice(-1))).toEqual(["3", "4"]);
    expect(first.map(row => row.accessRole)).toEqual(["owner", "support"]);
    expect(first[0]).toMatchObject({ displayName: server.displayName, connectionIp: server.connectionIp, gamePorts: [4203] });
    expect(first[0]).not.toHaveProperty("visibility");
    expect(fetch).toHaveBeenCalledTimes(4);
});

it("honors fresh grant or session rejection instead of reusing an earlier inventory", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => ++calls === 1 ? accepted(input(init))
        : Response.json({ version: 1, requestId: input(init).requestId, ok: false,
            error: { code: "forbidden", message: "Current server access is required.", retryable: false } }, { status: 403 }));
    expect(await listAllMyServers(TOKEN)).toEqual([server]);
    await expect(listAllMyServers(TOKEN)).rejects.toMatchObject({ code: "forbidden", retryable: false });
    expect(calls).toBe(2);
});

it.each([301, 302, 303, 307, 308])("refuses redirect %s without a second request or fallback", async status => {
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status, headers: { location: "https://other.test/private" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(listAllMyServers(TOKEN)).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetch).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
});

it.each([["inventory", listAllMyServers], ["onboarding", getServerOnboarding]] as const)("rejects invalid tokens and pre-cancelled %s reads before transport", async (_name, read) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const token of ["short", "x".repeat(8193)]) await expect(read(token)).rejects.toMatchObject({ code: "invalid_request" });
    const caller = new AbortController(); caller.abort();
    await expect(read(TOKEN, caller.signal)).rejects.toMatchObject(read === listAllMyServers ? { name: "AbortError" } : { code: "server_api_unavailable" });
    expect(fetch).not.toHaveBeenCalled();
});

it("reads onboarding eligibility and capacity afresh and propagates current authority rejection", async () => {
    const first = onboardingSummary(), next = onboardingSummary(); onboardingRegion(next, "us-west").available = false;
    next.eligibility = { ...next.eligibility, used: 1, remaining: 0, eligible: false, reason: "quota_exhausted" };
    let calls = 0;
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://control-plane.bannerlordcoop.com/v1/user/control-plane");
        expect(init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "manual" });
        const request = input(init);
        expect(request).toEqual({ version: 1, requestId: expect.any(String), operation: "server-onboarding", input: { version: 3 } });
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
        if (++calls < 3) return accepted(request, (calls === 1 ? first : next));
        return Response.json({ version: 1, requestId: request.requestId, ok: false,
            error: { code: "forbidden", message: "Current session is required.", retryable: false } }, { status: 403 });
    });
    expect(await getServerOnboarding(TOKEN)).toEqual(first);
    expect(await getServerOnboarding(TOKEN)).toEqual(next);
    await expect(getServerOnboarding(TOKEN)).rejects.toMatchObject({ code: "forbidden", retryable: false });
    expect(calls).toBe(3);
});

it("rejects malformed onboarding DTOs rather than displaying eligibility", async () => {
    for (const result of [{ ...onboardingSummary(), privateHost: "extra" }, { ...onboardingSummary(), regions: [] },
        { ...onboardingSummary(), eligibility: { ...onboardingSummary().eligibility, remaining: 100 } },
        { ...onboardingSummary(), version: 2 }]) {
        vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), result));
        await expect(getServerOnboarding(TOKEN)).rejects.toMatchObject({ code: "invalid_response" });
    }
});

it("reads the version-3 summary once and propagates any rejection without a second read", async () => {
    const inputs: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
        const request = input(init); inputs.push(request.input);
        return Response.json({ version: 1, requestId: request.requestId, ok: false,
            error: { code: "invalid_request", message: "The request is invalid.", retryable: false } }, { status: 400 });
    });
    await expect(getServerOnboarding(TOKEN)).rejects.toMatchObject({ code: "invalid_request" });
    expect(inputs).toEqual([{ version: 3 }]);
});

it("keeps the onboarding response at 64 KiB including streamed bodies and cancels overflow", async () => {
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.stringify({ version: 1, requestId: input(init).requestId, ok: true, result: onboardingSummary() });
        return new Response(body.padEnd(65_536, " "), { headers });
    });
    expect(await getServerOnboarding(TOKEN)).toEqual(onboardingSummary());
    for (const declared of [false, true]) {
        const cancel = vi.fn();
        vi.stubGlobal("fetch", async () => new Response(new ReadableStream({
            pull(controller) { controller.enqueue(new Uint8Array(65_537)); }, cancel,
        }), { headers: { ...headers, ...(declared ? { "content-length": "65537" } : {}) } }));
        await expect(getServerOnboarding(TOKEN)).rejects.toMatchObject({ code: "response_too_large" });
        expect(cancel).toHaveBeenCalledOnce();
    }
});

it("preserves strict owner envelope, status, correlation and error validation", async () => {
    const cases = [
        () => ({ body: { version: 1, requestId: "wrong", ok: true, result: page }, status: 200 }),
        (request: Input) => ({ body: { version: 1, requestId: request.requestId, ok: true, result: page }, status: 403 }),
        (request: Input) => ({ body: { version: 1, requestId: request.requestId, ok: true, result: page, extra: true }, status: 200 }),
        (request: Input) => ({ body: { version: 1, requestId: request.requestId, ok: false, error: { code: "forbidden", message: "bad\nerror", retryable: false } }, status: 403 }),
        (request: Input) => ({ body: { version: 1, requestId: request.requestId, ok: false, error: { code: "forbidden", message: "Access denied.", retryable: false, detail: "extra" } }, status: 403 }),
    ];
    for (const create of cases) {
        vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => { const { body, status } = create(input(init)); return Response.json(body, { status }); });
        await expect(listAllMyServers(TOKEN)).rejects.toMatchObject({ code: "invalid_response" });
    }
});

it("bounds pagination and rejects duplicate rows, excessive items and malformed cursors", async () => {
    for (const nextCursor of ["", "x".repeat(2049), undefined]) {
        vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), { items: [], nextCursor }));
        await expect(listAllMyServers(TOKEN)).rejects.toMatchObject({ code: "invalid_response" });
    }
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), { items: Array(101).fill(server), nextCursor: null }));
    await expect(listAllMyServers(TOKEN)).rejects.toMatchObject({ code: "invalid_response" });
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), { ...page, nextCursor: "next" }));
    await expect(listAllMyServers(TOKEN)).rejects.toMatchObject({ code: "invalid_response" });
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), { items: [], nextCursor: "next" }));
    vi.stubGlobal("fetch", fetch);
    await expect(listAllMyServers(TOKEN)).rejects.toMatchObject({ code: "response_too_large" });
    expect(fetch).toHaveBeenCalledTimes(10);
});

it("rejects malformed headers and streamed bytes or chunks over their limits, cancelling each body", async () => {
    for (const [extra, code] of [[{ "content-type": "text/html" }, "invalid_response"], [{ "content-length": "-1" }, "invalid_response"],
        [{ "content-length": "invalid" }, "invalid_response"], [{ "content-length": String(8 * 1048576 + 1) }, "response_too_large"]] as const) {
        const cancel = vi.fn();
        vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ cancel }), { headers: { ...headers, ...extra } }));
        await expect(listAllMyServers(TOKEN)).rejects.toMatchObject({ code }); expect(cancel).toHaveBeenCalledOnce();
    }
    for (const mode of ["bytes", "chunks", "utf8"] as const) {
        let pulls = 0; const cancel = vi.fn();
        vi.stubGlobal("fetch", async () => new Response(new ReadableStream({
            pull(controller) { pulls++; controller.enqueue(mode === "bytes" ? new Uint8Array(8 * 1048576 + 1) : mode === "utf8" ? new Uint8Array([0xff]) : new Uint8Array()); }, cancel,
        }), { headers }));
        await expect(listAllMyServers(TOKEN)).rejects.toMatchObject({ code: mode === "utf8" ? "invalid_response" : "response_too_large" });
        expect(cancel).toHaveBeenCalledOnce(); expect(pulls).toBeLessThanOrEqual(8194);
    }
});

it("preserves Unicode split across response chunks", async () => {
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
        const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, requestId: input(init).requestId, ok: true, result: page }));
        const split = bytes.indexOf(0xf0) + 1;
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, split)); controller.enqueue(bytes.subarray(split)); controller.close(); } }), { headers });
    });
    expect(await listAllMyServers(TOKEN)).toEqual([server]);
});

it.each(["caller", "deadline"])("cancels stalled inventory and onboarding response bodies on %s abort", async source => {
    for (const read of [listAllMyServers, getServerOnboarding]) {
        const caller = new AbortController(), deadline = new AbortController(), opened = Promise.withResolvers<void>(), cancel = vi.fn();
        vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => { expect(milliseconds).toBe(30_000); return deadline.signal; });
        vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ pull() { opened.resolve(); }, cancel }), { headers }));
        const rejected = expect(read(TOKEN, caller.signal)).rejects.toMatchObject({ code: "server_api_unavailable" });
        await opened.promise; (source === "caller" ? caller : deadline).abort();
        await rejected; expect(cancel).toHaveBeenCalledOnce();
    }
});

it("uses the closed owner read in native workerd with fresh pages and no redirected credentials", async () => {
    const bundled = await build({ stdin: { contents: `import { getMyServerSummary, getServerOnboarding, listAllMyServers } from "./my-servers-server";
        export default { async fetch(request) { try { return Response.json(await (request.url.endsWith("/summary") ? getMyServerSummary("${TOKEN}", "${server.serverId}") : (request.url.endsWith("/onboarding") ? getServerOnboarding : listAllMyServers)("${TOKEN}"))); }
        catch(error) { return Response.json({ error: error.code }, { status: 502 }); } } };`, resolveDir: dirname(fileURLToPath(import.meta.url)) },
        bundle: true, format: "esm", platform: "browser", write: false, external: ["node:net"],
        alias: { "server-only": fileURLToPath(new URL("../../../../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)) } });
    let calls = 0, redirectStatus = 0;
    const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "direct-owner-test", modules: true, script: bundled.outputFiles[0].text,
        compatibilityDate: "2026-08-31", compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
        outboundService: async request => {
            calls++; expect(request.url).toBe("https://control-plane.bannerlordcoop.com/v1/user/control-plane"); expect(request.method).toBe("POST");
            expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
            for (const name of ["cookie", "apikey", "x-control-plane-protected-admin"]) expect(request.headers.get(name)).toBeNull();
            const body = await request.json() as Input; expect(body.requestId).toBe(request.headers.get("x-request-id"));
            expect(["my-servers", "server-onboarding", "server-summary"]).toContain(body.operation);
            expect(body.input).toEqual(body.operation === "my-servers" ? { cursor: null, limit: 100 } : body.operation === "server-summary" ? { serverId: server.serverId, includeRuntimeInsight: true } : { version: 3 });
            if (redirectStatus) return new Response(null, { status: redirectStatus, headers: { location: "https://other.test/private" } });
            if (body.operation === "server-summary") return accepted(body, summary);
            const onboarding = onboardingSummary(); onboardingRegion(onboarding, "us-west").available = calls % 2 === 0;
            return accepted(body, body.operation === "server-onboarding" ? onboarding
                : { items: [{ ...server, displayName: `Current ${calls} 👨‍👩‍👧‍👦` }], nextCursor: null });
        },
    }] }));
    try {
        for (let revision = 1; revision <= 2; revision++) expect(await (await runtime.dispatchFetch("http://localhost/")).json()).toEqual([{ ...server, displayName: `Current ${revision} 👨‍👩‍👧‍👦` }]);
        for (let revision = 1; revision <= 2; revision++) {
            const summary = onboardingSummary(); onboardingRegion(summary, "us-west").available = revision % 2 === 0;
            expect(await (await runtime.dispatchFetch("http://localhost/onboarding")).json()).toEqual(summary);
        }
        expect(await (await runtime.dispatchFetch("http://localhost/summary")).json()).toEqual(summary);
        for (const status of [301, 302, 303, 307, 308]) for (const path of ["/", "/onboarding", "/summary"]) {
            redirectStatus = status; const before = calls;
            expect(await (await runtime.dispatchFetch(`http://localhost${path}`)).json()).toEqual({ error: "invalid_response" }); expect(calls).toBe(before + 1); }
    } finally { await runtime.dispose(); }
});

const startJobId = "22222222-2222-4222-8222-222222222222";
const startStatus = { serverId: server.serverId, jobId: startJobId, state: "running", phase: "starting", progress: "Loading your campaign" };
it("reads only the exact accepted Start afresh and propagates access revocation", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const request = input(init);
        expect(request).toMatchObject({ operation: "server-start-status", input: { serverId: server.serverId, jobId: startJobId } });
        expect(init).toMatchObject({ cache: "no-store", redirect: "manual", credentials: "omit" });
        return accepted(request, startStatus);
    });
    vi.stubGlobal("fetch", fetch);
    expect(await getMyServerStartStatus(TOKEN, server.serverId, startJobId)).toEqual(startStatus);
    fetch.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => Response.json({ version: 1,
        requestId: input(init).requestId, ok: false, error: { code: "forbidden", message: "Access removed", retryable: false } }, { status: 403 }));
    await expect(getMyServerStartStatus(TOKEN, server.serverId, startJobId)).rejects.toMatchObject({ code: "forbidden" });
    expect(fetch).toHaveBeenCalledTimes(2);
});

it("accepts a failed Start's mod-load diagnosis only in its closed shape", async () => {
    const failed = { ...startStatus, state: "failed", progress: "Mod Broken.Mod failed to load. Disable it and start again." };
    for (const modLoadFailure of [{ modId: "Broken.Mod", reason: "load-error" }, { modId: "Broken.Mod", reason: "missing-dll" },
        { modId: "Broken.Mod", reason: "missing-assembly", assembly: "TaleWorlds.CampaignSystem.ViewModelCollection" }]) {
        vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), { ...failed, modLoadFailure }));
        expect(await getMyServerStartStatus(TOKEN, server.serverId, startJobId)).toEqual({ ...failed, modLoadFailure });
    }
    for (const result of [
        { ...startStatus, modLoadFailure: { modId: "Broken.Mod", reason: "load-error" } },
        { ...failed, modLoadFailure: { modId: "Broken.Mod", reason: "missing-assembly" } },
        { ...failed, modLoadFailure: { modId: "Broken.Mod", reason: "load-error", assembly: "X" } },
        { ...failed, modLoadFailure: { modId: "../etc", reason: "load-error" } },
        { ...failed, modLoadFailure: { modId: "Broken.Mod", reason: "unknown" } },
        { ...failed, modLoadFailure: null },
    ]) {
        vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), result));
        await expect(getMyServerStartStatus(TOKEN, server.serverId, startJobId)).rejects.toMatchObject({ code: "invalid_response" });
    }
});

it.each([
    { ...startStatus, serverId: startJobId }, { ...startStatus, jobId: server.serverId },
    { ...startStatus, phase: "ready" }, { ...startStatus, state: "succeeded" },
    { ...startStatus, state: "unknown" }, { ...startStatus, phase: "unknown" },
    { ...startStatus, progress: "Private\ntext" }, { ...startStatus, progress: "x".repeat(257) },
    { ...startStatus, privateStage: "extra" },
])("rejects malformed or mismatched Start status %j", async result => {
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), result));
    await expect(getMyServerStartStatus(TOKEN, server.serverId, startJobId)).rejects.toMatchObject({ code: "invalid_response" });
});

const summary = { ...server, maintenanceSlot: "06:00-07:00", timezone: "America/Chicago", visibility: "private" };

const failedStartInsight = { action: "start", jobId: startJobId, state: "failed", phase: "failed", progress: "The game crashed while loading. Automatic retries have stopped. Attempt 1 of 5.",
    attemptCount: 1, maximumAttempts: 5, nextRetryAt: null, stoppedRetrying: true, failureCode: "game_crashed_during_load", recommendedAction: "review-backups" };
const runtimeInsight = { desiredState: "running", observedAt: server.updatedAt, allowedActions: ["start"], crashLoopDetected: false,
    failureCode: "game_crashed_during_load", recommendedAction: "review-backups", failureMessage: "The game crashed while loading.", recommendation: "Review backups before choosing recovery.", start: failedStartInsight };

it("reads the opt-in failure and attempt receipt through both owner reads", async () => {
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
        const request = input(init);
        expect(request.input).toHaveProperty("includeRuntimeInsight", true);
        return accepted(request, request.operation === "server-summary" ? { ...summary, runtimeInsight } : { serverId: server.serverId, ...failedStartInsight });
    });
    expect(await getMyServerSummary(TOKEN, server.serverId)).toEqual({ ...summary, runtimeInsight });
    expect(await getMyServerStartStatus(TOKEN, server.serverId, startJobId)).toEqual({ serverId: server.serverId, ...failedStartInsight });
});

it.each(["server-summary", "server-start-status"])("falls back only after an old control plane rejects the opt-in: %s", async operation => {
    const inputs: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
        const request = input(init); inputs.push(request.input);
        if (inputs.length === 1) return Response.json({ version: 1, requestId: request.requestId, ok: false,
            error: { code: "invalid_request", message: "Invalid request", retryable: false } }, { status: 400 });
        expect(request.input).not.toHaveProperty("includeRuntimeInsight");
        return accepted(request, operation === "server-summary" ? summary : startStatus);
    });
    if (operation === "server-summary") expect(await getMyServerSummary(TOKEN, server.serverId)).toEqual(summary);
    else expect(await getMyServerStartStatus(TOKEN, server.serverId, startJobId)).toEqual(startStatus);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveProperty("includeRuntimeInsight", true);
});

it.each([{ ...runtimeInsight, allowedActions: ["start", "stop"] }, { ...runtimeInsight, privatePath: "extra" },
    { ...runtimeInsight, desiredState: "suspended" }, { ...runtimeInsight, start: { ...failedStartInsight, nextRetryAt: server.updatedAt } },
    { ...runtimeInsight, start: { ...failedStartInsight, attemptCount: 6 } },
    { ...runtimeInsight, start: { ...failedStartInsight, phase: "preparing" } },
    { ...runtimeInsight, crashLoopDetected: true }, { ...runtimeInsight, desiredState: "deleted" }])("rejects malformed runtime insight without legacy fallback: %j", async runtimeInsight => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), { ...summary, runtimeInsight }));
    vi.stubGlobal("fetch", fetch);
    await expect(getMyServerSummary(TOKEN, server.serverId)).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetch).toHaveBeenCalledOnce();
});

it.each([0, 999])("reads fleet target %s with one request rather than ten inventory pages", async index => {
    const fleet = Array.from({ length: 1000 }, (_, row) => ({ ...summary, serverId: `00000000-0000-4000-8000-${String(row + 1).padStart(12, "0")}` }));
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const request = input(init);
        if (request.operation === "server-summary") {
            expect(request.input).toEqual({ serverId: fleet[index].serverId, includeRuntimeInsight: true });
            expect(init).toMatchObject({ cache: "no-store", redirect: "manual", credentials: "omit" });
            expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
            return accepted(request, fleet[index]);
        }
        const offset = Number(request.input.cursor ?? 0);
        return accepted(request, { items: fleet.slice(offset, offset + 100), nextCursor: offset < 900 ? String(offset + 100) : null });
    });
    vi.stubGlobal("fetch", fetch);
    expect((await listAllMyServers(TOKEN))[index]).toEqual(fleet[index]);
    expect(fetch).toHaveBeenCalledTimes(10);
    fetch.mockClear();
    expect(await getMyServerSummary(TOKEN, fleet[index].serverId)).toEqual(fleet[index]);
    expect(fetch).toHaveBeenCalledOnce();
});

it.each(["server_not_found", "forbidden", "invalid_request"])("propagates %s without inventory fallback or reuse of an earlier summary", async code => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), summary));
    vi.stubGlobal("fetch", fetch);
    expect(await getMyServerSummary(TOKEN, server.serverId)).toEqual(summary);
    fetch.mockImplementation(async (_url, init) => Response.json({ version: 1, requestId: input(init).requestId, ok: false,
        error: { code, message: "Unavailable", retryable: false } }, { status: code === "forbidden" ? 403 : 404 }));
    await expect(getMyServerSummary(TOKEN, server.serverId)).rejects.toMatchObject({ code });
    expect(fetch).toHaveBeenCalledTimes(code === "invalid_request" ? 3 : 2);
});

it.each([
    { ...summary, serverId: "22222222-2222-4222-8222-222222222222" },
    { ...summary, updatedAt: "yesterday" }, { ...summary, accessRole: "administrator" },
    { ...summary, operationState: "unbounded".repeat(20) }, { ...summary, observedGameState: "invalid" },
    { ...summary, gamePorts: [65536] }, { ...summary, connectionIp: "https://private.test" },
    { ...summary, visibility: "unlisted" }, { ...summary, maintenanceSlot: undefined },
    { ...summary, privatePayload: "must not enter presentation" }, null,
])("rejects malformed or wrong-server summary %j", async result => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), result));
    vi.stubGlobal("fetch", fetch);
    await expect(getMyServerSummary(TOKEN, server.serverId)).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetch).toHaveBeenCalledOnce();
});

it("validates identifiers, tokens and cancellation before one-server transport, and bounds the streamed response", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(getMyServerSummary(TOKEN, "invalid")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(getMyServerSummary("short", server.serverId)).rejects.toMatchObject({ code: "invalid_request" });
    const caller = new AbortController(); caller.abort();
    await expect(getMyServerSummary(TOKEN, server.serverId, caller.signal)).rejects.toMatchObject({ code: "server_api_unavailable" });
    expect(fetch).not.toHaveBeenCalled();
    const cancel = vi.fn();
    fetch.mockResolvedValue(new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel }), { headers }));
    await expect(getMyServerSummary(TOKEN, server.serverId)).rejects.toMatchObject({ code: "response_too_large" });
    expect(cancel).toHaveBeenCalledOnce();
});

const notice = {
    noticeId: "66666666-6666-4666-8666-666666666666", kind: "administrator", severity: "warning", title: "Maintenance tonight",
    body: "The host restarts at 22:00 UTC.\nExpect a short outage.", parameters: {}, createdAt: "2026-10-18T09:00:00.000Z", expiresAt: null,
};
const scheduled = {
    ...notice, noticeId: "77777777-7777-4777-8777-777777777777", kind: "placement-scheduled",
    parameters: { scheduledAt: "2026-10-19T03:00:00.000Z", windowMinutes: 120 }, expiresAt: "2026-10-19T05:00:00.000Z",
};

it("reads this viewer's undismissed server notices through the closed owner read", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const request = input(init);
        expect(request).toEqual({ version: 1, requestId: expect.any(String), operation: "server-notices", input: { serverId: server.serverId } });
        expect(init).toMatchObject({ cache: "no-store", redirect: "manual", credentials: "omit" });
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
        return accepted(request, { serverId: server.serverId, notices: [notice, scheduled] });
    });
    vi.stubGlobal("fetch", fetch);
    expect(await getMyServerNotices(TOKEN, server.serverId)).toEqual([notice, scheduled]);
    fetch.mockImplementation(async (_url, init) => Response.json({ version: 1, requestId: input(init).requestId, ok: false,
        error: { code: "server_not_found", message: "Unavailable", retryable: false } }, { status: 404 }));
    await expect(getMyServerNotices(TOKEN, server.serverId)).rejects.toMatchObject({ code: "server_not_found" });
    expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([
    { serverId: "22222222-2222-4222-8222-222222222222", notices: [] },
    { serverId: server.serverId, notices: [notice], extra: true },
    { serverId: server.serverId, notices: Array.from({ length: 11 }, (_, index) => ({ ...notice, noticeId: `66666666-6666-4666-8666-${String(index).padStart(12, "0")}` })) },
    { serverId: server.serverId, notices: [notice, notice] },
    { serverId: server.serverId, notices: [{ ...notice, kind: "email" }] },
    { serverId: server.serverId, notices: [{ ...notice, severity: "critical" }] },
    { serverId: server.serverId, notices: [{ ...notice, title: "Two\nlines" }] },
    { serverId: server.serverId, notices: [{ ...notice, title: "x".repeat(121) }] },
    { serverId: server.serverId, notices: [{ ...notice, body: "" }] },
    { serverId: server.serverId, notices: [{ ...notice, body: "bell" + String.fromCharCode(7) }] },
    { serverId: server.serverId, notices: [{ ...notice, title: "delete" + String.fromCharCode(127) }] },
    { serverId: server.serverId, notices: [{ ...notice, parameters: { nested: { value: 1 } } }] },
    { serverId: server.serverId, notices: [{ ...notice, parameters: [] }] },
    { serverId: server.serverId, notices: [{ ...notice, createdAt: "yesterday" }] },
    { serverId: server.serverId, notices: [{ ...notice, html: "<b>bold</b>" }] },
    { serverId: server.serverId, notices: null },
])("rejects malformed or wrong-server notices %j", async result => {
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), result));
    await expect(getMyServerNotices(TOKEN, server.serverId)).rejects.toMatchObject({ code: "invalid_response" });
});

it("reads notices whose text has characters the control plane accepts, such as a pasted next-line", async () => {
    // U+0085 and the other C1 characters pass the control plane's validation, so they must not hide the banner.
    const pasted = { ...notice, title: "Maintenance\u0085tonight", body: "Line one\u0085line two\n\tindented" };
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), { serverId: server.serverId, notices: [pasted] }));
    expect(await getMyServerNotices(TOKEN, server.serverId)).toEqual([pasted]);
});

it("validates the server ID and token before reading notices", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(getMyServerNotices(TOKEN, "invalid")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(getMyServerNotices("short", server.serverId)).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetch).not.toHaveBeenCalled();
});

const moving = {
    state: "moving", scheduledAt: "2026-10-19T03:00:00.000Z", startedAt: "2026-10-19T03:01:00.000Z", completedAt: null,
    step: "restoring", address: null, stayedOnOriginal: null,
};
const scheduledMove = { ...moving, state: "scheduled", startedAt: null, step: null };
const returning = { ...moving, state: "returning", step: null };
const moved = { ...moving, state: "moved", scheduledAt: null, completedAt: "2026-10-19T03:20:00.000Z", step: null, address: "203.0.113.20:4201" };
const failed = { ...moved, state: "failed", address: null, stayedOnOriginal: true };

it("reads the server's move status through the closed owner read", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const request = input(init);
        expect(request).toEqual({ version: 1, requestId: expect.any(String), operation: "server-move-status", input: { serverId: server.serverId } });
        expect(init).toMatchObject({ cache: "no-store", redirect: "manual", credentials: "omit" });
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
        return accepted(request, { serverId: server.serverId, move: moving });
    });
    vi.stubGlobal("fetch", fetch);
    expect(await getMyServerMoveStatus(TOKEN, server.serverId)).toEqual(moving);
    // An older control plane rejects the unknown operation; callers treat that as no move.
    fetch.mockImplementation(async (_url, init) => Response.json({ version: 1, requestId: input(init).requestId, ok: false,
        error: { code: "invalid_request", message: "Unknown operation", retryable: false } }, { status: 400 }));
    await expect(getMyServerMoveStatus(TOKEN, server.serverId)).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([
    null,
    scheduledMove,
    { ...scheduledMove, state: "starting" },
    { ...moving, step: null },
    { ...moving, scheduledAt: null },
    returning,
    { ...returning, scheduledAt: null },
    moved,
    { ...moved, address: "[2001:db8::1]:4201" },
    { ...moved, address: null },
    failed,
    { ...failed, stayedOnOriginal: false },
])("accepts the move status %j", async move => {
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), { serverId: server.serverId, move }));
    expect(await getMyServerMoveStatus(TOKEN, server.serverId)).toEqual(move);
});

it.each([
    null,
    { serverId: "22222222-2222-4222-8222-222222222222", move: null },
    { serverId: server.serverId },
    { serverId: server.serverId, move: null, notices: [] },
    { serverId: server.serverId, move: [] },
    { serverId: server.serverId, move: { ...moving, jobId: "33333333-3333-4333-8333-333333333333" } },
    { serverId: server.serverId, move: { state: "moving", step: "restoring" } },
    { serverId: server.serverId, move: { ...moving, state: "paused" } },
    { serverId: server.serverId, move: { ...moving, step: "copying" } },
    { serverId: server.serverId, move: { ...moved, step: "finishing" } },
    { serverId: server.serverId, move: { ...moving, startedAt: "2026-10-19 03:01" } },
    { serverId: server.serverId, move: { ...moving, startedAt: "2026-10-19T03:01:00Z" } },
    { serverId: server.serverId, move: { ...moving, scheduledAt: 1_760_000_000_000 } },
    { serverId: server.serverId, move: { ...moved, completedAt: "2026-02-30T03:20:00.000Z" } },
    { serverId: server.serverId, move: { ...scheduledMove, scheduledAt: null } },
    { serverId: server.serverId, move: { ...moved, completedAt: null } },
    { serverId: server.serverId, move: { ...moving, address: "203.0.113.20:4201" } },
    // Each state carries exactly its own fields.
    { serverId: server.serverId, move: { ...scheduledMove, startedAt: "2026-10-19T03:01:00.000Z" } },
    { serverId: server.serverId, move: { ...scheduledMove, completedAt: "2026-10-19T03:20:00.000Z" } },
    { serverId: server.serverId, move: { ...scheduledMove, step: "preparing" } },
    { serverId: server.serverId, move: { ...scheduledMove, state: "starting", scheduledAt: null } },
    { serverId: server.serverId, move: { ...scheduledMove, state: "starting", startedAt: "2026-10-19T03:01:00.000Z" } },
    { serverId: server.serverId, move: { ...moving, startedAt: null } },
    { serverId: server.serverId, move: { ...moving, completedAt: "2026-10-19T03:20:00.000Z" } },
    { serverId: server.serverId, move: { ...moving, stayedOnOriginal: false } },
    { serverId: server.serverId, move: { ...returning, step: "switching-address" } },
    { serverId: server.serverId, move: { ...returning, startedAt: null } },
    { serverId: server.serverId, move: { ...returning, completedAt: "2026-10-19T03:20:00.000Z" } },
    { serverId: server.serverId, move: { ...moved, scheduledAt: "2026-10-19T03:00:00.000Z" } },
    { serverId: server.serverId, move: { ...moved, startedAt: null } },
    { serverId: server.serverId, move: { ...failed, scheduledAt: "2026-10-19T03:00:00.000Z" } },
    { serverId: server.serverId, move: { ...failed, startedAt: null } },
    { serverId: server.serverId, move: { ...failed, completedAt: null } },
    { serverId: server.serverId, move: { ...failed, stayedOnOriginal: null } },
    { serverId: server.serverId, move: { ...failed, address: "203.0.113.20:4201" } },
    { serverId: server.serverId, move: { ...moved, address: "javascript:alert(1)" } },
    { serverId: server.serverId, move: { ...moved, address: "203.0.113.300:4201" } },
    { serverId: server.serverId, move: { ...moved, address: "203.0.113.20:70000" } },
    { serverId: server.serverId, move: { ...moved, address: "203.0.113.20:0" } },
    { serverId: server.serverId, move: { ...moved, address: "203.0.113.20" } },
    { serverId: server.serverId, move: { ...moved, address: "2001:db8::1:4201" } },
    { serverId: server.serverId, move: { ...moved, address: "[2001:db8::zz]:4201" } },
    { serverId: server.serverId, move: { ...moved, address: "play.example.com:4201" } },
    { serverId: server.serverId, move: { ...moved, address: 4201 } },
    { serverId: server.serverId, move: { ...moved, stayedOnOriginal: true } },
    { serverId: server.serverId, move: { ...failed, stayedOnOriginal: "yes" } },
])("rejects malformed or wrong-server move status %j", async result => {
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), result));
    await expect(getMyServerMoveStatus(TOKEN, server.serverId)).rejects.toMatchObject({ code: "invalid_response" });
});

it("validates the server ID and token before reading move status", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(getMyServerMoveStatus(TOKEN, "invalid")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(getMyServerMoveStatus("short", server.serverId)).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetch).not.toHaveBeenCalled();
});

it("reads the owner's manager grants through the closed owner read", async () => {
    const managers = [
        { accountId: "22222222-2222-4222-8222-222222222222", grantedAt: "2026-10-01T00:00:00.000Z" },
        { accountId: "123456789012345678", grantedAt: "2026-10-02T00:00:00.000Z" },
    ];
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const request = input(init);
        expect(request).toEqual({ version: 1, requestId: expect.any(String), operation: "server-managers", input: { serverId: server.serverId } });
        expect(init).toMatchObject({ cache: "no-store", redirect: "manual", credentials: "omit" });
        return accepted(request, { serverId: server.serverId, managers });
    });
    vi.stubGlobal("fetch", fetch);
    expect(await getMyServerManagers(TOKEN, server.serverId)).toEqual(managers);
});

it.each([
    { serverId: "11111111-1111-4111-8111-999999999999", managers: [] },
    { serverId: "11111111-1111-4111-8111-111111111111", managers: [{ accountId: "not-an-account", grantedAt: "2026-10-01T00:00:00.000Z" }] },
    { serverId: "11111111-1111-4111-8111-111111111111", managers: [{ accountId: "22222222-2222-4222-8222-222222222222", grantedAt: "yesterday" }] },
    { serverId: "11111111-1111-4111-8111-111111111111", managers: [{ accountId: "22222222-2222-4222-8222-222222222222", grantedAt: "2026-10-01T00:00:00.000Z", email: "x@example.com" }] },
    { serverId: "11111111-1111-4111-8111-111111111111", managers: Array.from({ length: 2 }, () => ({ accountId: "22222222-2222-4222-8222-222222222222", grantedAt: "2026-10-01T00:00:00.000Z" })) },
    { serverId: "11111111-1111-4111-8111-111111111111" },
])("rejects a malformed manager list %#", async (result) => {
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), result));
    await expect(getMyServerManagers(TOKEN, server.serverId)).rejects.toMatchObject({ code: "invalid_response" });
});
