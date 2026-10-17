import { TestLocalization } from "@/app/components/servers/ManagedServerLocalization.test-utils";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerCommands } from "./ManagedServerCommands";
import { serverResourceUsage } from "@/app/lib/hosting/server-resource-usage";
import type { MyServerSummary } from "@/app/lib/control-plane/types";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), check: vi.fn(), ack: vi.fn(), resources: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/servers/managed-server-console-actions", () => ({ submitManagedConsoleCommand: mocks.submit, checkManagedConsoleCommand: mocks.check, acknowledgeManagedConsoleCommand: mocks.ack }));
vi.mock("@/app/servers/managed-server-actions", () => ({ readManagedServerResources: mocks.resources }));
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
    mocks.resources.mockResolvedValue({ ok: true, usage: serverResourceUsage(sample) });
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
        { serverId: server.serverId, command: "coop.debug.save.force_autosave", expectedUpdatedAt: server.updatedAt }, expect.any(String), "owner-id");
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
