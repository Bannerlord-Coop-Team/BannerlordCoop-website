import { TestLocalization } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerCommands } from "./ManagedServerCommands";
import { SAVE_RESULT_TIMEOUT_MILLISECONDS, readSaveOutcome } from "./ManagedServerRuntimeControls";
import { serverResourceUsage } from "@/app/lib/hosting/server-resource-usage";
import type { MyServerSummary } from "@/app/lib/control-plane/types";
import { ManagedServerControls } from "./ManagedServerControls";
import { ManagedServerPollingProvider, createManagedConsoleSignals, type ManagedConsoleSignals } from "./ManagedServerPollingProvider";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), check: vi.fn(), ack: vi.fn(), resources: vi.fn(), operate: vi.fn(), signals: null as ManagedConsoleSignals | null }));
vi.mock("./ManagedServerPollingProvider", async (original) => ({
    ...await original<typeof import("./ManagedServerPollingProvider")>(),
    useManagedConsoleSignals: () => mocks.signals,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/servers/managed-server-console-actions", () => ({ submitManagedConsoleCommand: mocks.submit, checkManagedConsoleCommand: mocks.check, acknowledgeManagedConsoleCommand: mocks.ack }));
vi.mock("@/app/servers/managed-server-actions", () => ({
    readManagedServerResources: mocks.resources, operateManagedServer: mocks.operate, readManagedServerStartStatus: vi.fn(), setManagedServerPassword: vi.fn(),
}));
vi.mock("./DownloadServerLogButton", () => ({ DownloadServerLogButton: () => <span>Download logs</span> }));
const server: MyServerSummary = { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Campaign", accessRole: "owner", operationState: "running", observedGameState: "running", friendlyRegion: "germany", releaseChannel: "stable", updatedAt: "2026-09-20T12:00:00.000Z" };
const sample = { observedAt: "2026-10-16T12:00:00.000Z", cpuVcpus: 1.25, cpuLimitVcpus: 2, memoryUsedBytes: 1_073_741_824, memoryLimitBytes: 3_221_225_472 };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers(); vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    mocks.submit.mockResolvedValue({ ok: true, result: { outcome: "enqueued", jobId: "33333333-3333-4333-8333-333333333333" } });
    mocks.check.mockResolvedValue({ ok: true, result: { status: "pending" } });
    mocks.ack.mockResolvedValue({ ok: true, result: { acknowledged: true } });
    mocks.resources.mockResolvedValue({ ok: true, usage: serverResourceUsage(sample) });
    mocks.signals = null;
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Finds a control by its accessible name or visible text. */
function control(name: string) {
    return [...container.querySelectorAll("button")].find(button => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === name)!;
}
async function mount(overrides: Partial<MyServerSummary> = {}) {
    await act(async () => root.render(<TestLocalization><ManagedServerCommands server={{ ...server, ...overrides }} userId="owner-id" controls={<p>Lifecycle controls</p>} /></TestLocalization>));
}

it("sends campaign speed and save as console commands and marks the chosen speed", async () => {
    await mount();
    expect(container.querySelector('[role="group"][aria-label="Campaign speed"]')).not.toBeNull();
    expect(control("Play at double speed").getAttribute("aria-pressed")).toBe("false");
    await act(async () => control("Play at double speed").click());
    expect(mocks.submit).toHaveBeenCalledWith(
        { serverId: server.serverId, command: "coop.debug.set_time_mode Play_2x", expectedUpdatedAt: server.updatedAt }, expect.any(String), "owner-id");
    expect(control("Play at double speed").getAttribute("aria-pressed")).toBe("true");
    expect(control("Pause").getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("Sent coop.debug.set_time_mode Play_2x. Output appears in the console below.");
    await act(async () => control("Save").click());
    expect(mocks.submit).toHaveBeenLastCalledWith(
        { serverId: server.serverId, command: "save", expectedUpdatedAt: server.updatedAt }, expect.any(String), "owner-id");
});

it("follows the speed the server reports and explains when it holds the campaign paused", async () => {
    const signals = createManagedConsoleSignals();
    mocks.signals = signals;
    await mount();
    await act(async () => signals.publish({ type: "speed", serverId: server.serverId, connection: 1, speed: "play-2x" }));
    expect(control("Play at double speed").getAttribute("aria-pressed")).toBe("true");
    await act(async () => signals.publish({ type: "speed", serverId: "44444444-4444-4444-8444-444444444444", connection: 1, speed: "pause" }));
    expect(control("Play at double speed").getAttribute("aria-pressed")).toBe("true");
    await act(async () => signals.publish({ type: "speed", serverId: server.serverId, connection: 1, speed: "pause", heldBy: "no-players" }));
    expect(control("Pause").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("The campaign stays paused until a player joins.");
});

it("reports a rejected command without changing the selected speed", async () => {
    mocks.submit.mockResolvedValue({ ok: false, notSubmitted: false, uncertain: false, refresh: false, message: "The server is busy with another command." });
    await mount();
    await act(async () => control("Pause").click());
    expect(control("Pause").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("The server is busy with another command.");
});

it("disables speed and save and hides usage until the game is running", async () => {
    await mount({ operationState: "stopped", observedGameState: "stopped" });
    for (const name of ["Pause", "Play at normal speed", "Play at double speed", "Save"]) expect(control(name).disabled).toBe(true);
    expect(container.querySelector('[role="group"][aria-label="Campaign speed"]')?.getAttribute("title")).toBe("Start the server to change campaign speed or save.");
    expect(mocks.resources).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Resource usage"]')).toBeNull();
});

it("shows only CPU and memory percentages of the server's own allocation and keeps reading them", async () => {
    await mount();
    const usage = container.querySelector('[aria-label="Resource usage"]')!;
    expect(usage.textContent).toBe("CPU63%Memory33%");
    expect(usage.textContent).not.toMatch(/vCPU|GB|allocated/u);
    expect(mocks.resources).toHaveBeenCalledWith(server.serverId);
    mocks.resources.mockResolvedValue({ ok: true, usage: null });
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.resources).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="Resource usage"]')).toBeNull();
});

it("reduces a sample to shares only, capping CPU at the allocation", () => {
    expect(serverResourceUsage({ ...sample, cpuVcpus: 2.1 })).toEqual({ cpu: 1, memory: 1 / 3 });
});

const jobId = "33333333-3333-4333-8333-333333333333";
const succeeded = (output: string) => ({ ok: true, result: { status: "succeeded", output, outputTruncated: false, outputWithheld: false, completedAt: "2026-10-17T02:35:02.734Z" } });
/** Clicks Save and lets the result polling run for the given time. */
async function saveAndWait(milliseconds: number) {
    await act(async () => control("Save").click());
    await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}

it("waits for the save result, reports success and acknowledges it", async () => {
    mocks.check.mockResolvedValueOnce({ ok: true, result: { status: "pending" } })
        .mockResolvedValue(succeeded("[DedicatedServer] operator save: world saved to 'default_new_game.sav' (2710 ms)"));
    await mount();
    await act(async () => control("Save").click());
    expect(container.textContent).toContain("Saving the world…");
    expect(control("Save…").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    const reference = { serverId: server.serverId, jobId, commandRequestId: mocks.submit.mock.calls[0][1] };
    expect(mocks.check).toHaveBeenCalledWith(reference, "owner-id");
    expect(mocks.ack).toHaveBeenCalledWith(reference, "owner-id");
    expect(container.querySelector('p[aria-live="polite"]')?.textContent).toBe("World saved in 2.7 s.");
    expect(control("Save").disabled).toBe(false);
});

it.each([
    ["[DedicatedServer] operator save skipped: a world save is already in progress", "Save skipped: a world save is already in progress"],
    ["[DedicatedServer] operator save FAILED (IOError; world keeps running)", "Save failed: IOError"],
])("reports a save the server did not complete: %s", async (output, message) => {
    mocks.check.mockResolvedValue(succeeded(output));
    await mount();
    await saveAndWait(1_000);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
});

it("explains a runner that cannot save yet, and a save it never confirms", async () => {
    mocks.check.mockResolvedValue({ ok: true, result: { status: "failed", errorCode: "invalid_request" } });
    await mount();
    await saveAndWait(1_000);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("This server can't save on demand yet. Try again after its next update.");

    mocks.check.mockReset();
    mocks.check.mockResolvedValue({ ok: false, notSubmitted: false, uncertain: true, refresh: false, message: "offline" });
    await saveAndWait(SAVE_RESULT_TIMEOUT_MILLISECONDS - 5_000);
    expect(container.textContent).toContain("Saving the world…");
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("We couldn't confirm the save. Check the console output before trying again.");
    expect(mocks.ack).toHaveBeenCalledTimes(1); // only the terminal "cannot save yet" result
});

/** Mounts the console with the real lifecycle controls inside the shared provider, as the manage page does. */
async function mountWithLifecycle() {
    await act(async () => root.render(<TestLocalization><ManagedServerPollingProvider>
        <ManagedServerCommands server={server} userId="owner-id" controls={<ManagedServerControls serverId={server.serverId} displayName="Campaign"
            accessRole="owner" operationState="running" observedGameState="running" expectedUpdatedAt={server.updatedAt} />} />
    </ManagedServerPollingProvider></TestLocalization>));
}

it("disables Stop and Restart while the Save button's save runs and re-enables them with its result", async () => {
    mocks.check.mockResolvedValueOnce({ ok: true, result: { status: "pending" } })
        .mockResolvedValue(succeeded("[DedicatedServer] operator save: world saved to 'default_new_game.sav' (2710 ms)"));
    await mountWithLifecycle();
    expect([control("Stop").disabled, control("Restart").disabled]).toEqual([false, false]);
    await act(async () => control("Save").click());
    expect([control("Stop").disabled, control("Restart").disabled]).toEqual([true, true]);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect([control("Stop").disabled, control("Restart").disabled]).toEqual([true, true]);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(container.textContent).toContain("World saved in 2.7 s.");
    expect([control("Stop").disabled, control("Restart").disabled]).toEqual([false, false]);
    expect(mocks.operate).not.toHaveBeenCalled();
});

it("re-enables Stop and Restart when the save request itself is refused", async () => {
    const response = Promise.withResolvers<unknown>();
    mocks.submit.mockReturnValue(response.promise);
    await mountWithLifecycle();
    await act(async () => control("Save").click());
    expect([control("Stop").disabled, control("Restart").disabled]).toEqual([true, true]);
    await act(async () => response.resolve({ ok: false, notSubmitted: true, uncertain: false, refresh: false, message: "The server is busy with another command." }));
    expect([control("Stop").disabled, control("Restart").disabled]).toEqual([false, false]);
});

it("reads the dedicated server's save outcome lines", () => {
    expect(readSaveOutcome({ status: "pending" })).toBeNull();
    expect(readSaveOutcome({ status: "cancelled" })).toEqual({ kind: "unconfirmed" });
    expect(readSaveOutcome({ status: "failed", errorCode: "game_unavailable" })).toEqual({ kind: "unconfirmed" });
    const result = (output: string) => ({ status: "succeeded" as const, output, outputTruncated: false, outputWithheld: false, completedAt: "2026-10-17T02:35:02.734Z" });
    expect(readSaveOutcome(result("[DedicatedServer] operator save FAILED (world keeps running): System.IO.IOException"))).toEqual({ kind: "failed", reason: null });
    expect(readSaveOutcome(result("something else"))).toEqual({ kind: "unconfirmed" });
});
