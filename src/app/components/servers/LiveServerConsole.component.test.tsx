import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import commandsData from "@/app/cheats/commands.json";
import { isPublishedCheat } from "@/app/cheats/debugOnly";
import { LiveServerConsole } from "./LiveServerConsole";

vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } }) }));
class Socket extends EventTarget {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static instances: Socket[] = [];
    readyState = 1;
    send = vi.fn();
    close = vi.fn();
    constructor() { super(); Socket.instances.push(this); }
    message(value: object) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
}
let container: HTMLDivElement;
let root: Root;
let socket: Socket;
beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("WebSocket", Socket);
    Socket.instances = [];
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<LiveServerConsole gatewayUrl="wss://console.example.test" serverId="test-server" />));
    socket = Socket.instances[0];
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function button(prefix: string) { return [...container.querySelectorAll("button")].find(b => b.textContent!.startsWith(prefix))!; }
async function attach(inputEnabled = true) {
    await act(async () => {
        socket.message({ type: "ready" });
        socket.message({ type: "containerState", state: "running", inputEnabled });
        socket.message({ type: "attached", inputEnabled });
    });
}
async function search(value: string) {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
it("searches names, groups and descriptions and inserts a focused draft without sending", async () => {
    expect(button("Browse commands").disabled).toBe(true);
    await attach();
    await search("  BROADCAST  ");
    expect(button("say <text>")).toBeDefined();
    expect(button("save")).toBeUndefined();
    await act(async () => button("say <text>").click());
    const input = container.querySelector<HTMLInputElement>("#console-command")!;
    expect(input.value).toBe("say <text>");
    expect(document.activeElement).toBe(input);
    expect(socket.send).not.toHaveBeenCalled();
    await search("campaign");
    expect(button("save")).toBeDefined();
    await act(async () => button("save").click());
    expect(input.value).toBe("save");
    expect(socket.send).not.toHaveBeenCalled();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(socket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "input", data: "save\n" }));
    await search("kick");
    expect(button("kick <id|name>")).toBeDefined();
    await search("no-such-command");
    expect(container.textContent).toContain("No commands match your search.");
});
it("expands mobile browsing, closes after selection, and disables all picker controls on disconnect", async () => {
    await attach();
    const browse = button("Browse commands");
    expect(browse.getAttribute("aria-expanded")).toBe("false");
    await act(async () => browse.click());
    expect(browse.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(browse.getAttribute("aria-controls")!)!.className).toMatch(/^block /);
    await act(async () => button("players").click());
    expect(browse.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector<HTMLInputElement>("#console-command")!.value).toBe("players");
    expect(socket.send).not.toHaveBeenCalled();
    await act(async () => button("Disconnect").click());
    for (const control of container.querySelectorAll<HTMLButtonElement | HTMLInputElement>("aside button, aside input")) expect(control.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#console-command")!.value).toBe("players");
});
it.each([
    ["read-only", "running", false], ["stopped", "stopped", false], ["restarting", "restarting", false],
])("keeps the picker unavailable when %s", async (_label, state, inputEnabled) => {
    await attach();
    await act(async () => socket.message({ type: "containerState", state, inputEnabled }));
    for (const control of container.querySelectorAll<HTMLButtonElement | HTMLInputElement>("aside button, aside input, #console-command")) expect(control.disabled).toBe(true);
    await act(async () => button("save").click());
    expect(socket.send).not.toHaveBeenCalled();
});

it("includes published server cheats with argument guidance and excludes client and debug-only commands", async () => {
    await attach();
    const listed = [...container.querySelectorAll("aside code")].map(code => code.textContent);
    for (const command of commandsData.commands) {
        expect(listed.includes(command.usage), command.command).toBe(command.side !== "client" && isPublishedCheat(command));
    }
    await search("coop.debug.hero.set_gold_state");
    await act(async () => button("coop.debug.hero.set_gold_state").click());
    expect(container.querySelector<HTMLInputElement>("#console-command")!.value).toBe("coop.debug.hero.set_gold_state <hero_id> <gold>");
    expect(container.textContent).toContain("Sets non-negative gold for a registered hero on the server.");
    expect(socket.send).not.toHaveBeenCalled();
});
