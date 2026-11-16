"use client";

import { useEffect, useRef, useState } from "react";
import type { BuildUpdateJob, BuildStatus } from "../../../../supabase/functions/_shared/server-build-contract";

const ACTIVE_STATES: readonly BuildUpdateJob["state"][] = ["queued", "running", "retry-wait"];
const POLL_MILLISECONDS = 3_000;
const POLL_WINDOW_MILLISECONDS = 15 * 60_000;

/**
 * What this page knows about the update it shows: nothing yet, an update it is following,
 * or a followed update that ended and has already refreshed the page once.
 */
export type UpdateFollow =
    | { kind: "idle" }
    | { kind: "following"; jobId: string }
    | { kind: "settled"; jobId: string };

/** Why update progress cannot be shown right now: the read failed, or the poll window passed. */
export type UpdateProgressError = "unavailable" | "paused";

/** The effect applies this result as-is: the job to show, the error to show, and what to do next. */
export type UpdatePollStep = {
    show: { kind: "job"; job: BuildUpdateJob } | { kind: "hidden" } | { kind: "unchanged" };
    error: UpdateProgressError | null;
    refresh: boolean;
    poll: "continue" | "stop";
    follow: UpdateFollow;
};

type UpdatePollInput = { status: BuildStatus | null; follow: UpdateFollow; now: number; deadline: number };

/** Reads one server's update status; resolves null when the read fails. */
export type ReadBuildStatus = (serverId: string) => Promise<BuildStatus | null>;

/** Decides one poll's outcome from the latest status read (null when the read failed) and the follow state. */
export function nextUpdatePollStep({ status, follow, now, deadline }: UpdatePollInput): UpdatePollStep {
    const job = status?.job ?? null;
    if (job !== null && ACTIVE_STATES.includes(job.state)) {
        return withinDeadline({
            show: { kind: "job", job },
            error: null,
            refresh: false,
            poll: "continue",
            follow: { kind: "following", jobId: job.jobId },
        }, now, deadline);
    }
    if (follow.kind !== "following") return settledOrIdleStep(job, follow);
    if (status === null) return withinDeadline(waitStep(follow, "unavailable"), now, deadline);
    // The followed job is not visible yet, or an older finished job is still the latest: keep waiting.
    if (job === null || job.jobId !== follow.jobId) return withinDeadline(waitStep(follow, null), now, deadline);
    // The followed update changed the server, so the page refreshes once; settling keeps the job on screen
    // and stops the poll that the refreshed revision starts from refreshing again.
    return {
        show: { kind: "job", job },
        error: null,
        refresh: true,
        poll: "stop",
        follow: { kind: "settled", jobId: job.jobId },
    };
}

/** Keeps the shown job and polls again, still following the same update, reporting the given error. */
function waitStep(follow: UpdateFollow, error: UpdateProgressError | null): UpdatePollStep {
    return { show: { kind: "unchanged" }, error, refresh: false, poll: "continue", follow };
}

/** Handles a read while nothing is being followed: only the settled job stays visible; other finished jobs are hidden. */
function settledOrIdleStep(job: BuildUpdateJob | null, follow: UpdateFollow): UpdatePollStep {
    if (job === null) return { show: { kind: "unchanged" }, error: null, refresh: false, poll: "stop", follow };
    if (follow.kind === "settled" && job.jobId === follow.jobId) return { show: { kind: "job", job }, error: null, refresh: false, poll: "stop", follow };
    return { show: { kind: "hidden" }, error: null, refresh: false, poll: "stop", follow: { kind: "idle" } };
}

/** Pauses a continuing poll once its window has passed, keeping whatever it shows. */
function withinDeadline(step: UpdatePollStep, now: number, deadline: number): UpdatePollStep {
    if (now < deadline) return step;
    return { ...step, error: "paused", poll: "stop" };
}

/** Reads the status through the injected reader, treating a thrown read as a failed one. */
async function readOrNull(readStatus: ReadBuildStatus, serverId: string): Promise<BuildStatus | null> {
    try { return await readStatus(serverId); }
    catch { return null; }
}

/**
 * Follows the server's update job for the Console: reattaches after a reload and calls onFollowedUpdateEnded once
 * when a followed update ends. Each new revision restarts the poll so an update started elsewhere is picked up.
 */
export function useServerUpdateProgress(
    serverId: string,
    enabled: boolean,
    revision: string,
    readStatus: ReadBuildStatus,
    onFollowedUpdateEnded: () => void,
) {
    const [job, setJob] = useState<BuildUpdateJob | null>(null);
    const [error, setError] = useState<UpdateProgressError | null>(null);
    const [pollRun, setPollRun] = useState(0);
    // A ref, not state: the poll loop reads and advances it between reads without restarting itself.
    const followState = useRef<UpdateFollow>({ kind: "idle" });
    // Refs, so a caller passing a new reader or callback on each render does not restart the poll.
    const reader = useRef(readStatus);
    const followedUpdateEnded = useRef(onFollowedUpdateEnded);
    useEffect(() => { reader.current = readStatus; }, [readStatus]);
    useEffect(() => { followedUpdateEnded.current = onFollowedUpdateEnded; }, [onFollowedUpdateEnded]);

    // The poll stops when no update is in flight, so a new server revision (each page refresh brings one) is what
    // wakes it to pick up an update started elsewhere, by the schedule or by hosting support.
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let timeout: ReturnType<typeof setTimeout>;
        const deadline = Date.now() + POLL_WINDOW_MILLISECONDS;
        // Reads the status once and applies the decided step to state, the callback and the timer.
        async function poll() {
            const status = await readOrNull(reader.current, serverId);
            if (cancelled) return;
            const step = nextUpdatePollStep({ status, follow: followState.current, now: Date.now(), deadline });
            followState.current = step.follow;
            if (step.show.kind === "job") setJob(step.show.job);
            if (step.show.kind === "hidden") setJob(null);
            setError(step.error);
            if (step.refresh) followedUpdateEnded.current();
            if (step.poll === "continue") timeout = setTimeout(poll, POLL_MILLISECONDS);
        }
        void poll();
        return () => { cancelled = true; clearTimeout(timeout); };
    }, [serverId, enabled, revision, pollRun]);

    /** Starts following the update this page just requested, so its result stays visible when it ends. */
    function followJob(jobId: string) {
        followState.current = { kind: "following", jobId };
        setError(null);
        setPollRun(value => value + 1);
    }

    const busy = job !== null && ACTIVE_STATES.includes(job.state);
    return { job, error, busy, followJob };
}
