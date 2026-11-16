import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { isTerminalManagedServerOperationState, managedServerEffectivePollDelay, ManagedServerPollingProvider } from "./ManagedServerPollingProvider";

describe("managed server polling policy", () => {
    it("keeps the base interval at or above fifteen seconds and backs off", () => {
        expect(managedServerEffectivePollDelay(0)).toBe(15_000);
        expect(managedServerEffectivePollDelay(0, 1)).toBe(30_000);
        expect(managedServerEffectivePollDelay(10 * 60_000)).toBe(15_000);
    });

    it("recognizes terminal server states", () => {
        expect(isTerminalManagedServerOperationState("stopped")).toBe(true);
        expect(isTerminalManagedServerOperationState("deleted")).toBe(true);
        expect(isTerminalManagedServerOperationState("starting")).toBe(false);
        expect(isTerminalManagedServerOperationState(null)).toBe(false);
    });
});

describe.skip("mounted polling provider", () => {
    beforeEach(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ""; });
    function mount(readStatus: (id: string) => Promise<{ ok: true; fingerprint: string } | { ok: false; retryable?: boolean }>) {
        vi.useFakeTimers();
        const host = document.createElement("div"); document.body.append(host);
        const root = createRoot(host);
        act(() => root.render(<ManagedServerPollingProvider readStatus={readStatus} initialServer={{ serverId: "s", updatedAt: "u", operationState: "starting" }}><span /></ManagedServerPollingProvider>));
        return root;
    }
    it("does not read while hidden", async () => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        const read = vi.fn(async () => ({ ok: true as const, fingerprint: "[\"u\",\"starting\"]" }));
        const root = mount(read); await act(async () => vi.advanceTimersByTimeAsync(30_000));
        expect(read).not.toHaveBeenCalled(); root.unmount();
    });
    it("stops after a 404/non-retryable read", async () => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        const read = vi.fn(async () => ({ ok: false as const }));
        const root = mount(read); await act(async () => vi.advanceTimersByTimeAsync(1_500));
        await act(async () => vi.advanceTimersByTimeAsync(60_000)); const count = read.mock.calls.length; await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(read.mock.calls.length).toBeLessThanOrEqual(count + 1); root.unmount();
    });
    it("stops on a terminal fingerprint", async () => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        const read = vi.fn(async () => ({ ok: true as const, fingerprint: "[\"u\",\"stopped\"]" }));
        const root = mount(read); await act(async () => vi.advanceTimersByTimeAsync(1_500));
        await act(async () => vi.advanceTimersByTimeAsync(60_000)); const count = read.mock.calls.length; await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(read.mock.calls.length).toBe(count); root.unmount();
    });
    it("backs off retryable 5xx reads", async () => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        const read = vi.fn(async () => ({ ok: false as const, retryable: true }));
        const root = mount(read); await act(async () => vi.advanceTimersByTimeAsync(1_500));
        const first = read.mock.calls.length; await act(async () => vi.advanceTimersByTimeAsync(30_000));
        expect(read.mock.calls.length).toBeGreaterThan(first); root.unmount();
    });
});
