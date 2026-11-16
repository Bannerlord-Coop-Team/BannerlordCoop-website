import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BuildUpdateJob } from "../../../../supabase/functions/_shared/server-build-contract";
import { useServerUpdateProgress, type ReadBuildStatus } from "./use-server-update-progress";

const serverId = "22222222-2222-4222-8222-222222222222";
const jobId = "55555555-5555-4555-8555-555555555555";
const readStatus = vi.fn<ReadBuildStatus>();
const onFollowedUpdateEnded = vi.fn<() => void>();
let root: Root;

// Builds the server's latest update job in the given state.
function job(state: BuildUpdateJob["state"]): BuildUpdateJob {
    return {
        jobId, state, initiatedBy: "owner", ownerSelected: false, phase: state === "running" ? "installing" : "done",
        steps: [], completedSteps: 3, totalSteps: 6, targetVersion: "0.1.11", previousVersion: "0.1.10", progress: "Installing the update",
        backup: null, rolledBack: false, failureCode: null, failureMessage: null, nextStep: null, attemptCount: 1, maximumAttempts: 3,
        nextRetryAt: null, createdAt: "2026-09-20T12:00:00.000Z", updatedAt: "2026-09-20T12:01:00.000Z", completedAt: null,
    };
}

/** Renders the hook at one server revision inside a bare component and exposes its latest result and a rerender. */
async function renderHook(revision: string) {
    const result: { current: ReturnType<typeof useServerUpdateProgress> | null } = { current: null };
    // Calls the hook with the injected reader and callback, recording what it returns.
    function Probe({ at }: { at: string }) {
        result.current = useServerUpdateProgress(serverId, true, at, readStatus, onFollowedUpdateEnded);
        return null;
    }
    await act(async () => root.render(<Probe at={revision} />));
    return { result, rerender: (next: string) => act(async () => root.render(<Probe at={next} />)) };
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

it("restarts the poll when the revision changes", async () => {
    const { result, rerender } = await renderHook("2026-09-20T12:00:00.000Z");
    expect(readStatus).toHaveBeenCalledOnce();
    readStatus.mockResolvedValue({ serverId, job: job("running") });
    await rerender("2026-09-20T12:01:00.000Z");
    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(result.current!.job?.state).toBe("running");
    expect(result.current!.busy).toBe(true);
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
