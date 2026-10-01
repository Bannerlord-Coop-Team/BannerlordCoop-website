import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ManagedServerConsole } from "./ManagedServerConsole";
import { ManagedServerCommands } from "./ManagedServerCommands";
import type { MyServerSummary } from "@/app/lib/control-plane/types";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), check: vi.fn(), ack: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/app/servers/managed-server-console-actions", () => ({ submitManagedConsoleCommand: mocks.submit, checkManagedConsoleCommand: mocks.check, acknowledgeManagedConsoleCommand: mocks.ack }));
vi.mock("./DownloadServerLogButton", () => ({ DownloadServerLogButton: () => <span>Download logs</span> }));
const server: MyServerSummary = { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Campaign", accessRole: "owner", operationState: "running", observedGameState: "running", friendlyRegion: "germany", releaseChannel: "stable", updatedAt: "2026-09-20T12:00:00.000Z" };
const jobId = "33333333-3333-4333-8333-333333333333";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers(); vi.resetAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    mocks.submit.mockResolvedValue({ ok: true, result: { outcome: "enqueued", jobId } });
    mocks.check.mockResolvedValue({ ok: true, result: { status: "pending" } });
    mocks.ack.mockResolvedValue({ ok: true, result: { acknowledged: true } });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

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

it("offers only coop cheats and selecting one never sends it; cancellation is respected", async () => {
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
    vi.mocked(window.confirm).mockReturnValue(false);
    await act(async () => button("Send").click());
    expect(mocks.submit).not.toHaveBeenCalled();
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
    await act(async () => root.render(<ManagedServerCommands server={server} userId="owner-id" controls={<p>Lifecycle controls</p>}><ManagedServerConsole serverId={server.serverId} /></ManagedServerCommands>));
    const output = container.querySelector('[aria-label="Live game console output"]')!;
    const form = container.querySelector("form")!;
    expect(form.closest("section")).toBe(output.closest("section"));
    expect(output.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[aria-label="Command result"]')).toBeNull();
    expect(form.parentElement!.textContent).toContain("Enter to send · Tab to complete");
    expect(form.querySelectorAll("input")).toHaveLength(1);
    expect(form.querySelectorAll("button")).toHaveLength(1);
    expect(form.querySelector("button")!.textContent).toBe("Send");
});

it("retries uncertain delivery with the exact original UUID and payload", async () => {
    mocks.submit.mockRejectedValueOnce(new Error("network"));
    await mount(); await select();
    await act(async () => button("Send").click());
    const original = mocks.submit.mock.calls[0];
    expect(button("Retry same request")).toBeDefined();
    expect(container.querySelector<HTMLInputElement>('input[placeholder="coop.…"]')!.disabled).toBe(true);
    await act(async () => button("Retry same request").click());
    expect(mocks.submit.mock.calls[1]).toEqual(original);
    expect(window.confirm).toHaveBeenCalledTimes(1);
});

it("polls request-bound results, renders plaintext and retains terminal output if acknowledgement fails", async () => {
    mocks.check.mockResolvedValue({ ok: true, result: { status: "succeeded", output: "<script>unsafe()</script>", outputTruncated: true, outputWithheld: false, completedAt: server.updatedAt } });
    mocks.ack.mockResolvedValueOnce({ ok: false, message: "Offline" });
    await mount(); await select();
    await act(async () => button("Send").click());
    expect(mocks.check).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(mocks.check).toHaveBeenCalledWith({ serverId: server.serverId, jobId, commandRequestId: mocks.submit.mock.calls[0][1] }, "owner-id");
    expect(container.querySelector("pre")!.textContent).toBe("<script>unsafe()</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("Output was truncated");
    expect(mocks.ack).not.toHaveBeenCalled();
    await act(async () => button("Acknowledge result").click());
    expect(container.querySelector("pre")!.textContent).toBe("<script>unsafe()</script>");
    expect(container.textContent).toContain("acknowledgement could not be confirmed");
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(mocks.check).toHaveBeenCalledTimes(1);
});

it.each([{ accessRole: "support" as const }, { operationState: "stopped" as const }, { observedGameState: "unknown" as const }])("disables commands for a read-only or non-running server: %o", async (state) => {
    await mount(state);
    expect(button("Send").disabled).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>("aside li button")].every(button => button.disabled)).toBe(true);
    expect(mocks.submit).not.toHaveBeenCalled();
});

it("stops automatic polling after a minute and manually checks the same job without resubmitting", async () => {
    await mount(); await select();
    await act(async () => button("Send").click());
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(button("Check result").disabled).toBe(false);
    const callsAtTimeout = mocks.check.mock.calls.length;
    const originalReference = mocks.check.mock.calls[0];
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.check).toHaveBeenCalledTimes(callsAtTimeout);
    await act(async () => button("Check result").click());
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(mocks.check.mock.calls.at(-1)).toEqual(originalReference);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
});
