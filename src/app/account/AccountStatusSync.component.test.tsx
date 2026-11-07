import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
import { AccountStatusSync } from "./AccountStatusSync";

it("refreshes pending state quickly then backs off while remaining automatic and cleans up", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    mocks.router.refresh.mockClear();
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(<AccountStatusSync pending />));
        for (let i = 0; i < 30; i++) await act(async () => vi.advanceTimersByTime(2_000));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(30);
        await act(async () => vi.advanceTimersByTime(9_999));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(30);
        await act(async () => vi.advanceTimersByTime(1));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(31);
        for (let i = 0; i < 2; i++) await act(async () => vi.advanceTimersByTime(10_000));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(33);
        expect(container.querySelector("button")).toBeNull();
    } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(mocks.router.refresh).toHaveBeenCalledTimes(33);
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

it("stops the timer when pending status settles and keeps event refreshes available", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    mocks.router.refresh.mockClear();
    const root = createRoot(document.createElement("div"));
    try {
        await act(async () => root.render(<AccountStatusSync pending />));
        await act(async () => vi.advanceTimersByTime(2_000));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
        await act(async () => root.render(<AccountStatusSync pending={false} />));
        expect(vi.getTimerCount()).toBe(0);
        await act(async () => vi.advanceTimersByTime(60_000));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
        await act(async () => window.dispatchEvent(new Event("focus")));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
    } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});

it("skips hidden tabs without spending attempts and coalesces simultaneous refresh triggers", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    mocks.router.refresh.mockClear();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const root = createRoot(document.createElement("div"));
    try {
        await act(async () => root.render(<AccountStatusSync pending />));
        for (let i = 0; i < 35; i++) await act(async () => vi.advanceTimersByTime(2_000));
        await act(async () => window.dispatchEvent(new Event("online")));
        expect(mocks.router.refresh).not.toHaveBeenCalled();
        visibility.mockReturnValue("visible");
        await act(async () => {
            document.dispatchEvent(new Event("visibilitychange"));
            window.dispatchEvent(new Event("focus"));
            window.dispatchEvent(new Event("online"));
        });
        expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
        for (let i = 0; i < 30; i++) await act(async () => vi.advanceTimersByTime(2_000));
        expect(mocks.router.refresh).toHaveBeenCalledTimes(31);
    } finally { await act(async () => root.unmount()); visibility.mockRestore(); vi.useRealTimers(); }
});
