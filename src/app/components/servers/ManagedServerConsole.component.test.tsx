import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerConsole } from "./ManagedServerConsole";

let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();

beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<ManagedServerConsole serverId="preview" />));
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

/** Returns the console's single connection control. */
function toggle() {
    return container.querySelector("button")!;
}

it("uses one status-labelled button to connect and disconnect without a separate indicator", async () => {
    let respond!: (response: Response) => void;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockReturnValue(new Promise<Response>(resolve => { respond = resolve; }));
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(toggle().textContent).toBe("disconnected");
    await act(async () => toggle().click());
    expect(toggle().textContent).toBe("connecting");
    await act(async () => respond(new Response(new ReadableStream({ start(controller) { stream = controller; } }))));
    expect(toggle().textContent).toBe("connected");
    await act(async () => toggle().click());
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(toggle().textContent).toBe("disconnected");
    await act(async () => stream.close());
    expect(toggle().textContent).toBe("disconnected");
});

it("cancels a connecting stream without letting its late response reset the status", async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>(resolve => { respond = resolve; }));
    await act(async () => toggle().click());
    await act(async () => toggle().click());
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => respond(new Response("")));
    expect(toggle().textContent).toBe("disconnected");
});

it.each(["unavailable", "expired"])("shows %s on the same button and permits reconnecting", async state => {
    fetchMock.mockResolvedValueOnce(state === "unavailable"
        ? new Response(null, { status: 503 })
        : new Response("event: expired\n\n"));
    await act(async () => toggle().click());
    expect(toggle().textContent).toBe(state);
    fetchMock.mockResolvedValueOnce(new Response(""));
    await act(async () => toggle().click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toggle().textContent).toBe("disconnected");
});
