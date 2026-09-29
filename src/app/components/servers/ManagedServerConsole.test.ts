import assert from "node:assert/strict";
import test from "node:test";
import {
    boundedConsoleText,
    decodeConsoleStreamChunk,
    parseConsoleEvent,
} from "./ManagedServerConsole";
import {
    consoleStreamEndpoint,
    createConsoleStreamHandler,
} from "../../api/servers/[serverId]/console/route";

const SERVER_ID = "11111111-1111-4111-8111-111111111111";

test("parses only typed bounded line events", () => {
    assert.deepEqual(parseConsoleEvent('event: line\ndata: "hello"'), { type: "line", text: "hello" });
    assert.deepEqual(parseConsoleEvent("event: line\ndata: not-json"), { type: "ignored" });
    assert.deepEqual(parseConsoleEvent("event: truncated\ndata: {}"), { type: "truncated" });
});

test("bounds incomplete and malformed SSE input before retaining it", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    assert.throws(() => decodeConsoleStreamChunk("", new Uint8Array(16 * 1_024 + 1), decoder));
    assert.throws(() => decodeConsoleStreamChunk("event: line", undefined, new TextDecoder("utf-8", { fatal: true }), true));
    assert.throws(() => decodeConsoleStreamChunk("", Uint8Array.of(0xff), new TextDecoder("utf-8", { fatal: true })));
});

test("allows only the configured HTTPS Oracle origin", () => {
    assert.equal(consoleStreamEndpoint("https://control.example.com").href, "https://control.example.com/v1/user/console-stream");
    assert.throws(() => consoleStreamEndpoint("http://control.example.com"));
    assert.throws(() => consoleStreamEndpoint("https://control.example.com/other"));
    assert.throws(() => consoleStreamEndpoint("https://user:pass@control.example.com"));
});

test("denies cross-origin, invalid-server, and unauthenticated route requests before proxying", async () => {
    let fetches = 0;
    const authenticated = routeHandler(async () => { fetches += 1; return new Response(); });
    assert.equal((await authenticated(new Request(`https://website.example/api/servers/${SERVER_ID}/console`, {
        headers: { origin: "https://attacker.example" },
    }), context(SERVER_ID))).status, 404);
    assert.equal((await authenticated(new Request("https://website.example/api/servers/not-a-server/console"), context("not-a-server"))).status, 404);

    const unauthenticated = routeHandler(async () => { fetches += 1; return new Response(); }, false);
    assert.equal((await unauthenticated(new Request(`https://website.example/api/servers/${SERVER_ID}/console`), context(SERVER_ID))).status, 401);
    assert.equal(fetches, 0);
});

test("forwards only the verified bearer session and streams before upstream closure", async () => {
    let upstreamController!: ReadableStreamDefaultController<Uint8Array>;
    let upstreamCancelled = false;
    let forwarded: { input: string; init?: RequestInit } | undefined;
    const upstreamBody = new ReadableStream<Uint8Array>({
        start(controller) { upstreamController = controller; },
        cancel() { upstreamCancelled = true; },
    });
    const handler = routeHandler(async (input, init) => {
        forwarded = { input: String(input), init };
        return new Response(upstreamBody, { headers: { "content-type": "text/event-stream; charset=utf-8" } });
    });
    const response = await handler(new Request(`https://website.example/api/servers/${SERVER_ID}/console`), context(SERVER_ID));
    assert.equal(response.status, 200);
    assert.equal(forwarded?.input, "https://control.example/v1/user/console-stream");
    assert.equal(new Headers(forwarded?.init?.headers).get("authorization"), "Bearer verified-token");
    assert.deepEqual(JSON.parse(String(forwarded?.init?.body)), { serverId: SERVER_ID });

    const reader = response.body!.getReader();
    upstreamController.enqueue(new TextEncoder().encode('event: line\ndata: "first"\n\n'));
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.match(new TextDecoder().decode(first.value), /first/u);
    assert.equal(upstreamCancelled, false);

    await reader.cancel();
    assert.equal(upstreamCancelled, true);
    assert.equal((forwarded?.init?.signal as AbortSignal).aborted, true);
});

test("bounds retained browser output", () => {
    let output = "";
    for (let index = 0; index < 2_100; index += 1) output = boundedConsoleText(output, `line-${index}`);
    assert.ok(output.length <= 128 * 1_024);
    assert.ok(output.split("\n").length <= 2_000);
    assert.ok(output.includes("line-2099"));
    assert.ok(!output.includes("line-0\n"));
});

function context(serverId: string) {
    return { params: Promise.resolve({ serverId }) };
}

function routeHandler(proxyFetch: typeof fetch, authenticated = true) {
    return createConsoleStreamHandler({
        getAuthClient: (async () => ({
            auth: {
                getUser: async () => ({ data: { user: authenticated ? { id: "verified-user" } : null }, error: null }),
                getSession: async () => ({
                    data: { session: authenticated ? { access_token: "verified-token", user: { id: "verified-user" } } : null },
                    error: null,
                }),
            },
        })) as never,
        fetch: proxyFetch,
        randomUUID: () => "22222222-2222-4222-8222-222222222222",
        consoleOrigin: () => "https://control.example",
    });
}
