import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ManagedServerCommands } from "./ManagedServerCommands";
import type { MyServerSummary } from "@/app/lib/control-plane/types";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), check: vi.fn(), ack: vi.fn() }));
vi.mock("@/app/servers/managed-server-console-actions", () => ({ submitManagedConsoleCommand: mocks.submit, checkManagedConsoleCommand: mocks.check, acknowledgeManagedConsoleCommand: mocks.ack }));
vi.mock("./DownloadServerLogButton", () => ({ DownloadServerLogButton: () => <span>Download logs</span> }));
const server: MyServerSummary = { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Campaign", accessRole: "owner", operationState: "running", observedGameState: "running", friendlyRegion: "germany", releaseChannel: "stable", updatedAt: "2026-09-20T12:00:00.000Z" };
const jobId = "33333333-3333-4333-8333-333333333333";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers(); vi.resetAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    mocks.submit.mockResolvedValue({ ok: true, result: { outcome: "enqueued", jobId } });
    mocks.check.mockResolvedValue({ ok: true, result: { status: "pending" } });
    mocks.ack.mockResolvedValue({ ok: true, result: { acknowledged: true } });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Finds a labelled action without coupling assertions to button order. */
function button(label: string) { return [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === label)!; }
/** Selects a published cheat through the real shared picker. */
async function select() {
    const browse = button("Browse commands");
    if (browse.getAttribute("aria-expanded") === "false") await act(async () => browse.click());
    await act(async () => container.querySelector<HTMLButtonElement>("aside li button")!.click());
}
/** Mounts the console with its lifecycle controls as provided by the page. */
async function mount(overrides: Partial<MyServerSummary> = {}) {
    await act(async () => root.render(<ManagedServerCommands server={{ ...server, ...overrides }} userId="owner-id" controls={<p>Lifecycle controls</p>} />));
}

it("offers only coop cheats, inserts without sending, and sends without a confirmation popup", async () => {
    await mount();
    const commands = [...container.querySelectorAll("aside code")].map(node => node.textContent!);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every(command => command.startsWith("coop."))).toBe(true);
    const reference = document.getElementById(button("Browse commands").getAttribute("aria-controls")!)!;
    expect(reference.hidden).toBe(true);
    await select();
    expect(reference.hidden).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('input[placeholder="coop.…"]'));
    expect(container.querySelector<HTMLInputElement>('input[placeholder="coop.…"]')!.value).toBe(commands[0]);
    expect(mocks.submit).not.toHaveBeenCalled();
    await act(async () => button("Send").click());
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('input[placeholder="coop.…"]')!.value).toBe("");
});

/** Types a draft and places the caret at its end, as a browser input event would. */
async function typeDraft(value: string) {
    const input = container.querySelector<HTMLInputElement>('input[placeholder="coop.…"]')!;
    await act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
}

/** Dispatches Tab and reports whether completion consumed normal focus navigation. */
async function tab(input: HTMLInputElement, shiftKey = false) {
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
    await act(async () => { input.dispatchEvent(event); });
    return event.defaultPrevented;
}

it("ghost-completes one dot-delimited segment per Tab without sending or inserting arguments", async () => {
    await mount();
    const input = await typeDraft("co");
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')!.textContent).toBe("coop.");
    expect(await tab(input)).toBe(true);
    expect(input.value).toBe("coop.");
    const firstName = container.querySelector("aside code")!.textContent!.split(/\s/u, 1)[0];
    const segments = firstName.split(".");
    for (let index = 1; index < segments.length; index++) {
        expect(await tab(input)).toBe(true);
        expect(input.value).toBe(segments.slice(0, index + 1).join(".") + (index < segments.length - 1 ? "." : ""));
    }
    expect(await tab(input)).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
});

it.each(["unknown", "coop.unknown", "coop.help", "coop.help argument"])("leaves Tab navigation alone without a name completion: %s", async (draft) => {
    await mount();
    const input = await typeDraft(draft);
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(await tab(input)).toBe(false);
    expect(input.value).toBe(draft);
});

it.each([[2, 2], [0, 4]])("hides the ghost when editing or selecting within the draft (%i, %i)", async (start, end) => {
    await mount();
    const input = await typeDraft("coop.");
    await act(async () => {
        input.setSelectionRange(start, end);
        document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(await tab(input)).toBe(false);
});

it("preserves Shift+Tab navigation even when a ghost is visible", async () => {
    await mount();
    const input = await typeDraft("co");
    expect(await tab(input, true)).toBe(false);
    expect(input.value).toBe("co");
});

it("submits a typed command through the native form used by Enter", async () => {
    await mount();
    const input = await typeDraft("coop.help");
    await act(async () => input.form!.requestSubmit());
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ command: "coop.help" }), expect.any(String), "owner-id");
});

it("places only the input and Send below live output in the same card while idle", async () => {
    await mount();
    const output = container.querySelector('[aria-label="Live game console output"]')!;
    const form = container.querySelector("form")!;
    expect(form.closest("section")).toBe(output.closest("section"));
    expect(output.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[aria-label="Command result"]')).toBeNull();
    expect(form.nextElementSibling!.textContent).toBe("Enter to send");
    expect(form.nextElementSibling!.nextElementSibling).toBeNull();
    expect(form.querySelectorAll("input")).toHaveLength(1);
    expect(form.querySelectorAll("button")).toHaveLength(1);
    expect(form.querySelector("button")!.textContent).toBe("Send");
});

it.each(["rejected", "uncertain", "network"])("reports a late %s failure without locking or replacing the next draft", async (failure) => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    mocks.submit.mockReturnValueOnce(new Promise((accept, fail) => { resolve = accept; reject = fail; }));
    await mount();
    const input = await typeDraft("coop.help");
    await act(async () => button("Send").click());
    await typeDraft("coop.debug.alley.abandon");
    await act(async () => {
        if (failure === "network") reject(new Error("network"));
        else resolve({ ok: false, notSubmitted: failure === "rejected", message: "The command could not be sent." });
    });
    const error = container.querySelector('pre [role="alert"]')!.textContent;
    expect(error).toContain("coop.help:");
    expect(error).toContain(failure === "network" ? "Delivery could not be confirmed" : "The command could not be sent.");
    expect(input.value).toBe("coop.debug.alley.abandon");
    expect(input.disabled).toBe(false);
    expect(button("Retry send")).toBeUndefined();
    await act(async () => button("Send").click());
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit.mock.calls[1][1]).not.toBe(mocks.submit.mock.calls[0][1]);
});

it("allows multiple pending submissions and preserves the new draft when responses arrive", async () => {
    let acceptFirst!: (value: unknown) => void;
    let acceptSecond!: (value: unknown) => void;
    mocks.submit.mockReturnValueOnce(new Promise(resolve => { acceptFirst = resolve; }))
        .mockReturnValueOnce(new Promise(resolve => { acceptSecond = resolve; }));
    await mount();
    const input = await typeDraft("coop.help");
    await act(async () => button("Send").click());
    expect(input.value).toBe("");
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(button("Sending…")).toBeUndefined();
    await typeDraft("coop.debug.alley.abandon");
    await act(async () => input.form!.requestSubmit());
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit.mock.calls[0]).toEqual([expect.objectContaining({ command: "coop.help" }), expect.any(String), "owner-id"]);
    expect(mocks.submit.mock.calls[1]).toEqual([expect.objectContaining({ command: "coop.debug.alley.abandon" }), expect.any(String), "owner-id"]);
    expect(mocks.submit.mock.calls[1][1]).not.toBe(mocks.submit.mock.calls[0][1]);
    expect(input.value).toBe("");
    await typeDraft("coop.help next");
    await act(async () => acceptSecond({ ok: true, result: { outcome: "enqueued", jobId } }));
    expect(input.value).toBe("coop.help next");
    await act(async () => acceptFirst({ ok: true, result: { outcome: "enqueued", jobId } }));
    expect(input.value).toBe("coop.help next");
    expect(input.disabled).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
});

it("reports invalid input inside the console without adding footer messages", async () => {
    await mount();
    const input = await typeDraft("not-a-coop-command");
    await act(async () => input.form!.requestSubmit());
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(container.querySelector('pre [role="alert"]')!.textContent).toContain("Enter one coop.* command");
    expect(input.form!.nextElementSibling!.textContent).toBe("Enter to send");
    expect(input.form!.nextElementSibling!.nextElementSibling).toBeNull();
});

it.each([{ accessRole: "support" as const }, { operationState: "stopped" as const }, { observedGameState: "unknown" as const }])("disables commands for a read-only or non-running server: %o", async (state) => {
    await mount(state);
    expect(button("Send").disabled).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>("aside li button")].every(button => button.disabled)).toBe(true);
    expect(mocks.submit).not.toHaveBeenCalled();
});
