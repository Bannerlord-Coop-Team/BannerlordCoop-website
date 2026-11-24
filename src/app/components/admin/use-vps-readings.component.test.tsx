import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostingAdminVpsInventory } from "@/app/lib/control-plane/types";
import { usePolling, type ReadingOutcome, type ReadingSpec } from "./use-vps-readings";

vi.mock("@/app/lib/control-plane/client", () => ({ requestControlPlaneAdmin: vi.fn() }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: vi.fn() }));

const read = vi.fn<(accessToken: string, signal: AbortSignal) => Promise<string>>();
const settle = vi.fn<(outcome: ReadingOutcome<string>) => void>();
const token = vi.fn<() => Promise<string | null>>();
const SPEC: ReadingSpec<string> = { interval: 1_000, timeout: { milliseconds: 500, message: "Timed out." }, read: (accessToken, signal) => read(accessToken, signal) };
const AWAITING = { liveDataIncluded: false } as HostingAdminVpsInventory;
const COMPLETE = { liveDataIncluded: true } as HostingAdminVpsInventory;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    token.mockResolvedValue("test-token");
    read.mockResolvedValue("reading");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

/** Calls the hook with the stub spec, settle and token lookup inside a bare component. */
function Probe({ initial }: { initial: HostingAdminVpsInventory }) {
    usePolling(initial, SPEC, settle, token);
    return null;
}

/** Renders the probe for one registered inventory. */
async function render(initial: HostingAdminVpsInventory) {
    await act(async () => root.render(<Probe initial={initial} />));
}

/** Advances the fake clock inside act. */
async function advance(milliseconds: number) {
    await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}

it("reads at once when the inventory awaits live data, then once per interval", async () => {
    await render(AWAITING);
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]![0]).toBe("test-token");
    expect(settle).toHaveBeenCalledWith({ ok: true, result: "reading" });
    await advance(1_000);
    expect(read).toHaveBeenCalledTimes(2);
});

it("waits one interval before the first read when the inventory is already complete", async () => {
    await render(COMPLETE);
    expect(read).not.toHaveBeenCalled();
    await advance(1_000);
    expect(read).toHaveBeenCalledOnce();
});

it("skips reads while the page is hidden and reads at once when it returns", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
        await render(AWAITING);
        await advance(5_000);
        expect(read).not.toHaveBeenCalled();
        visibility.mockReturnValue("visible");
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
        expect(read).toHaveBeenCalledOnce();
    } finally { visibility.mockRestore(); }
});

it("settles the spec's timeout message for a read that outlives its deadline, and requires a token", async () => {
    read.mockImplementation((_token, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    await render(AWAITING);
    await advance(500);
    expect(settle).toHaveBeenCalledWith({ ok: false, error: "Timed out." });
    token.mockResolvedValue(null);
    await advance(1_000);
    expect(settle).toHaveBeenLastCalledWith({ ok: false, error: "Authentication is required." });
});
