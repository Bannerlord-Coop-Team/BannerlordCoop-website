import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import commandsData from "@/app/cheats/commands.json";
import { isPublishedCheat } from "@/app/cheats/debugOnly";
import { LiveServerConsole } from "./LiveServerConsole";
import { LocalizationProvider } from "@/app/lib/localization/client";
import liveMessages from "@/app/lib/localization/dictionaries/en/live-server.json";
import serverMessages from "@/app/lib/localization/dictionaries/en/server-common.json";
import managedMessages from "@/app/lib/localization/dictionaries/en/managed-server.json";
import commonMessages from "@/app/lib/localization/dictionaries/en/common.json";
import cheatsMessages from "@/app/lib/localization/dictionaries/en/cheats.json";

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
    await renderConsole();
    socket = Socket.instances[0];
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
/** Delivers the real live messages and shared namespaces needed by the unified workspace. */
async function renderConsole(messages = liveMessages, gatewayUrl: string | null = "wss://console.example.test") {
    await act(async () => root.render(<LocalizationProvider locale="en" messages={{ "live-server": messages, "server-common": serverMessages, "managed-server": managedMessages, common: commonMessages, cheats: cheatsMessages }}>
        <LiveServerConsole key={gatewayUrl ?? "unconfigured"} gatewayUrl={gatewayUrl} serverId="test-server" />
    </LocalizationProvider>));
}
function button(prefix: string) { return [...container.querySelectorAll("button")].find(b => b.textContent!.startsWith(prefix))!; }
async function attach(inputEnabled = true) {
    await act(async () => {
        socket.message({ type: "ready" });
        socket.message({ type: "containerState", state: "running", inputEnabled });
        socket.message({ type: "attached", inputEnabled });
    });
}
async function search(value: string) {
    const browse = button("Browse commands");
    if (browse.getAttribute("aria-expanded") === "false") await act(async () => browse.click());
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
it("expands command browsing, closes after selection, and disables all picker controls on disconnect", async () => {
    await attach();
    const browse = button("Browse commands");
    expect(browse.getAttribute("aria-expanded")).toBe("false");
    await act(async () => browse.click());
    expect(browse.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(browse.getAttribute("aria-controls")!)!.hidden).toBe(false);
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

it("uses translated confirmations and complete operation feedback without changing gateway commands", async () => {
    const translated = { ...liveMessages, "operation.stop.label": "Detener", "operation.stop.confirmation": "¿Detener el servidor?", "operation.stop.requested": "Parada solicitada…", "operation.stop.notice": "Parada solicitada.", "operation.stop.progress": "Parada en curso", "operation.stop.failed": "No se pudo detener.", "console.outputLabel": "Salida del servidor" };
    await renderConsole(translated);
    socket = Socket.instances.at(-1)!;
    await attach();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => button("Detener").click());
    expect(confirm).toHaveBeenCalledExactlyOnceWith("¿Detener el servidor?");
    expect(socket.send).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await act(async () => button("Detener").click());
    expect(socket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "operation", operation: "stop" }));
    expect(container.textContent).toContain("Parada solicitada…");
    expect(container.textContent).toContain("Parada en curso");
    expect(container.querySelector('pre[role="log"]')?.getAttribute("aria-label")).toBe("Salida del servidor");
    await act(async () => socket.message({ type: "operationResult", operation: "stop", ok: false }));
    expect(container.textContent).toContain("No se pudo detener.");
    confirm.mockRestore();
});

it("leaves decoded logs, external gateway messages and typed command syntax unchanged", async () => {
    await attach();
    const raw = "Start completed. {name} <script>source</script>\n";
    await act(async () => {
        socket.message({ type: "output", data: window.btoa(raw) });
        socket.message({ type: "error", message: "External gateway payload {operation}" });
    });
    expect(container.querySelector('pre[role="log"]')?.textContent).toContain(raw);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("External gateway payload {operation}");
    expect(socket.send).not.toHaveBeenCalled();
});

it("localizes the unconfigured console without attempting a connection", async () => {
    await renderConsole({ ...liveMessages, "console.notConfigured": "Falta la URL segura.", "console.waiting": "Esperando salida…", "console.status.unavailable": "Sin configurar", "console.commandPlaceholder": "Escriba un comando…" }, null);
    expect(container.textContent).toContain("Falta la URL segura.");
    expect(container.textContent).toContain("Esperando salida…");
    expect(container.textContent).toContain("Sin configurar");
    expect(container.querySelector<HTMLInputElement>("#console-command")?.placeholder).toBe("Escriba un comando…");
    expect(button("Connect").disabled).toBe(true);
});

it("keeps the active socket and pending operation when only translation data changes", async () => {
    await attach();
    await act(async () => button("Start").click());
    const connections = Socket.instances.length;
    await renderConsole({ ...liveMessages, "operation.start.progress": "Inicio en curso", "operation.start.requested": "Inicio solicitado…", "console.send": "Enviar" });
    expect(Socket.instances.length).toBe(connections);
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "operation", operation: "start" }));
    expect(container.textContent).toContain("Inicio en curso");
    expect(container.textContent).toContain("Inicio solicitado…");
    expect(container.textContent).toContain("Enviar");
});

it("retains unrecognized external state and operation codes instead of treating them as dictionary keys", async () => {
    await attach();
    await act(async () => {
        socket.message({ type: "containerState", state: "vendor-state" });
        socket.message({ type: "operationPending", operation: "vendor-operation" });
    });
    expect(container.textContent).toContain("Container operation: vendor-state.");
    expect(container.textContent).toContain("vendor-operation in progress");
    await act(async () => socket.message({ type: "operationResult", operation: "vendor-operation", ok: false }));
    expect(container.textContent).toContain("vendor-operation failed.");
    expect(socket.send).not.toHaveBeenCalled();
});
