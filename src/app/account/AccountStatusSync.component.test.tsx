import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
import { AccountStatusSync } from "./AccountStatusSync";

it("refreshes pending state automatically with bounded retries and cleans up", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    mocks.router.refresh.mockClear();
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<AccountStatusSync pending />));
        for (let i = 0; i < 15; i++) await act(async () => vi.advanceTimersByTime(5_000));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(12);
        expect(container.querySelector("button")).toBeNull();
        await act(async () => root.unmount());
        await act(async () => window.dispatchEvent(new Event("focus")));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(12);
    } finally { vi.useRealTimers(); }
});
it("refreshes on return to the page without polling settled state", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    mocks.router.refresh.mockClear();
    const root = createRoot(document.createElement("div"));
    try {
        await act(async () => root.render(<AccountStatusSync pending={false} />));
        await act(async () => vi.advanceTimersByTime(60_000));
        expect(mocks.router.refresh).not.toHaveBeenCalled();
        await act(async () => window.dispatchEvent(new Event("focus")));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
        await act(async () => window.dispatchEvent(new Event("online")));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
    } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});
