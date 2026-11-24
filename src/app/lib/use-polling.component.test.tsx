import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePolling, type ReadingOutcome, type ReadingSpec } from "./use-polling";

vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: vi.fn() }));

const read = vi.fn<(accessToken: string, signal: AbortSignal) => Promise<string>>();
const settle = vi.fn<(outcome: ReadingOutcome<string>) => void>();
const signedOut = vi.fn<() => Promise<string | null>>();
const SPEC: ReadingSpec<string> = { interval: 1_000, read: (accessToken, signal) => read(accessToken, signal) };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    signedOut.mockResolvedValue(null);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

/** Calls the hook with the stub spec, settle and a signed-out token lookup inside a bare component. */
function Probe() {
    usePolling(SPEC, settle, { readImmediately: true, restartKey: "inventory" }, signedOut);
    return null;
}

it("settles an authentication error without reading when the token lookup finds no session", async () => {
    await act(async () => root.render(<Probe />));
    expect(settle).toHaveBeenCalledWith({ ok: false, error: "Authentication is required." });
    expect(read).not.toHaveBeenCalled();
});
