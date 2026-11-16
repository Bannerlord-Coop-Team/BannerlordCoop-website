import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useServerUpdateProgress, type ReadBuildStatus } from "./use-server-update-progress";
import { updateJobInState } from "./ServerUpdateProgress.test-utils";

const serverId = "22222222-2222-4222-8222-222222222222";
const jobId = "55555555-5555-4555-8555-555555555555";
const revision = "2026-09-20T12:00:00.000Z";
const readStatus = vi.fn<ReadBuildStatus>();
const onFollowedUpdateEnded = vi.fn<() => void>();
let root: Root;

/** Renders the hook at the fixed server revision inside a bare component and exposes its latest result. */
async function renderHook(enabled = true) {
    const result: { current: ReturnType<typeof useServerUpdateProgress> | null } = { current: null };
    // Calls the hook with the injected reader and callback, recording what it returns.
    function Probe() {
        result.current = useServerUpdateProgress(serverId, enabled, revision, readStatus, onFollowedUpdateEnded);
        return null;
    }
    await act(async () => root.render(<Probe />));
    return { result };
}

/** Advances the fake clock inside act so the poll's reads and state updates settle. */
async function advance(milliseconds: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    readStatus.mockReset().mockResolvedValue({ serverId, job: null });
    onFollowedUpdateEnded.mockReset();
    root = createRoot(document.createElement("div"));
});
afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
});

it("does not read again when a caller passes a new inline reader on each render", async () => {
    /** Calls the hook with a fresh reader closure on every render, as an inline caller would. */
    function InlineReaderProbe() {
        useServerUpdateProgress(serverId, true, revision, id => readStatus(id), onFollowedUpdateEnded);
        return null;
    }
    for (let render = 0; render < 3; render += 1) await act(async () => root.render(<InlineReaderProbe />));
    await advance(30_000);
    expect(readStatus).toHaveBeenCalledOnce();
});

it("never reads the status while disabled", async () => {
    await renderHook(false);
    await advance(30_000);
    expect(readStatus).not.toHaveBeenCalled();
});

it("stops polling when the step says stop: a finished job it never followed", async () => {
    readStatus.mockResolvedValue({ serverId, job: updateJobInState("failed") });
    const { result } = await renderHook();
    await advance(30_000);
    expect(readStatus).toHaveBeenCalledOnce();
    expect(result.current!.job).toBeNull();
    expect(onFollowedUpdateEnded).not.toHaveBeenCalled();
});

it("stops polling and reports paused once the poll window passes", async () => {
    readStatus.mockResolvedValue({ serverId, job: updateJobInState("running") });
    const { result } = await renderHook();
    await advance(15 * 60_000);
    expect(result.current!.error).toBe("paused");
    const reads = readStatus.mock.calls.length;
    await advance(60_000);
    expect(readStatus).toHaveBeenCalledTimes(reads);
    expect(result.current!.job?.state).toBe("running");
});

it("reports progress as unavailable when the injected read fails while following", async () => {
    const { result } = await renderHook();
    readStatus.mockRejectedValue(new Error("network"));
    await act(async () => result.current!.followJob(jobId));
    expect(result.current!.error).toBe("unavailable");
    expect(result.current!.job).toBeNull();
    expect(onFollowedUpdateEnded).not.toHaveBeenCalled();
});
