import assert from "node:assert/strict";
import test from "node:test";
import {
    CONSOLE_RECONNECT_DELAYS,
    boundedConsoleText,
    consoleReconnectDelay,
    decodeConsoleStreamChunk,
    isScrolledToBottom,
    parseConsoleControlLine,
    parseConsoleEvent,
} from "./ManagedServerConsole";
import {
    consoleStreamEndpoint,
    createConsoleStreamHandler,
} from "../../lib/console/stream-handler";

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

test("recognizes game state records, with or without a timestamp, and hides roster and command lists", () => {
    assert.deepEqual(parseConsoleControlLine('@DS@{"ev":"state","phase":"loading","save":"saveauto1","pw":false}'), { kind: "state", prefix: "", phase: "loading" });
    assert.deepEqual(parseConsoleControlLine('[12:00:01] @DS@{"ev":"state","phase":"serving"}'), { kind: "state", prefix: "[12:00:01] ", phase: "serving" });
    assert.deepEqual(parseConsoleControlLine('2026-10-04T12:00:01.123Z @DS@{"ev":"state","phase":"fatal","detail":"IOException: disk full"}'),
        { kind: "state", prefix: "2026-10-04T12:00:01.123Z ", phase: "fatal", detail: "IOException: disk full" });
    assert.equal((parseConsoleControlLine(`@DS@{"ev":"state","phase":"fatal","detail":"${"x".repeat(600)}"}`) as { detail: string }).detail.length, 500);
    assert.deepEqual(parseConsoleControlLine('@DS@{"ev":"players","list":["Alice"]}'), { kind: "hidden" });
    assert.deepEqual(parseConsoleControlLine('@DS@{"ev":"commands","builtin":["status"],"game":[]}'), { kind: "hidden" });
    assert.deepEqual(parseConsoleControlLine('@DS@{"ev":"managed-command","id":"a","ok":true,"output":"done"}'), { kind: "managed-command", ok: true, output: "done" });
});

test("leaves unknown, malformed, or mid-line control records as ordinary stdout", () => {
    for (const line of [
        "[DedicatedServer] SERVING - coop server up, waiting for clients",
        '@DS@{"ev":"state","phase":"dancing"}',
        '@DS@{"ev":"state"}',
        '@DS@{"ev":"players","list":"Alice"}',
        '@DS@{"ev":"commands"}',
        "@DS@[]",
        "@DS@not-json",
        'game output @DS@{"ev":"state","phase":"serving"}',
    ]) assert.equal(parseConsoleControlLine(line), null, line);
});

test("backs off reconnects and then stops retrying automatically", () => {
    assert.deepEqual(CONSOLE_RECONNECT_DELAYS.map((_, attempt) => consoleReconnectDelay(attempt)), [2_000, 5_000, 10_000, 30_000, 60_000]);
    assert.equal(consoleReconnectDelay(CONSOLE_RECONNECT_DELAYS.length), null);
});

test("follows output only while the reader is at the bottom", () => {
    assert.equal(isScrolledToBottom(800, 1_000, 200), true);
    assert.equal(isScrolledToBottom(780, 1_000, 200), true);
    assert.equal(isScrolledToBottom(700, 1_000, 200), false);
    assert.equal(isScrolledToBottom(0, 100, 200), true);
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
