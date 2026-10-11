import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerControls, acceptRestartProgress, advanceRestartProgress, beginRestartProgress } from "./ManagedServerControls";
import { ManagedServerPollingProvider, useManagedConsoleSignals, useManagedServerPolling, type ManagedConsoleSignal, type ManagedConsoleSignals } from "./ManagedServerPollingProvider";
import { TestLocalization } from "./ManagedServerLocalization.test-utils";

const { operate, router } = vi.hoisted(() => ({ operate: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/servers/managed-server-actions", () => ({
    operateManagedServer: operate, readManagedServerStartStatus: vi.fn(), setManagedServerPassword: vi.fn(),
}));

const server = { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Campaign",
    accessRole: "owner" as const, operationState: "running", observedGameState: "running",
    expectedUpdatedAt: "2026-10-02T16:00:00.000Z" };
const serverId = server.serverId;
const accepted = { ok: true, message: "Restarting. Players can rejoin once the campaign finishes loading, usually within a couple of minutes." };
let container: HTMLDivElement;
let root: Root;
let channel: ManagedConsoleSignals;
let polling: ReturnType<typeof useManagedServerPolling>;
const buttons = () => [...container.querySelectorAll("button")];
const currentStep = () => container.querySelector('[aria-current="step"]')?.textContent ?? "";

/** Stands in for a mounted live console sharing its phases through the provider. */
function FakeConsole() {
    const signals = useManagedConsoleSignals()!;
    const pollingContext = useManagedServerPolling();
    useEffect(() => { polling = pollingContext; }, [pollingContext]);
    useEffect(() => {
        channel = signals;
        return signals.attach(serverId);
    }, [signals]);
    return null;
}

/** Mounts the controls inside the shared provider, optionally with a live console. */
function render(overrides: Partial<typeof server> = {}, withConsole = true) {
    return act(async () => root.render(
        <TestLocalization><ManagedServerPollingProvider>{withConsole && <FakeConsole />}<ManagedServerControls {...server} {...overrides} /></ManagedServerPollingProvider></TestLocalization>,
    ));
}

/** Publishes one console signal and flushes the resulting renders. */
async function emit(signal: ManagedConsoleSignal) {
    await act(async () => channel.publish(signal));
}

/** Requests a confirmed Restart whose response the test resolves later. */
async function requestRestart() {
    const response = Promise.withResolvers<{ ok: boolean; message: string; checkStatus?: boolean }>();
    operate.mockReturnValueOnce(response.promise);
    await act(async () => { buttons()[2].click(); });
    return response;
}

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    operate.mockReset(); router.refresh.mockClear();
    container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.useRealTimers(); });

it("explains a disabled Stop when the server is already stopped", async () => {
    await render({ operationState: "stopped", observedGameState: "stopped" });
    expect(buttons()[1].disabled).toBe(true);
    expect(container.textContent).toContain("The server is already stopped");
    expect(buttons()[0].disabled).toBe(false);
    expect(operate).not.toHaveBeenCalled();
});

it("follows Restart through live game phases without locking Stop and Restart after command success", async () => {
    await render();
    await emit({ type: "opened", serverId, connection: 1 });
    await emit({ type: "phase", serverId, connection: 1, phase: "serving" });
    const response = await requestRestart();
    expect(container.textContent).toContain("Restarting your server…");
    expect(container.textContent).toContain("Sending your Restart request…");
    expect(currentStep()).toContain("Restart requested");
    expect(buttons().slice(0, 4).every(button => button.disabled)).toBe(true);
    await emit({ type: "phase", serverId, connection: 1, phase: "serving" });
    expect(currentStep()).toContain("Restart requested");
    await act(async () => response.resolve(accepted));
    expect(currentStep()).toContain("Stop the game");
    expect(container.textContent).toContain("Players can rejoin once the campaign finishes loading.");
    expect(container.textContent).not.toContain("code 0");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(buttons().slice(0, 4).map(button => button.disabled)).toEqual([true, false, false, true]);
    await emit({ type: "phase", serverId, connection: 1, phase: "stopping" });
    await emit({ type: "closed", serverId, connection: 1, runEnded: true });
    expect(currentStep()).toContain("Stop the game");
    await emit({ type: "opened", serverId, connection: 2 });
    await emit({ type: "phase", serverId, connection: 2, phase: "boot" });
    expect(currentStep()).toContain("Load campaign");
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(router.refresh).toHaveBeenCalledTimes(2);
    await emit({ type: "phase", serverId, connection: 2, phase: "loading" });
    expect(buttons().slice(0, 4).map(button => button.disabled)).toEqual([true, false, false, true]);
    await emit({ type: "phase", serverId, connection: 2, phase: "serving" });
    expect(container.textContent).toContain("Your server is ready to join");
    expect(currentStep()).toContain("Ready to join");
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(buttons().slice(0, 4).map(button => button.disabled)).toEqual([true, false, false, false]);
    const refreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledTimes(refreshes);
    expect(operate).toHaveBeenCalledExactlyOnceWith({ serverId, action: "restart-game" });
});

it("follows the restarted run on the same stream, as the live runner reports it", async () => {
    // Production sequence: the stream opened before Restart survives the container restart.
    await render();
    await emit({ type: "opened", serverId, connection: 1 });
    const response = await requestRestart();
    await act(async () => response.resolve(accepted));
    expect(currentStep()).toContain("Stop the game");
    await emit({ type: "phase", serverId, connection: 1, phase: "loading" });
    expect(currentStep()).toContain("Load campaign");
    expect(buttons().slice(0, 4).map(button => button.disabled)).toEqual([true, false, false, true]);
    await emit({ type: "phase", serverId, connection: 1, phase: "serving" });
    expect(container.textContent).toContain("Your server is ready to join");
    expect(buttons()[2].disabled).toBe(false);
});

it("ignores a ready report from the old run until the restarted run is seen", async () => {
    await render();
    await emit({ type: "opened", serverId, connection: 1 });
    const response = await requestRestart();
    await emit({ type: "phase", serverId, connection: 1, phase: "serving" });
    expect(currentStep()).toContain("Restart requested");
    await act(async () => response.resolve(accepted));
    await emit({ type: "phase", serverId, connection: 1, phase: "serving" });
    expect(currentStep()).toContain("Stop the game");
    await emit({ type: "opened", serverId, connection: 2 });
    await emit({ type: "phase", serverId, connection: 2, phase: "serving" });
    expect(container.textContent).toContain("Your server is ready to join");
});

it("waits for the restarted run to boot before trusting the same stream", async () => {
    await render();
    await emit({ type: "opened", serverId, connection: 1 });
    const response = await requestRestart();
    await act(async () => response.resolve(accepted));
    await emit({ type: "phase", serverId, connection: 1, phase: "stopping" });
    await emit({ type: "phase", serverId, connection: 1, phase: "fatal", detail: "Shutdown noise" });
    await emit({ type: "phase", serverId, connection: 1, phase: "serving" });
    expect(currentStep()).toContain("Stop the game");
    await emit({ type: "phase", serverId, connection: 1, phase: "boot" });
    expect(currentStep()).toContain("Load campaign");
    await emit({ type: "phase", serverId, connection: 1, phase: "serving" });
    expect(container.textContent).toContain("Your server is ready to join");
});

it("reports a game error during the restart and releases the controls", async () => {
    await render();
    await emit({ type: "opened", serverId, connection: 1 });
    const response = await requestRestart();
    await act(async () => response.resolve(accepted));
    await emit({ type: "closed", serverId, connection: 1, runEnded: true });
    await emit({ type: "opened", serverId, connection: 2 });
    await emit({ type: "phase", serverId, connection: 2, phase: "fatal", detail: "IOException: disk full" });
    expect(container.textContent).toContain("Server could not restart");
    expect(container.textContent).toContain("The game stopped with an error before the campaign finished loading.");
    expect(container.textContent).toContain("IOException: disk full");
    expect(buttons()[2].disabled).toBe(false);
});

it("falls back to plain guidance and releases the controls if the game is not ready within five minutes", async () => {
    await render();
    await emit({ type: "opened", serverId, connection: 1 });
    const response = await requestRestart();
    await act(async () => response.resolve(accepted));
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000 - 1));
    expect(buttons()[2].disabled).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(container.textContent).toContain("Restarting. Players can rejoin once the campaign finishes loading, usually within a couple of minutes.");
    expect(container.querySelector("ol")).toBeNull();
    expect(buttons().slice(0, 4).map(button => button.disabled)).toEqual([true, false, false, false]);
    const refreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledTimes(refreshes);
});

it.each([true, false])("falls back when the console stops reconnecting (before the response: %s)", async (beforeResponse) => {
    await render();
    await emit({ type: "opened", serverId, connection: 1 });
    const response = await requestRestart();
    if (beforeResponse) await emit({ type: "unavailable", serverId });
    await act(async () => response.resolve(accepted));
    if (!beforeResponse) await emit({ type: "unavailable", serverId });
    expect(container.textContent).toContain("Restarting. Players can rejoin once the campaign finishes loading");
    expect(container.querySelector("ol")).toBeNull();
    expect(buttons()[2].disabled).toBe(false);
});

it("explains the wait without blocking when no live console is mounted", async () => {
    await render({}, false);
    const response = await requestRestart();
    await act(async () => response.resolve(accepted));
    expect(container.textContent).toContain("Restarting. Players can rejoin once the campaign finishes loading");
    expect(buttons()[2].disabled).toBe(false);
});

it("settles an unconfirmed request on the next settled server observation", async () => {
    operate.mockResolvedValue({ ok: false, checkStatus: true, message: "We couldn’t confirm that your Start request went through, so we’re checking your server’s status…" });
    await render({ operationState: "stopped", observedGameState: "stopped" });
    await act(async () => buttons()[0].click());
    expect(container.textContent).toContain("so we’re checking your server’s status");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(buttons().slice(0, 4).every(button => button.disabled)).toBe(true);
    await render({ operationState: "starting", observedGameState: "stopped", expectedUpdatedAt: "2026-10-02T16:00:01.000Z" });
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(container.textContent).toContain("so we’re checking your server’s status");
    await render({ operationState: "running", observedGameState: "running", expectedUpdatedAt: "2026-10-02T16:00:40.000Z" });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).toContain("Status checked. Current state: Running.");
    expect(buttons()[1].disabled).toBe(false);
    const refreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(router.refresh).toHaveBeenCalledTimes(refreshes);
    expect(operate).toHaveBeenCalledTimes(1);
});

it("reports the unchanged state once the short check window passes", async () => {
    operate.mockRejectedValue(new Error("lost response"));
    await render({ operationState: "stopped", observedGameState: "stopped" });
    await act(async () => buttons()[0].click());
    expect(container.textContent).toContain("We couldn’t confirm that your Start request went through");
    await act(async () => vi.advanceTimersByTimeAsync(19_999));
    expect(buttons()[0].disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).toContain("Status checked. Current state: Stopped.");
    expect(buttons()[0].disabled).toBe(false);
    expect(operate).toHaveBeenCalledTimes(1);
});

it("never moves restart progress backwards or past a final step", () => {
    const loading = advanceRestartProgress(acceptRestartProgress(beginRestartProgress(), 4), { type: "phase", serverId, connection: 5, phase: "loading" });
    expect(loading.stage).toBe("loading");
    expect(advanceRestartProgress(loading, { type: "closed", serverId, connection: 5, runEnded: true }).stage).toBe("loading");
    const ready = advanceRestartProgress(loading, { type: "phase", serverId, connection: 5, phase: "serving" });
    expect(ready.stage).toBe("ready");
    expect(advanceRestartProgress(ready, { type: "phase", serverId, connection: 6, phase: "fatal" })).toBe(ready);
    expect(acceptRestartProgress(ready, 9)).toBe(ready);
});

it("clears restart progress when the control plane reports the restarted run failed", async () => {
    await render();
    await emit({ type: "opened", serverId, connection: 1 });
    const response = await requestRestart();
    await act(async () => response.resolve(accepted));
    // A failed observation inside the short check window may be transient, so it does not settle yet.
    await render({ operationState: "failed", observedGameState: "failed", expectedUpdatedAt: "2026-10-02T16:00:05.000Z" });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).toContain("Restarting your server…");
    expect(buttons().slice(0, 4).map(button => button.disabled)).toEqual([false, false, true, true]);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).toContain("Status checked. Current state: Failed");
    expect(container.textContent).not.toContain("Restarting your server…");
    expect(container.textContent).not.toContain("Players can rejoin once the campaign finishes loading");
    expect(buttons()[0].disabled).toBe(false);
    expect(operate).toHaveBeenCalledOnce();
});

it("keeps following Restart through a newer running observation without locking lifecycle controls", async () => {
    await render();
    await emit({ type: "opened", serverId, connection: 1 });
    const response = await requestRestart();
    await act(async () => response.resolve(accepted));
    await render({ expectedUpdatedAt: "2026-10-02T16:00:05.000Z" });
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(container.textContent).toContain("Restarting your server…");
    expect(container.textContent).not.toContain("Your server is ready to join");
    expect(buttons().slice(0, 4).map(button => button.disabled)).toEqual([true, false, false, true]);
});

it("still blocks controls for transitional state or backup polling during restart progress", async () => {
    await render();
    const response = await requestRestart();
    await act(async () => response.resolve(accepted));
    await render({ operationState: "starting" });
    expect(buttons().slice(0, 4).every(button => button.disabled)).toBe(true);
    await render();
    expect(buttons()[1].disabled).toBe(false);
    await act(async () => polling.beginPolling(serverId, server.expectedUpdatedAt, "backup-job", "backup"));
    expect(buttons().slice(0, 4).every(button => button.disabled)).toBe(true);
});

it("can Stop after a successful restart even when console readiness never arrives", async () => {
    await render();
    const restartResponse = await requestRestart();
    await act(async () => restartResponse.resolve(accepted));
    const stopResponse = Promise.withResolvers<{ ok: boolean; checkStatus: boolean; message: string }>();
    operate.mockReturnValueOnce(stopResponse.promise);
    await act(async () => buttons()[1].click());
    expect(operate).toHaveBeenNthCalledWith(2, { serverId, action: "stop" });
    expect(buttons().slice(0, 4).every(button => button.disabled)).toBe(true);
    await act(async () => stopResponse.resolve({ ok: true, checkStatus: true, message: "Checking whether your server has stopped…" }));
    await emit({ type: "phase", serverId, connection: 2, phase: "serving" });
    expect(container.textContent).not.toContain("Your server is ready to join");
    await render({ operationState: "stopped", observedGameState: "stopped", expectedUpdatedAt: "2026-10-02T16:01:00.000Z" });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).toContain("Server stopped.");
    expect(buttons()[0].disabled).toBe(false);
});

it("keeps controls locked while checking an unconfirmed restart without resending it", async () => {
    await render();
    const response = await requestRestart();
    await act(async () => response.resolve({ ok: false, checkStatus: true, message: "Checking restart status" }));
    expect(buttons().slice(0, 4).every(button => button.disabled)).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(buttons()[2].disabled).toBe(false);
    expect(operate).toHaveBeenCalledOnce();
});
