import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BuildUpdateJob } from "../../../../supabase/functions/_shared/server-build-contract";
import { useServerUpdateProgress, type ReadBuildStatus } from "./use-server-update-progress";
import { updateJob } from "./ServerUpdateProgress.test-utils";

const serverId = "22222222-2222-4222-8222-222222222222";
const jobId = "55555555-5555-4555-8555-555555555555";
const readStatus = vi.fn<ReadBuildStatus>();
const onFollowedUpdateEnded = vi.fn<() => void>();
let root: Root;

/** Builds the server's latest update job in the given state. */
function job(state: BuildUpdateJob["state"]): BuildUpdateJob {
    return updateJob({ jobId, state, phase: state === "running" ? "installing" : "done" });
}

/** Renders the hook at one server revision inside a bare component and exposes its latest result. */
async function renderHook(revision: string) {
    const result: { current: ReturnType<typeof useServerUpdateProgress> | null } = { current: null };
    // Calls the hook with the injected reader and callback, recording what it returns.
    function Probe() {
        result.current = useServerUpdateProgress(serverId, true, revision, readStatus, onFollowedUpdateEnded);
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

it("calls onFollowedUpdateEnded exactly once when the job it follows by id ends", async () => {
    const { result } = await renderHook("2026-09-20T12:00:00.000Z");
    readStatus.mockResolvedValueOnce({ serverId, job: null }).mockResolvedValueOnce({ serverId, job: job("running") })
        .mockResolvedValue({ serverId, job: job("succeeded") });
    await act(async () => result.current!.followJob(jobId));
    expect(result.current!.job).toBeNull();
    await advance(3_000);
    expect(result.current!.busy).toBe(true);
    expect(onFollowedUpdateEnded).not.toHaveBeenCalled();
    await advance(3_000);
    expect(result.current!.job?.state).toBe("succeeded");
    expect(result.current!.busy).toBe(false);
    expect(onFollowedUpdateEnded).toHaveBeenCalledOnce();
    await advance(30_000);
    expect(onFollowedUpdateEnded).toHaveBeenCalledOnce();
});

it("does not read again when a caller passes a new inline reader on each render", async () => {
    /** Calls the hook with a fresh reader closure on every render, as an inline caller would. */
    function InlineReaderProbe() {
        useServerUpdateProgress(serverId, true, "2026-09-20T12:00:00.000Z", id => readStatus(id), onFollowedUpdateEnded);
        return null;
    }
    for (let render = 0; render < 3; render += 1) await act(async () => root.render(<InlineReaderProbe />));
    await advance(30_000);
    expect(readStatus).toHaveBeenCalledOnce();
});

it("stops polling when the step says stop: a finished job it never followed", async () => {
    readStatus.mockResolvedValue({ serverId, job: job("failed") });
    const { result } = await renderHook("2026-09-20T12:00:00.000Z");
    await advance(30_000);
    expect(readStatus).toHaveBeenCalledOnce();
    expect(result.current!.job).toBeNull();
    expect(onFollowedUpdateEnded).not.toHaveBeenCalled();
});

it("stops polling and reports paused once the poll window passes", async () => {
    readStatus.mockResolvedValue({ serverId, job: job("running") });
    const { result } = await renderHook("2026-09-20T12:00:00.000Z");
    await advance(15 * 60_000);
    expect(result.current!.error).toBe("paused");
    const reads = readStatus.mock.calls.length;
    await advance(60_000);
    expect(readStatus).toHaveBeenCalledTimes(reads);
    expect(result.current!.job?.state).toBe("running");
});

it("reports progress as unavailable when the injected read fails while following", async () => {
    const { result } = await renderHook("2026-09-20T12:00:00.000Z");
    readStatus.mockRejectedValue(new Error("network"));
    await act(async () => result.current!.followJob(jobId));
    expect(result.current!.error).toBe("unavailable");
    expect(result.current!.job).toBeNull();
    expect(onFollowedUpdateEnded).not.toHaveBeenCalled();
});
