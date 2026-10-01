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
