import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagedServerControls } from "./ManagedServerControls";
import { ManagedServerPollingProvider } from "./ManagedServerPollingProvider";
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

it("requires a newer stopped observation and offers a read-only status check after the bounded wait", async () => {
    operate.mockResolvedValue({ ok: false, checkStatus: true, message: "Checking whether your server has stopped…" });
    await render(); await act(async () => buttons()[1].click());
    await render({ operationState: "stopped", observedGameState: "stopped" });
    expect(container.textContent).not.toContain("Server stopped.");
    await render({ operationState: "stopped", expectedUpdatedAt: "2026-10-02T16:00:01.000Z" });
    expect(container.textContent).not.toContain("Server stopped.");
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(container.textContent).toContain("Stop is taking longer than expected");
    expect(buttons().slice(0, 4).every(button => button.disabled)).toBe(true);
    const refreshes = router.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(12_000));
    expect(router.refresh).toHaveBeenCalledTimes(refreshes);
    await act(async () => buttons().find(button => button.textContent === "Check status again")!.click());
    expect(router.refresh).toHaveBeenCalledTimes(refreshes + 1);
    expect(container.textContent).not.toContain("Stop is taking longer than expected");
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
