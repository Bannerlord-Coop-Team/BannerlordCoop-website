import { act, useEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerControls } from "./ManagedServerControls";
import { ManagedServerBackups } from "./ManagedServerBackups";
import { ManagedServerPollingProvider, managedServerPollDelay, useManagedServerPolling, useManagedServerSaves, type ManagedServerStatusReader } from "./ManagedServerPollingProvider";
import { TestLocalization } from "./ManagedServerLocalization.test-utils";

const { operate, router } = vi.hoisted(() => ({ operate: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/servers/managed-server-actions", () => ({
    operateManagedServer: operate, readManagedServerStartStatus: vi.fn(), setManagedServerPassword: vi.fn(),
}));
vi.mock("@/app/servers/managed-server-backup-actions", () => ({ manageServerBackup: vi.fn() }));

const server = { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Campaign",
    accessRole: "owner" as const, operationState: "running", observedGameState: "running",
    expectedUpdatedAt: "2026-10-02T16:00:00.000Z" };
let container: HTMLDivElement;
let root: Root;
const buttons = () => [...container.querySelectorAll("button")];
const render = (overrides: Partial<ComponentProps<typeof ManagedServerControls>> = {}) => act(async () => root.render(
    <TestLocalization><ManagedServerPollingProvider><ManagedServerControls {...server} {...overrides} /></ManagedServerPollingProvider></TestLocalization>,
));

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    operate.mockReset(); router.refresh.mockClear();
    container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(["accepted", "unknown", "lost-response"])("automatically confirms Stop after %s without resending it", async outcome => {
    if (outcome === "lost-response") operate.mockRejectedValue(new Error("private transport details"));
    else operate.mockResolvedValue({ ok: outcome === "accepted", checkStatus: true, message: "Checking whether your server has stopped…" });
    await render();
    await act(async () => buttons()[1].click());
    expect(container.textContent).toContain("Checking whether your server has stopped");
    expect(container.textContent).not.toContain("private transport details");
    expect(buttons().slice(0, 4).every(button => button.disabled)).toBe(true);
    expect(router.refresh).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(router.refresh).toHaveBeenCalledTimes(2);
    await render({ operationState: "stopping", expectedUpdatedAt: "2026-10-02T16:00:01.000Z" });
    expect(container.textContent).not.toContain("Server stopped.");
    await render({ operationState: "stopped", observedGameState: "stopped", expectedUpdatedAt: "2026-10-02T16:00:02.000Z" });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).toContain("Server stopped.");
    expect(buttons()[0].disabled).toBe(false);
    expect(buttons()[1].disabled).toBe(true);
    const refreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledTimes(refreshes);
    expect(operate).toHaveBeenCalledExactlyOnceWith({ serverId: server.serverId, action: "stop" });
});

it("keeps checking a stopped drifted game until CP verifies readiness and unlocks Start", async () => {
    operate.mockResolvedValue({ ok: true, checkStatus: true, message: "Checking whether your server has stopped…" });
    const runtimeInsight = { desiredState: "running" as const, observedAt: null, allowedActions: ["stop" as const], crashLoopDetected: false,
        failureCode: "game_crashed_during_load" as const, failureMessage: "Campaign load failed.", recommendedAction: "review-backups" as const,
        recommendation: "Review recovery.", start: null };
    await render({ operationState: "drifted", observedGameState: "failed", runtimeInsight });
    await act(async () => buttons().find(button => button.textContent === "Stop")!.click());
    await render({ operationState: "drifted", observedGameState: "stopped", expectedUpdatedAt: "2026-10-02T16:00:01.000Z", runtimeInsight });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).not.toContain("Server stopped.");
    await render({ operationState: "drifted", observedGameState: "stopped", expectedUpdatedAt: "2026-10-02T16:00:02.000Z",
        runtimeInsight: { ...runtimeInsight, desiredState: "stopped", allowedActions: [] } });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).not.toContain("Server stopped.");
    expect(container.textContent).toContain("Start and recovery tools unlock after server checks confirm readiness.");
    expect(buttons().find(button => button.textContent === "Start")?.disabled).toBe(true);
    const refreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(router.refresh.mock.calls.length).toBeGreaterThan(refreshes);
    await render({ operationState: "stopped", observedGameState: "stopped", expectedUpdatedAt: "2026-10-02T16:00:03.000Z",
        runtimeInsight: { ...runtimeInsight, desiredState: "stopped", allowedActions: [], failureCode: null, failureMessage: null, recommendedAction: null, recommendation: null } });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).not.toContain("Server stopped.");
    const blockedRefreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(router.refresh.mock.calls.length).toBeGreaterThan(blockedRefreshes);
    await render({ operationState: "stopped", observedGameState: "stopped", expectedUpdatedAt: "2026-10-02T16:00:03.000Z",
        runtimeInsight: { ...runtimeInsight, desiredState: "stopped", allowedActions: ["start"], failureCode: null, failureMessage: null, recommendedAction: null, recommendation: null } });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).toContain("Server stopped.");
    expect(buttons().find(button => button.textContent === "Start")?.disabled).toBe(false);
    const settledRefreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledTimes(settledRefreshes);
});

it.each(["stopped", "drifted"])("settles a crash-loop Stop in %s without waiting for Start cooldown", async operationState => {
    operate.mockResolvedValue({ ok: true, checkStatus: true, message: "Checking whether your server has stopped…" });
    const runtimeInsight = { desiredState: "running" as const, observedAt: null, allowedActions: ["stop" as const], crashLoopDetected: true,
        failureCode: "crash_loop_cooldown" as const, failureMessage: "Crash-loop protection is active.", recommendedAction: "wait" as const,
        recommendation: "Wait for the crash-loop cooldown before starting again.", start: null };
    const renderCase = async (settled: boolean) => act(async () => root.render(
        <TestLocalization><ManagedServerPollingProvider><PollingProbe />
            <ManagedServerControls {...server} operationState={settled ? operationState : "failed"}
                observedGameState={settled ? "stopped" : "failed"}
                expectedUpdatedAt={settled ? "2026-10-02T16:00:01.000Z" : server.expectedUpdatedAt}
                runtimeInsight={settled ? { ...runtimeInsight, desiredState: "stopped", allowedActions: [] } : runtimeInsight} />
            <ManagedServerBackups userId="owner" server={{ serverId: server.serverId, displayName: server.displayName,
                accessRole: "owner", friendlyRegion: "Europe", releaseChannel: "stable", updatedAt: server.expectedUpdatedAt,
                operationState: settled ? operationState : "failed", observedGameState: settled ? "stopped" : "failed" }} backups={[]} status={null} />
        </ManagedServerPollingProvider></TestLocalization>,
    ));
    await renderCase(false);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => buttons().find(button => button.textContent === "Stop")!.click());
    expect(buttons().find(button => button.textContent === "Create backup")?.disabled).toBe(true);
    await renderCase(true);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).toContain("Server stopped.");
    expect(container.textContent).toContain(runtimeInsight.failureMessage);
    expect(container.textContent).toContain(runtimeInsight.recommendation);
    expect(container.textContent).not.toContain("press Start when ready");
    expect(buttons().find(button => button.textContent === "Start")?.disabled).toBe(true);
    expect(buttons().find(button => button.textContent === "Create backup")?.disabled).toBe(false);
    expect(polling.session).toBeNull();
    const refreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(16 * 60_000));
    expect(router.refresh).toHaveBeenCalledTimes(refreshes);
    expect(container.textContent).not.toContain("Stopping is taking longer than usual");
});

it("does not enter the long Stop poll when another operation already owns the server", async () => {
    operate.mockResolvedValue({ ok: false, refresh: true, message: "Another server operation is active. Wait for its status to finish, then try again." });
    await render();
    await act(async () => buttons()[1].click());
    expect(container.textContent).toContain("Another server operation is active");
    expect(router.refresh).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(buttons()[1].disabled).toBe(false);
    expect(operate).toHaveBeenCalledExactlyOnceWith({ serverId: server.serverId, action: "stop" });
});

it("shows immediate feedback while Stop is being sent", async () => {
    const response = Promise.withResolvers<{ ok: boolean; checkStatus: boolean; message: string }>();
    operate.mockReturnValue(response.promise);
    await render();
    await act(async () => buttons()[1].click());
    expect(container.textContent).toContain("Sending your Stop request");
    expect(buttons().every(button => button.disabled)).toBe(true);
    await act(async () => response.resolve({ ok: true, checkStatus: true, message: "Checking whether your server has stopped…" }));
});

it("requires a newer stopped observation and keeps checking for fifteen minutes before offering Check now", async () => {
    operate.mockResolvedValue({ ok: false, checkStatus: true, message: "Checking whether your server has stopped…" });
    await render(); await act(async () => buttons()[1].click());
    await render({ operationState: "stopped", observedGameState: "stopped" });
    expect(container.textContent).not.toContain("Server stopped.");
    await render({ operationState: "stopped", expectedUpdatedAt: "2026-10-02T16:00:01.000Z" });
    expect(container.textContent).not.toContain("Server stopped.");
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(container.textContent).not.toContain("taking longer than usual");
    expect(container.textContent).not.toContain("paused");
    expect(buttons().slice(0, 4).every(button => button.disabled)).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(container.textContent).toContain("Stopping is taking longer than usual, so automatic status updates have paused.");
    expect(container.textContent).not.toContain("contact support");
    // A paused check no longer blocks the owner: controls follow the last observed state.
    expect(buttons().slice(0, 4).map(button => button.disabled)).toEqual([true, false, false, false]);
    const refreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledTimes(refreshes);
    await act(async () => buttons().find(button => button.textContent === "Check now")!.click());
    expect(router.refresh).toHaveBeenCalledTimes(refreshes + 1);
    expect(container.textContent).not.toContain("taking longer than usual");
    expect(operate).toHaveBeenCalledTimes(1);
});

it("keeps a definitive rejection visible without polling or retrying", async () => {
    operate.mockResolvedValue({ ok: false, message: "This server is unavailable or your access was removed." });
    await render(); await act(async () => buttons()[1].click());
    expect(container.textContent).toContain("your access was removed");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(operate).toHaveBeenCalledTimes(1);
});

it("asks the owner to retry Stop after a save without checking status, and keeps Stop usable", async () => {
    const message = "The game is saving right now. Wait a few seconds for the save to finish, then try Stop again.";
    operate.mockResolvedValue({ ok: false, message });
    await render(); await act(async () => buttons()[1].click());
    expect(container.textContent).toContain(message);
    expect(container.textContent).not.toContain("Checking whether your server has stopped");
    expect(buttons().slice(1, 3).map(button => button.disabled)).toEqual([false, false]);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => buttons()[1].click());
    expect(operate).toHaveBeenCalledTimes(2);
});

let saves: ReturnType<typeof useManagedServerSaves>;
/** Exposes the shared save tracker, standing in for the Save button or a typed save. */
function SavesProbe() {
    const value = useManagedServerSaves();
    useEffect(() => { saves = value; });
    return null;
}

it("disables Stop and Restart only while a save of this server is in flight", async () => {
    await act(async () => root.render(<TestLocalization><ManagedServerPollingProvider><SavesProbe /><ManagedServerControls {...server} /></ManagedServerPollingProvider></TestLocalization>));
    const powerButtons = () => buttons().slice(0, 4).map(button => button.disabled);
    expect(powerButtons()).toEqual([true, false, false, false]);
    let release = () => {};
    let second = () => {};
    await act(async () => { saves!.beginSave("44444444-4444-4444-8444-444444444444"); });
    expect(powerButtons()).toEqual([true, false, false, false]);
    await act(async () => { release = saves!.beginSave(server.serverId); second = saves!.beginSave(server.serverId); });
    expect(powerButtons()).toEqual([true, true, true, false]);
    await act(async () => buttons()[1].click());
    expect(operate).not.toHaveBeenCalled();
    await act(async () => { release(); release(); });
    expect(powerButtons()).toEqual([true, true, true, false]);
    await act(async () => second());
    expect(powerButtons()).toEqual([true, false, false, false]);
});

it("stops refreshing when the controls unmount", async () => {
    operate.mockResolvedValue({ ok: false, checkStatus: true, message: "Checking whether your server has stopped…" });
    await render(); await act(async () => buttons()[1].click());
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(operate).toHaveBeenCalledTimes(1);
});

let polling: ReturnType<typeof useManagedServerPolling>;
/** Exposes the shared polling API to tests. */
function PollingProbe() {
    const value = useManagedServerPolling();
    useEffect(() => { polling = value; });
    return null;
}

/** Mounts the provider with a probe and the lifecycle controls. */
async function renderWithProbe(readStatus?: ManagedServerStatusReader, operationState?: string) {
    await act(async () => root.render(
        <TestLocalization><ManagedServerPollingProvider readStatus={readStatus} initialServer={operationState === undefined ? undefined : { serverId: server.serverId, updatedAt: server.expectedUpdatedAt, operationState }}><PollingProbe /><ManagedServerControls {...server} /></ManagedServerPollingProvider></TestLocalization>,
    ));
}

it.each(["provisioning", "configuring"])("automatically follows %s until initialization settles, then preserves normal lifecycle polling", async operationState => {
    await renderWithProbe(undefined, operationState);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(polling.session).toMatchObject({ serverId: server.serverId, statusSource: "initialization" });
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(router.refresh).toHaveBeenCalledTimes(2);
    await renderWithProbe(undefined, "stopped");
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(polling.session).toBeNull();
    const refreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledTimes(refreshes);
    await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt));
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(polling.session).toMatchObject({ statusSource: "server" });
    expect(router.refresh).toHaveBeenCalledTimes(refreshes + 2);
});

it("spaces refreshes from 4 s to 8 s to 15 s as an operation runs longer", () => {
    expect([0, 59_999, 60_000, 179_999, 180_000, 14 * 60_000].map(managedServerPollDelay)).toEqual([4_000, 4_000, 8_000, 8_000, 15_000, 15_000]);
});

it("keeps a backup session, and the controls busy, until the operation settles or fifteen minutes pass", async () => {
    await renderWithProbe();
    await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt, "33333333-3333-4333-8333-333333333333", "backup"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledTimes(16);
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(router.refresh).toHaveBeenCalledTimes(31);
    await act(async () => vi.advanceTimersByTimeAsync(150_000));
    expect(router.refresh).toHaveBeenCalledTimes(41);
    expect(polling.session).not.toBeNull();
    expect(polling.timedOutSession).toBeNull();
    expect(buttons().slice(0, 4).every(button => button.disabled)).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(15 * 60_000 - 330_000));
    expect(polling.session).toBeNull();
    expect(polling.timedOutSession).toMatchObject({ serverId: server.serverId, statusSource: "backup", jobId: "33333333-3333-4333-8333-333333333333" });
    const refreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledTimes(refreshes);
});

it("ends a session as soon as its owner reports that the operation settled", async () => {
    await renderWithProbe();
    await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt, undefined, "backup"));
    await act(async () => polling.attachJob(server.serverId, "33333333-3333-4333-8333-333333333333"));
    expect(polling.session).toMatchObject({ jobId: "33333333-3333-4333-8333-333333333333" });
    await act(async () => polling.endPolling(server.serverId));
    expect(polling.session).toBeNull();
    expect(buttons()[1].disabled).toBe(false);
    const refreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledTimes(refreshes);
});

it("re-renders the page only when the compact server status changes", async () => {
    const readStatus = vi.fn<ManagedServerStatusReader>().mockResolvedValue({ ok: true, fingerprint: "running" });
    await renderWithProbe(readStatus);
    await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt));
    // The opening refresh reads the fingerprint first, so an unchanged first check renders nothing.
    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(16_000));
    expect(readStatus).toHaveBeenCalledTimes(6);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    readStatus.mockResolvedValue({ ok: true, fingerprint: "stopping" });
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(router.refresh).toHaveBeenCalledTimes(2);
    readStatus.mockResolvedValue({ ok: false });
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(router.refresh).toHaveBeenCalledTimes(3);
    expect(readStatus).toHaveBeenCalledWith(server.serverId);
});

it("opens a polling session within 1.5 s when the status read is slow", async () => {
    const readStatus = vi.fn<ManagedServerStatusReader>(() => new Promise(() => undefined));
    await renderWithProbe(readStatus);
    await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt));
    await act(async () => vi.advanceTimersByTimeAsync(1_499));
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(router.refresh).toHaveBeenCalledOnce();
});

it("shares a slow opening status read with the next check instead of starting another", async () => {
    let release!: (value: { ok: true; fingerprint: string }) => void;
    const readStatus = vi.fn<ManagedServerStatusReader>()
        .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
        .mockResolvedValue({ ok: true, fingerprint: "running" });
    await renderWithProbe(readStatus);
    await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt));
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(router.refresh).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(readStatus).toHaveBeenCalledOnce();
    await act(async () => release({ ok: true, fingerprint: "running" }));
    expect(router.refresh).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalledTimes(2);
});

it("keeps the polling baseline when a backup request's job attaches", async () => {
    const readStatus = vi.fn<ManagedServerStatusReader>().mockResolvedValue({ ok: true, fingerprint: "running" });
    await renderWithProbe(readStatus);
    await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt, undefined, "backup"));
    expect(router.refresh).toHaveBeenCalledOnce();
    await act(async () => polling.attachJob(server.serverId, "33333333-3333-4333-8333-333333333333"));
    expect(router.refresh).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalledOnce();
});

it("still opens with a refresh when a job attaches during the opening status read", async () => {
    const readStatus = vi.fn<ManagedServerStatusReader>()
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockResolvedValue({ ok: true, fingerprint: "running" });
    await renderWithProbe(readStatus);
    await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt, undefined, "backup"));
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => polling.attachJob(server.serverId, "33333333-3333-4333-8333-333333333333"));
    // The restarted opening shares the pending read, then refreshes when its own wait ends.
    expect(readStatus).toHaveBeenCalledOnce();
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(router.refresh).toHaveBeenCalledOnce();
});

it("shares one status read when a shown tab's catch-up and a scheduled check overlap", async () => {
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    try {
        const readStatus = vi.fn<ManagedServerStatusReader>().mockResolvedValue({ ok: true, fingerprint: "running" });
        await renderWithProbe(readStatus);
        await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt));
        visibility = "hidden";
        await act(async () => vi.advanceTimersByTimeAsync(4_000));
        expect(readStatus).toHaveBeenCalledOnce();
        let release!: (value: { ok: true; fingerprint: string }) => void;
        readStatus.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        visibility = "visible";
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
        await act(async () => vi.advanceTimersByTimeAsync(4_000));
        expect(readStatus).toHaveBeenCalledTimes(2);
        await act(async () => release({ ok: true, fingerprint: "stopping" }));
        expect(router.refresh).toHaveBeenCalledTimes(2);
    } finally {
        Reflect.deleteProperty(document, "visibilityState");
    }
});

it("releases the controls after two minutes when a backup request's job never appears", async () => {
    await renderWithProbe();
    await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt, undefined, "backup"));
    await act(async () => vi.advanceTimersByTimeAsync(2 * 60_000 - 1));
    expect(polling.session).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(polling.session).toBeNull();
    expect(polling.timedOutSession).toMatchObject({ statusSource: "backup", jobId: null });
    expect(buttons()[1].disabled).toBe(false);
});

it("follows an attached backup job for the full fifteen minutes", async () => {
    await renderWithProbe();
    await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt, undefined, "backup"));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    await act(async () => polling.attachJob(server.serverId, "33333333-3333-4333-8333-333333333333"));
    await act(async () => vi.advanceTimersByTimeAsync(14 * 60_000 - 1));
    expect(polling.session).toMatchObject({ jobId: "33333333-3333-4333-8333-333333333333" });
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(polling.session).toBeNull();
});

it("defers refreshes while the tab is hidden and catches up when it is shown", async () => {
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    try {
        await renderWithProbe();
        await act(async () => polling.beginPolling(server.serverId, server.expectedUpdatedAt));
        visibility = "hidden";
        await act(async () => vi.advanceTimersByTimeAsync(30_000));
        expect(router.refresh).toHaveBeenCalledTimes(1);
        visibility = "visible";
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
        expect(router.refresh).toHaveBeenCalledTimes(2);
        await act(async () => vi.advanceTimersByTimeAsync(2_000));
        expect(router.refresh).toHaveBeenCalledTimes(3);
    } finally {
        Reflect.deleteProperty(document, "visibilityState");
    }
});
