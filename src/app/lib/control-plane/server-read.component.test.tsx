// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readControlPlaneAdmin } from "./server-read";
import { CONTROL_PLANE_ADMIN_MAXIMUM_RESPONSE_BYTES } from "./client";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "access-token-with-enough-characters";
const operations = ["overview", "vps-hosts", "servers", "server-dashboard", "jobs", "audit", "release-catalog"] as const;
const options = { accessToken: TOKEN, operation: "overview" as const, requestId: REQUEST_ID };
const headers = { "content-type": "application/json", "x-control-plane-protected-admin": "1" };
const envelope = (result: unknown) => ({ version: 1, requestId: REQUEST_ID, ok: true, result });
const accepted = (result: unknown) => Response.json(envelope(result), { headers });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(operations)("directly reads fresh %s through the fixed constrained server route", async operation => {
    let revision = 0;
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://control-plane.bannerlordcoop.com/v1/admin/control-plane");
        expect(init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "manual" });
        const actual = new Headers(init?.headers);
        expect(actual.get("authorization")).toBe(`Bearer ${TOKEN}`);
        expect(actual.get("x-request-id")).toBe(REQUEST_ID);
        expect(actual.get("x-control-plane-protected-admin")).toBe("1");
        expect(actual.get("apikey")).toBeNull();
        expect(actual.get("cookie")).toBeNull();
        expect(JSON.parse(String(init?.body))).toEqual({ version: 1, requestId: REQUEST_ID, operation, input: { limit: 100 } });
        return accepted({ revision: ++revision, name: "Current 👨‍👩‍👧‍👦" });
    });
    vi.stubGlobal("fetch", fetch);
    expect(await readControlPlaneAdmin({ ...options, operation, input: { limit: 100 } })).toEqual({ revision: 1, name: "Current 👨‍👩‍👧‍👦" });
    expect(await readControlPlaneAdmin({ ...options, operation, input: { limit: 100 } })).toEqual({ revision: 2, name: "Current 👨‍👩‍👧‍👦" });
    expect(fetch).toHaveBeenCalledTimes(2);
});

it("attests the matching fresh identity before a pending body without releasing unvalidated data", async () => {
    const userId = "44444444-4444-4444-8444-444444444444";
    const body = Promise.withResolvers<void>(), authenticated = vi.fn();
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ async start(controller) {
        await body.promise;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(envelope({ revision: 1 })))); controller.close();
    } }), { headers: { ...headers, "cache-control": "no-store", "x-control-plane-authenticated-session": `${userId}:${REQUEST_ID}` } }));
    let completed = false;
    const read = readControlPlaneAdmin({ ...options, expectedUserId: userId, onAuthenticated: authenticated });
    void read.then(() => { completed = true; });
    await vi.waitFor(() => expect(authenticated).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    body.resolve(); expect(await read).toEqual({ revision: 1 });
});

it.each([undefined, "wrong-user", "44444444-4444-4444-8444-444444444444:wrong-request", "44444444-4444-4444-8444-444444444444:11111111-1111-4111-8111-111111111111, duplicate"])("rejects absent or mismatched session attestations (%s)", async attestation => {
    const authenticated = vi.fn(), cancel = vi.fn();
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ cancel }), { headers: { ...headers, "cache-control": "no-store",
        ...(attestation === undefined ? {} : { "x-control-plane-authenticated-session": attestation }) } }));
    await expect(readControlPlaneAdmin({ ...options, expectedUserId: "44444444-4444-4444-8444-444444444444", onAuthenticated: authenticated })).rejects.toMatchObject({ code: "invalid_response" });
    expect(authenticated).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
});

it("rejects cacheable attestations and identity callbacks without an expected user", async () => {
    const userId = "44444444-4444-4444-8444-444444444444", authenticated = vi.fn();
    const fetch = vi.fn(async () => Response.json(envelope({}), { headers: { ...headers, "x-control-plane-authenticated-session": `${userId}:${REQUEST_ID}` } }));
    vi.stubGlobal("fetch", fetch);
    await expect(readControlPlaneAdmin({ ...options, onAuthenticated: authenticated })).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetch).not.toHaveBeenCalled();
    for (const identity of [{ expectedUserId: "not-a-user-uuid" }, { expectedUserId: userId, requestId: "not-a-request-uuid" }]) {
        await expect(readControlPlaneAdmin({ ...options, ...identity, onAuthenticated: authenticated })).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(fetch).not.toHaveBeenCalled();
    await expect(readControlPlaneAdmin({ ...options, expectedUserId: userId, onAuthenticated: authenticated })).rejects.toMatchObject({ code: "invalid_response" });
    expect(authenticated).not.toHaveBeenCalled();
});

it("rejects unknown operations, mutations, bad tokens and oversized requests without transport", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const operation of ["delete-server", "import-latest-stable", "set-global-controls", "builds", "unknown"]) {
        await expect(readControlPlaneAdmin({ ...options, operation: operation as never })).rejects.toMatchObject({ code: "invalid_request" });
    }
    for (const accessToken of ["short", "x".repeat(8193)]) {
        await expect(readControlPlaneAdmin({ ...options, accessToken })).rejects.toMatchObject({ code: "invalid_request" });
    }
    await expect(readControlPlaneAdmin({ ...options, input: "x".repeat(64 * 1024) })).rejects.toMatchObject({ code: "request_too_large" });
    expect(fetch).not.toHaveBeenCalled();
});

it.each([undefined, "0", "1, 1", "true"])("fails closed without a precise protected-role acknowledgment (%s)", async acknowledgment => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: {
        "content-type": "application/json", ...(acknowledgment === undefined ? {} : { "x-control-plane-protected-admin": acknowledgment }),
    } });
    const fetch = vi.fn(async () => response); vi.stubGlobal("fetch", fetch);
    await expect(readControlPlaneAdmin(options)).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledOnce();
});

it("rejects a successful old-backend envelope without acknowledgment and never falls back", async () => {
    const fetch = vi.fn(async () => Response.json(envelope({ confidential: "old-backend" })));
    vi.stubGlobal("fetch", fetch);
    await expect(readControlPlaneAdmin(options)).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetch).toHaveBeenCalledTimes(1);
});

it("preserves correlated backend errors and refuses success data on failed HTTP or correlation", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ version: 1, requestId: REQUEST_ID, ok: false,
        error: { code: "forbidden", message: "Administrator access is required.", retryable: false } }, { status: 403 }));
    await expect(readControlPlaneAdmin(options)).rejects.toMatchObject({ code: "forbidden", retryable: false, requestId: REQUEST_ID });
    vi.stubGlobal("fetch", async () => Response.json(envelope({ confidential: true }), { status: 403, headers }));
    await expect(readControlPlaneAdmin(options)).rejects.toMatchObject({ code: "invalid_response" });
    vi.stubGlobal("fetch", async () => Response.json({ ...envelope({ confidential: true }), requestId: "another-request" }, { headers }));
    await expect(readControlPlaneAdmin(options)).rejects.toMatchObject({ code: "invalid_response" });
    vi.stubGlobal("fetch", async () => new Response("{", { headers }));
    await expect(readControlPlaneAdmin(options)).rejects.toMatchObject({ code: "invalid_response" });
});

it("bounds streamed bytes and chunk count, validates UTF8, and cancels rejected bodies", async () => {
    for (const chunks of [
        [new Uint8Array(CONTROL_PLANE_ADMIN_MAXIMUM_RESPONSE_BYTES), new Uint8Array(1)],
        Array.from({ length: 8193 }, () => new Uint8Array()),
        [new Uint8Array([0xc3, 0x28])],
    ]) {
        let index = 0;
        const cancel = vi.fn();
        vi.stubGlobal("fetch", async () => new Response(new ReadableStream({
            pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]); }, cancel,
        }), { headers }));
        await expect(readControlPlaneAdmin(options)).rejects.toMatchObject({ code: chunks.length === 1 ? "invalid_response" : "response_too_large" });
        expect(cancel).toHaveBeenCalledOnce();
    }
    for (const contentLength of ["-1", "invalid", String(CONTROL_PLANE_ADMIN_MAXIMUM_RESPONSE_BYTES + 1)]) {
        const cancel = vi.fn();
        vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ cancel }), {
            headers: { ...headers, "content-length": contentLength },
        }));
        await expect(readControlPlaneAdmin(options)).rejects.toMatchObject({ code: "invalid_response" });
        expect(cancel).toHaveBeenCalledOnce();
    }
});

it("decodes Unicode across chunks and accepts a response at the exact byte limit", async () => {
    const prefix = JSON.stringify(envelope(""));
    const value = "👨‍👩‍👧‍👦" + "a".repeat(CONTROL_PLANE_ADMIN_MAXIMUM_RESPONSE_BYTES - new TextEncoder().encode(prefix + "👨‍👩‍👧‍👦").byteLength);
    const bytes = new TextEncoder().encode(JSON.stringify(envelope(value)));
    expect(bytes.byteLength).toBe(CONTROL_PLANE_ADMIN_MAXIMUM_RESPONSE_BYTES);
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ start(controller) {
        const split = bytes.indexOf(0xf0) + 1;
        controller.enqueue(bytes.subarray(0, split)); controller.enqueue(bytes.subarray(split)); controller.close();
    } }), { headers }));
    expect(await readControlPlaneAdmin(options)).toBe(value);
});

it.each(["caller", "deadline"])("cancels a pending response body on %s abort", async source => {
    const caller = new AbortController(), deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
        expect(milliseconds).toBe(90_000); return deadline.signal;
    });
    const opened = Promise.withResolvers<void>(), cancel = vi.fn();
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({
        pull() { opened.resolve(); }, cancel,
    }), { headers }));
    const result = readControlPlaneAdmin({ ...options, signal: caller.signal });
    const rejected = expect(result).rejects.toMatchObject({ code: "control_plane_unavailable" });
    await opened.promise;
    (source === "caller" ? caller : deadline).abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
});

it("runs every direct read in native workerd and rejects all redirects without forwarding credentials", async () => {
    const bundled = await build({
        stdin: { contents: `import { readControlPlaneAdmin } from "./server-read";
            export default { async fetch(request) {
                try { return Response.json(await readControlPlaneAdmin({ accessToken: "${TOKEN}", operation: new URL(request.url).searchParams.get("operation"), expectedUserId: "44444444-4444-4444-8444-444444444444" })); }
                catch (error) { return Response.json({ error: error.code }, { status: 502 }); }
            } };`, resolveDir: dirname(fileURLToPath(import.meta.url)) },
        bundle: true, format: "esm", platform: "browser", write: false,
        alias: { "server-only": fileURLToPath(new URL("../../../../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)) },
    });
    let redirectStatus = 0, calls = 0;
    const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{
        name: "direct-admin-test", modules: true, script: bundled.outputFiles[0].text, compatibilityDate: "2026-08-31",
        compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
        outboundService: async request => {
            calls++;
            expect(request.url).toBe("https://control-plane.bannerlordcoop.com/v1/admin/control-plane");
            expect(request.method).toBe("POST");
            expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
            expect(request.headers.get("x-control-plane-protected-admin")).toBe("1");
            expect(request.headers.get("cookie")).toBeNull(); expect(request.headers.get("apikey")).toBeNull();
            const body = await request.json() as { version: number; requestId: string; operation: string };
            expect(body.requestId).toBe(request.headers.get("x-request-id"));
            expect(body.version).toBe(1); expect(operations).toContain(body.operation);
            if (redirectStatus) return new Response(null, { status: redirectStatus, headers: { location: "https://other.test/private" } });
            return Response.json({ version: 1, requestId: body.requestId, ok: true, result: {
                operation: body.operation, revision: calls, rows: [{ name: "Current 👨‍👩‍👧‍👦" }],
            } }, { headers: { ...headers, "cache-control": "no-store", "x-control-plane-authenticated-session": `44444444-4444-4444-8444-444444444444:${body.requestId}` } });
        },
    }] }));
    try {
        for (const operation of operations) {
            const response = await runtime.dispatchFetch(`http://localhost/?operation=${operation}`);
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ operation, revision: calls, rows: [{ name: "Current 👨‍👩‍👧‍👦" }] });
        }
        expect(calls).toBe(7);
        for (const status of [301, 302, 303, 307, 308]) {
            redirectStatus = status; const before = calls;
            const response = await runtime.dispatchFetch("http://localhost/?operation=overview");
            expect(response.status).toBe(502);
            expect(await response.json()).toEqual({ error: "invalid_response" });
            expect(calls).toBe(before + 1);
        }
    } finally { await runtime.dispose(); }
});


it("does not attest authority when the caller aborts as response headers arrive", async () => {
    const controller = new AbortController(), authenticated = vi.fn(), cancel = vi.fn();
    vi.stubGlobal("fetch", async () => {
        controller.abort();
        return new Response(new ReadableStream({ cancel }), { headers: { ...headers, "cache-control": "no-store",
            "x-control-plane-authenticated-session": `44444444-4444-4444-8444-444444444444:${REQUEST_ID}` } });
    });
    await expect(readControlPlaneAdmin({ ...options, expectedUserId: "44444444-4444-4444-8444-444444444444", onAuthenticated: authenticated, signal: controller.signal })).rejects.toMatchObject({ code: "control_plane_unavailable" });
    expect(authenticated).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
});
