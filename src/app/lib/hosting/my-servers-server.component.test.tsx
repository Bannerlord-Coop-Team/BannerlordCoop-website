// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getServerOnboarding, listAllMyServers } from "./my-servers-server";
import { onboardingSummary } from "../../../../tests/onboarding-fixtures";

const TOKEN = "access-token-with-enough-characters";
const headers = { "content-type": "application/json" };
const server = { serverId: "11111111-1111-4111-8111-111111111111", displayName: "Campaign 👨‍👩‍👧‍👦",
    accessRole: "owner", friendlyRegion: "united-states", operationState: "running", observedGameState: "running",
    releaseChannel: "stable", updatedAt: "2026-09-30T22:00:00.000Z", connectionIp: "203.0.113.10", gamePorts: [4203] };
const page = { items: [server], nextCursor: null };
type Input = { requestId: string; operation: string; input: { cursor?: string | null; limit?: number } };
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
    const first = onboardingSummary(), next = onboardingSummary(); next.regions[0].available = false;
    next.eligibility = { ...next.eligibility, used: 1, remaining: 0, eligible: false, reason: "quota_exhausted" };
    let calls = 0;
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://control-plane.bannerlordcoop.com/v1/user/control-plane");
        expect(init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "manual" });
        const request = input(init);
        expect(request).toEqual({ version: 1, requestId: expect.any(String), operation: "server-onboarding", input: {} });
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
        if (++calls < 3) return accepted(request, calls === 1 ? first : next);
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
        { ...onboardingSummary(), eligibility: { ...onboardingSummary().eligibility, remaining: 100 } }]) {
        vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => accepted(input(init), result));
        await expect(getServerOnboarding(TOKEN)).rejects.toMatchObject({ code: "invalid_response" });
    }
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
    const bundled = await build({ stdin: { contents: `import { getServerOnboarding, listAllMyServers } from "./my-servers-server";
        export default { async fetch(request) { try { return Response.json(await (request.url.endsWith("/onboarding") ? getServerOnboarding : listAllMyServers)("${TOKEN}")); }
        catch(error) { return Response.json({ error: error.code }, { status: 502 }); } } };`, resolveDir: dirname(fileURLToPath(import.meta.url)) },
        bundle: true, format: "esm", platform: "browser", write: false,
        alias: { "server-only": fileURLToPath(new URL("../../../../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)) } });
    let calls = 0, redirectStatus = 0;
    const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "direct-owner-test", modules: true, script: bundled.outputFiles[0].text,
        compatibilityDate: "2026-08-31", compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
        outboundService: async request => {
            calls++; expect(request.url).toBe("https://control-plane.bannerlordcoop.com/v1/user/control-plane"); expect(request.method).toBe("POST");
            expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
            for (const name of ["cookie", "apikey", "x-control-plane-protected-admin"]) expect(request.headers.get(name)).toBeNull();
            const body = await request.json() as Input; expect(body.requestId).toBe(request.headers.get("x-request-id"));
            expect(["my-servers", "server-onboarding"]).toContain(body.operation);
            expect(body.input).toEqual(body.operation === "my-servers" ? { cursor: null, limit: 100 } : {});
            if (redirectStatus) return new Response(null, { status: redirectStatus, headers: { location: "https://other.test/private" } });
            const summary = onboardingSummary(); summary.regions[0].available = calls % 2 === 0;
            return accepted(body, body.operation === "server-onboarding" ? summary
                : { items: [{ ...server, displayName: `Current ${calls} 👨‍👩‍👧‍👦` }], nextCursor: null });
        },
    }] }));
    try {
        for (let revision = 1; revision <= 2; revision++) expect(await (await runtime.dispatchFetch("http://localhost/")).json()).toEqual([{ ...server, displayName: `Current ${revision} 👨‍👩‍👧‍👦` }]);
        for (let revision = 1; revision <= 2; revision++) {
            const summary = onboardingSummary(); summary.regions[0].available = revision % 2 === 0;
            expect(await (await runtime.dispatchFetch("http://localhost/onboarding")).json()).toEqual(summary);
        }
        for (const status of [301, 302, 303, 307, 308]) for (const path of ["/", "/onboarding"]) {
            redirectStatus = status; const before = calls;
            expect(await (await runtime.dispatchFetch(`http://localhost${path}`)).json()).toEqual({ error: "invalid_response" }); expect(calls).toBe(before + 1); }
    } finally { await runtime.dispose(); }
});
