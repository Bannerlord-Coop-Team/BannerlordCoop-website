import { createTranslator } from "@/app/lib/localization/translator";
import { TestLocalization, serverTestMessages } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerConsole } from "./ManagedServerConsole";
import { ManagedServerPollingProvider, useManagedConsoleSignals, type ManagedConsoleSignal } from "./ManagedServerPollingProvider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let root: Root;
let container: HTMLDivElement;
let visibility: DocumentVisibilityState = "visible";
const fetchMock = vi.fn();

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

/** Reads the visible console output and any inline connection notice. */
function output() {
    return container.querySelector("pre")!.textContent;
}

/** Finds a button by its visible label. */
function button(label: string) {
    return [...container.querySelectorAll("button")].find(candidate => candidate.textContent?.trim() === label);
}

/** Mounts or rerenders a server's console. */
async function renderConsole(serverId = "preview", state: { operationState?: string; observedGameState?: string } = {}) {
    await act(async () => root.render(<TestLocalization>{<ManagedServerConsole serverId={serverId} {...state} />} </TestLocalization>));
}

/** Wraps a stdout line in the existing SSE line envelope. */
function stdoutFrame(line: string) {
    return `event: line\ndata: ${JSON.stringify(line)}\n\n`;
}

/** Opens a stream whose frames and closure the test controls. */
function liveStream() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }));
    return {
        response,
        async send(...lines: string[]) {
            await act(async () => controller.enqueue(new TextEncoder().encode(lines.map(stdoutFrame).join(""))));
        },
        async end(event?: "expired" | "ended" | "truncated") {
            await act(async () => {
                if (event) controller.enqueue(new TextEncoder().encode(`event: ${event}\n\n`));
                controller.close();
            });
        },
    };
}

/** Advances fake time, flushing the resulting renders. */
async function advance(milliseconds: number) {
    await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}

/** Changes tab visibility the way the browser reports it. */
async function setVisibility(state: DocumentVisibilityState) {
    visibility = state;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}

it("auto-connects once on load without connection buttons or a separate indicator", async () => {
    let respond!: (response: Response) => void;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockReturnValue(new Promise<Response>(resolve => { respond = resolve; }));
    await renderConsole();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(output()).toContain("Connecting");
    expect(fetchMock).toHaveBeenCalledWith("/api/servers/preview/console", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await renderConsole();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => respond(new Response(new ReadableStream({ start(controller) { stream = controller; } }))));
    expect(output()).toBe("Connected. Waiting for output…");
    await act(async () => stream.enqueue(new TextEncoder().encode('event: line\ndata: "Sample output"\n\n')));
    expect(output()).toBe("Sample output\n");
    await act(async () => stream.close());
});

it("aborts the old server connection and ignores its late response after switching servers", async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve => { respond = resolve; }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await renderConsole();
    await renderConsole("another-server");
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/servers/another-server/console");
    await act(async () => respond(new Response("")));
    expect(output()).toContain("Reconnecting to live output");
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("renews an expired session at once while visible, keeping output until the replay arrives", async () => {
    vi.useFakeTimers();
    const first = liveStream();
    const second = liveStream();
    fetchMock.mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    await renderConsole();
    await first.send("Line one");
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await first.end("expired");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output()).toBe("Line one\n");
    expect(output()).not.toContain("Reload");
    await second.send("Line one", "Line two");
    expect(output()).toBe("Line one\nLine two\n");
});

it("waits for the tab to be shown again before renewing an expired session", async () => {
    vi.useFakeTimers();
    const first = liveStream();
    fetchMock.mockResolvedValueOnce(first.response).mockReturnValue(new Promise<Response>(() => {}));
    await renderConsole();
    await first.send("Line one");
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await setVisibility("hidden");
    await first.end("expired");
    await advance(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await setVisibility("visible");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output()).toContain("Line one");
    expect(output()).toContain("Reconnecting to live output");
});

it("retries failures with a capped backoff, then offers Reconnect", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));
    await renderConsole();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(output()).toContain("Reconnecting to live output");
    for (const [index, delay] of [2_000, 5_000, 10_000, 30_000, 60_000].entries()) {
        await advance(delay - 1);
        expect(fetchMock).toHaveBeenCalledTimes(index + 1);
        await advance(1);
        expect(fetchMock).toHaveBeenCalledTimes(index + 2);
    }
    expect(output()).toContain("Live output isn’t available right now.");
    expect(output()).not.toContain("Reload");
    await advance(30 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await act(async () => button("Reconnect")!.click());
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(output()).toContain("Reconnecting to live output");
});

it("retries hidden-tab failures only after the tab is shown", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));
    await setVisibility("hidden");
    await renderConsole();
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await setVisibility("visible");
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("restarts the backoff after a stream that stayed healthy", async () => {
    vi.useFakeTimers();
    const first = liveStream();
    fetchMock.mockResolvedValueOnce(first.response).mockImplementation(() => new Promise<Response>(() => {}));
    await renderConsole();
    vi.setSystemTime(Date.now() + 2 * 60_000);
    await first.end("ended");
    await advance(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("waits while the server is stopped and reconnects as soon as it is running", async () => {
    vi.useFakeTimers();
    const first = liveStream();
    fetchMock.mockResolvedValueOnce(first.response).mockReturnValue(new Promise<Response>(() => {}));
    await renderConsole("preview", { operationState: "stopped", observedGameState: "stopped" });
    await first.send("Saved and shut down.");
    await first.end("ended");
    expect(output()).toBe("Saved and shut down.\n\nThe server is stopped. Output will appear here when it starts.");
    await advance(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await renderConsole("preview", { operationState: "starting", observedGameState: "stopped" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output()).toContain("Reconnecting to live output");
});

it("cancels a pending retry when the server stops and resumes when it is running again", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));
    await renderConsole();
    await renderConsole("preview", { operationState: "stopping", observedGameState: "stopped" });
    expect(output()).toContain("The server is stopped.");
    await advance(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await renderConsole("preview", { operationState: "running", observedGameState: "running" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("renders game state records as readable status and hides roster and command lists", async () => {
    const stream = liveStream();
    fetchMock.mockResolvedValueOnce(stream.response);
    await renderConsole();
    await stream.send(
        '@DS@{"ev":"state","phase":"boot","save":"saveauto1","pw":false}',
        '[12:00:01] @DS@{"ev":"state","phase":"loading","save":"saveauto1","pw":false}',
        '@DS@{"ev":"players","list":["Alice"]}',
        '@DS@{"ev":"commands","builtin":["status"],"game":["coop.help"]}',
        "[DedicatedServer] SERVING - coop server up, waiting for clients",
        '@DS@{"ev":"state","phase":"serving","save":"saveauto1","pw":false}',
        '@DS@{"ev":"state","phase":"stopping"}',
        '@DS@{"ev":"state","phase":"fatal","detail":"<img src=x onerror=alert(1)>"}',
    );
    expect(output()).toBe([
        "Server status: starting up",
        "[12:00:01] Server status: loading campaign",
        "[DedicatedServer] SERVING - coop server up, waiting for clients",
        "Server status: ready to join",
        "Server status: shutting down",
        "Server status: stopped by an error (<img src=x onerror=alert(1)>)",
        "",
    ].join("\n"));
    expect(output()).not.toContain("@DS@");
    expect(output()).not.toContain("Alice");
    expect(container.querySelector("img")).toBeNull();
});

it("publishes game phases and stream boundaries for lifecycle progress", async () => {
    const signals: ManagedConsoleSignal[] = [];
    /** Records every console signal shared through the provider. */
    function Probe() {
        const channel = useManagedConsoleSignals();
        useEffect(() => channel?.subscribe(signal => signals.push(signal)), [channel]);
        return null;
    }
    const stream = liveStream();
    fetchMock.mockResolvedValueOnce(stream.response).mockReturnValue(new Promise<Response>(() => {}));
    await act(async () => root.render(<TestLocalization><ManagedServerPollingProvider><Probe /><ManagedServerConsole serverId="preview" /></ManagedServerPollingProvider></TestLocalization>));
    await stream.send('@DS@{"ev":"state","phase":"loading"}', "plain output", '@DS@{"ev":"state","phase":"serving"}');
    await stream.end("ended");
    const connection = (signals[0] as { connection: number }).connection;
    expect(signals).toEqual([
        { type: "opened", serverId: "preview", connection },
        { type: "phase", serverId: "preview", connection, phase: "loading" },
        { type: "phase", serverId: "preview", connection, phase: "serving" },
        { type: "closed", serverId: "preview", connection, runEnded: true },
    ]);
});

it("follows new output only while the reader is at the bottom and offers a jump back", async () => {
    let resized!: () => void;
    vi.stubGlobal("ResizeObserver", class {
        constructor(callback: () => void) { resized = callback; }
        observe() {}
        disconnect() {}
    });
    const stream = liveStream();
    fetchMock.mockResolvedValueOnce(stream.response);
    await renderConsole();
    const pre = container.querySelector("pre")!;
    let scrollTop = 0;
    Object.defineProperty(pre, "scrollHeight", { configurable: true, get: () => 1_000 });
    Object.defineProperty(pre, "clientHeight", { configurable: true, get: () => 200 });
    Object.defineProperty(pre, "scrollTop", { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
    await stream.send("first");
    expect(scrollTop).toBe(1_000);
    expect(button("Jump to latest")).toBeUndefined();
    scrollTop = 0;
    resized();
    expect(scrollTop).toBe(1_000);
    scrollTop = 100;
    await act(async () => pre.dispatchEvent(new Event("scroll")));
    await stream.send("second");
    expect(scrollTop).toBe(100);
    resized();
    expect(scrollTop).toBe(100);
    await act(async () => button("Jump to latest")!.click());
    expect(scrollTop).toBe(1_000);
    expect(button("Jump to latest")).toBeUndefined();
    await stream.send("third");
    expect(scrollTop).toBe(1_000);
});

it("reconnects after Strict Mode cleanup and aborts the active stream on unmount", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    await act(async () => root.render(<StrictMode><TestLocalization><ManagedServerConsole serverId="preview" /></TestLocalization></StrictMode>));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
    expect(output()).toContain("Connecting");
    await act(async () => root.render(<TestLocalization>{null} </TestLocalization>));
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
});

const usageOutput = 'Usage: coop.debug.alley.abandon <settlement_id> <alley_index>\n\nParameters:\n- settlement_id (required): The settlement StringId.\n- alley_index (required): The zero-based alley index.\n\nNote: Wrap parameter values containing spaces in double quotes.';
const commandRecord = { ev: "managed-command", id: "608721b5db6e6025f5af4261078e888c", ok: true, output: usageOutput };

it("highlights a complete managed-command frame with decoded newlines, hiding its envelope and ID", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ start(controller) { stream = controller; } })));
    await renderConsole();
    const frame = stdoutFrame(`@DS@${JSON.stringify(commandRecord)}`);
    const middle = Math.floor(frame.length / 2);
    await act(async () => stream.enqueue(new TextEncoder().encode(frame.slice(0, middle))));
    expect(container.querySelector('[aria-label="Command output"]')).toBeNull();
    await act(async () => stream.enqueue(new TextEncoder().encode(frame.slice(middle))));
    const command = container.querySelector('[aria-label="Command output"]')!;
    expect(command.textContent).toBe(`${usageOutput}\n`);
    expect(command.className).toContain("border-gold/60");
    expect(command.querySelector('.text-gold')!.textContent).toBe("coop.debug.alley.abandon");
    expect(command.querySelector('.text-foreground-muted')!.textContent).toBe("<settlement_id>");
    expect([...command.querySelectorAll('.font-semibold')].map(node => node.textContent)).toEqual(["Usage:", "Parameters:", "Note:"]);
    expect(output()).not.toContain("@DS@");
    expect(output()).not.toContain(commandRecord.id);
    await act(async () => stream.close());
});

it("uses red styling for a failed command record without claiming success", async () => {
    fetchMock.mockResolvedValue(new Response(stdoutFrame(`@DS@${JSON.stringify({ ...commandRecord, ok: false, output: "Command rejected." })}`)));
    await renderConsole();
    const command = container.querySelector('[aria-label="Command error"]')!;
    expect(command.className).toContain("border-red-400/60");
    expect(command.textContent).toBe("Command rejected.\n");
    expect(container.querySelector('[aria-label="Command output"]')).toBeNull();
});

it.each([
    "Ordinary stdout containing coop.debug.alley.abandon",
    "@DS@{not-json}",
    `@DS@${JSON.stringify({ ...commandRecord, ev: "another-event" })}`,
    `@DS@${JSON.stringify({ ...commandRecord, ok: "true" })}`,
    `@DS@${JSON.stringify({ ...commandRecord, output: null })}`,
])("preserves unrecognized stdout as ordinary text: %s", async line => {
    fetchMock.mockResolvedValue(new Response(stdoutFrame(line)));
    await renderConsole();
    expect(output()).toContain(`${line}\n`);
    expect(container.querySelector('[role="group"]')).toBeNull();
});

it("renders HTML-looking command output as text rather than executable markup", async () => {
    const text = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
    fetchMock.mockResolvedValue(new Response(stdoutFrame(`@DS@${JSON.stringify({ ...commandRecord, output: text })}`)));
    await renderConsole();
    expect(container.querySelector('[aria-label="Command output"]')!.textContent).toBe(`${text}\n`);
    expect(container.querySelector("img, script")).toBeNull();
});

// Resolves real English messages without reading cookies in standalone tests.
vi.mock("@/app/lib/localization/server", () => ({
    getLocale: async () => "en",
    getMessages: async () => serverTestMessages,
    getTranslations: async (namespace: keyof typeof serverTestMessages) => createTranslator("en", serverTestMessages[namespace]),
}));
