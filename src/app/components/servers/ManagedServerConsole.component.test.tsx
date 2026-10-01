import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerConsole } from "./ManagedServerConsole";

let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

/** Reads the visible console output and any inline connection notice. */
function output() {
    return container.querySelector("pre")!.textContent;
}

/** Mounts or rerenders a server's console. */
async function renderConsole(serverId = "preview") {
    await act(async () => root.render(<ManagedServerConsole serverId={serverId} />));
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
    expect(output()).toContain("unavailable");
});

it.each(["unavailable", "expired"])("shows %s and reload guidance inside the output without auto-retrying", async state => {
    fetchMock.mockResolvedValueOnce(state === "unavailable"
        ? new Response(null, { status: 503 })
        : new Response('event: line\ndata: "Last line"\n\nevent: expired\n\n'));
    await renderConsole();
    expect(output()).toContain(state);
    expect(output()).toContain("Reload the page");
    if (state === "expired") expect(output()).toContain("Last line");
    expect(container.querySelector("button")).toBeNull();
    await renderConsole();
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("reconnects after Strict Mode cleanup and aborts the active stream on unmount", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    await act(async () => root.render(<StrictMode><ManagedServerConsole serverId="preview" /></StrictMode>));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
    expect(output()).toContain("Connecting");
    await act(async () => root.render(null));
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
});

const usageOutput = 'Usage: coop.debug.alley.abandon <settlement_id> <alley_index>\n\nParameters:\n- settlement_id (required): The settlement StringId.\n- alley_index (required): The zero-based alley index.\n\nNote: Wrap parameter values containing spaces in double quotes.';
const commandRecord = { ev: "managed-command", id: "608721b5db6e6025f5af4261078e888c", ok: true, output: usageOutput };

/** Wraps a stdout line in the existing SSE line envelope. */
function stdoutFrame(line: string) {
    return `event: line\ndata: ${JSON.stringify(line)}\n\n`;
}

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
