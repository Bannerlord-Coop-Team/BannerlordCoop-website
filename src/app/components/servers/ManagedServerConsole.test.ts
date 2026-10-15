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
    CONSOLE_SESSION_BACKSTOP_MILLISECONDS,
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
    assert.throws(() => decodeConsoleStreamChunk("", new Uint8Array(64 * 1_024 + 1), decoder));
    assert.throws(() => decodeConsoleStreamChunk("event: line", undefined, new TextDecoder("utf-8", { fatal: true }), true));
    assert.throws(() => decodeConsoleStreamChunk("", Uint8Array.of(0xff), new TextDecoder("utf-8", { fatal: true })));
});

test("accepts a full 8 KiB console line after JSON escaping doubles it", () => {
    const line = `@DS@{"ev":"managed-command","output":"${'\\"'.repeat(4_080)}"}`;
    const frame = `event: line\ndata: ${JSON.stringify(line)}\n\n`;
    assert.ok(new TextEncoder().encode(frame).byteLength > 16 * 1_024);
    const decoded = decodeConsoleStreamChunk("", new TextEncoder().encode(frame), new TextDecoder("utf-8", { fatal: true }));
    assert.deepEqual(decoded.events, [{ type: "line", text: line }]);
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

test("passes the control plane's session expiry through and then ends the browser stream cleanly", async () => {
    const handler = routeHandler(async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('event: line\ndata: "last"\n\nevent: expired\ndata: {}\n\n'));
            controller.close();
        },
    }), { headers: { "content-type": "text/event-stream" } }));
    const response = await handler(new Request(`https://website.example/api/servers/${SERVER_ID}/console`), context(SERVER_ID));
    assert.match(await response.text(), /event: expired/u);
});

test("finishes a silent session with an expired event at the backstop and releases the upstream read", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let upstreamCancelled = false;
    const handler = routeHandler(async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('event: line\ndata: "first"\n\n')); },
        cancel() { upstreamCancelled = true; },
    }), { headers: { "content-type": "text/event-stream" } }));
    const response = await handler(new Request(`https://website.example/api/servers/${SERVER_ID}/console`), context(SERVER_ID));
    const reader = response.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /first/u);
    const pending = reader.read();
    t.mock.timers.tick(CONSOLE_SESSION_BACKSTOP_MILLISECONDS);
    assert.match(new TextDecoder().decode((await pending).value), /event: expired/u);
    assert.equal((await reader.read()).done, true);
    assert.equal(upstreamCancelled, true);
});

test("ends the browser stream normally when the upstream connection breaks", async () => {
    let upstreamController!: ReadableStreamDefaultController<Uint8Array>;
    const handler = routeHandler(async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { upstreamController = controller; },
    }), { headers: { "content-type": "text/event-stream" } }));
    const response = await handler(new Request(`https://website.example/api/servers/${SERVER_ID}/console`), context(SERVER_ID));
    const reader = response.body!.getReader();
    const pending = reader.read();
    upstreamController.error(new Error("connection reset"));
    assert.equal((await pending).done, true);
});

test("bounds retained browser output", () => {
    let output = "";
    for (let index = 0; index < 2_100; index += 1) output = boundedConsoleText(output, `line-${index}`);
    assert.ok(output.length <= 128 * 1_024);
    assert.ok(output.split("\n").length <= 2_000);
    assert.ok(output.includes("line-2099"));
    assert.ok(!output.includes("line-0\n"));
});

test("batch retention preserves per-event newlines and both retention edges", () => {
    const maximumCharacters = 128 * 1_024;
    const scenarios = [
        { current: "unfinished", lines: ["", "first\nsecond", "trailing\n", "雪🙂"] },
        { current: "old\n".repeat(1_998), lines: ["", "last"] },
        { current: "old\n".repeat(1_999), lines: ["first\nsecond", "", "last"] },
        { current: "x".repeat(maximumCharacters - 2), lines: ["y", "z"] },
        { current: `${"x".repeat(maximumCharacters - 4)}🙂\n`, lines: ["雪", "last"] },
        { current: "old\n", lines: Array.from({ length: 2_100 }, (_, index) => `line-${index}`) },
        { current: "old\n", lines: Array.from({ length: 10 }, () => "x".repeat(16_000)) },
    ];
    assert.equal(boundedConsoleText("unfinished", scenarios[0].lines.join("\n")), "unfinished\nfirst\nsecond\ntrailing\n\n雪🙂\n");
    for (const { current, lines } of scenarios) {
        const batched = boundedConsoleText(current, lines.join("\n"));
        assert.equal(batched, lines.reduce(boundedConsoleText, current));
        assert.ok(batched.length <= maximumCharacters);
        assert.ok(batched.split("\n").length <= 2_000);
    }
});

test("identical SSE events retain the same transcript across byte, frame, and burst boundaries", () => {
    const lines = [
        "first\nsecond", "", "雪🙂", "trailing\n",
        '@DS@{"ev":"state","phase":"loading"}',
        '@DS@{"ev":"state","phase":"serving"}',
        ...Array.from({ length: 100 }, (_, index) => `burst-${index}`),
    ];
    const frames = [
        ...lines.map(line => `event: line\ndata: ${JSON.stringify(line)}\n\n`),
        "event: line\ndata: not-json\n\n", ": heartbeat\n\n",
        "event: truncated\n\n", "event: expired\n\n", "event: ended\n\n",
    ];
    const encoder = new TextEncoder();
    const bytes = encoder.encode(frames.join(""));
    const initial = boundedConsoleText("", "old".padEnd(65, ".").concat("\n").repeat(1_999));
    const expected = lines.reduce(boundedConsoleText, initial);
    const chunkings = [
        [bytes], frames.map(frame => encoder.encode(frame)),
        Array.from(bytes, byte => Uint8Array.of(byte)),
        Array.from({ length: Math.ceil(bytes.length / 73) }, (_, index) => bytes.slice(index * 73, (index + 1) * 73)),
    ];
    for (const chunks of chunkings) {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let pending = "";
        let text = initial;
        const events: ReturnType<typeof parseConsoleEvent>[] = [];
        for (const chunk of [...chunks, undefined]) {
            const decoded = decodeConsoleStreamChunk(pending, chunk, decoder, chunk === undefined);
            pending = decoded.pending;
            events.push(...decoded.events);
            const received = decoded.events.flatMap(event => event.type === "line" ? [event.text] : []);
            if (received.length > 0) text = boundedConsoleText(text, received.join("\n"));
        }
        assert.equal(pending, "");
        assert.equal(text, expected);
        assert.deepEqual(events, [
            ...lines.map(text => ({ type: "line", text })),
            { type: "ignored" }, { type: "ignored" }, { type: "truncated" }, { type: "expired" }, { type: "ended" },
        ]);
    }
});

test("benchmarks a full transcript plus 100 events without a timing gate", (t) => {
    const initial = `${"x".repeat(1_201)}\n${`${"x".repeat(64)}\n`.repeat(1_998)}`;
    const lines = Array.from({ length: 100 }, (_, index) => `burst-${index}`.padEnd(64, "."));
    assert.equal(initial.length, 128 * 1_024);
    assert.equal(initial.split("\n").length, 2_000);
    const perEvent = () => lines.reduce(boundedConsoleText, initial);
    const perChunk = () => boundedConsoleText(initial, lines.join("\n"));
    assert.equal(perChunk(), perEvent());
    // Warm both paths, then report medians; correctness and scan counts are the regression gates.
    for (let index = 0; index < 10; index += 1) { perEvent(); perChunk(); }
    const measure = (append: () => string) => {
        const samples = Array.from({ length: 5 }, () => {
            const started = performance.now();
            for (let index = 0; index < 25; index += 1) append();
            return (performance.now() - started) / 25;
        });
        return samples.sort((left, right) => left - right)[2];
    };
    t.diagnostic(JSON.stringify({ events: lines.length, initialCharacters: initial.length,
        perEventMedianMs: measure(perEvent), perChunkMedianMs: measure(perChunk) }));
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
