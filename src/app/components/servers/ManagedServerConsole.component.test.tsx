import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ManagedServerConsole } from "./ManagedServerConsole";
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
function button(label: string) { return [...container.querySelectorAll("button")].find(button => button.textContent === label)!; }
/** Selects a published cheat through the real shared picker. */
async function select() {
    await act(async () => container.querySelector<HTMLButtonElement>("aside li button")!.click());
}
/** Mounts the console with its lifecycle controls as provided by the page. */
async function mount(overrides: Partial<MyServerSummary> = {}) {
    await act(async () => root.render(<ManagedServerConsole server={{ ...server, ...overrides }} userId="owner-id" controls={<p>Lifecycle controls</p>} />));
}

it("offers only coop cheats and selecting one never sends it; cancellation is respected", async () => {
    await mount();
    const commands = [...container.querySelectorAll("aside code")].map(node => node.textContent!);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every(command => command.startsWith("coop."))).toBe(true);
    await select();
    expect(container.querySelector<HTMLInputElement>('input[placeholder="coop.…"]')!.value).toBe(commands[0]);
    expect(mocks.submit).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(false);
    await act(async () => button("Send").click());
    expect(mocks.submit).not.toHaveBeenCalled();
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
