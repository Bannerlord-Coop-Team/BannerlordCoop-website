import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerControls } from "./ManagedServerControls";
import { ManagedServerPollingProvider, managedServerPollDelay, useManagedServerPolling } from "./ManagedServerPollingProvider";
import { TestLocalization } from "./ManagedServerLocalization.test-utils";

const { operate, router } = vi.hoisted(() => ({ operate: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/servers/managed-server-actions", () => ({
    operateManagedServer: operate, readManagedServerStartStatus: vi.fn(), setManagedServerPassword: vi.fn(),
}));

const server = { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Campaign",
    accessRole: "owner" as const, operationState: "running", observedGameState: "running",
    expectedUpdatedAt: "2026-10-02T16:00:00.000Z" };
let container: HTMLDivElement;
let root: Root;
const buttons = () => [...container.querySelectorAll("button")];
const render = (overrides: Partial<typeof server> = {}) => act(async () => root.render(
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
async function renderWithProbe() {
    await act(async () => root.render(
        <TestLocalization><ManagedServerPollingProvider><PollingProbe /><ManagedServerControls {...server} /></ManagedServerPollingProvider></TestLocalization>,
    ));
}

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
