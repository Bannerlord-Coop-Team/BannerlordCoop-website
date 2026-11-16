"use client";

import { useEffect, useEffectEvent, useReducer, useState } from "react";
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

/** Everything the hook shows and follows, kept together so a new follow target can never keep an older job on screen. */
export type UpdateProgressState = { follow: UpdateFollow; job: BuildUpdateJob | null; error: UpdateProgressError | null };

/** A poll step decided from the follow state `from`, or a request to follow a job this page just started. */
export type UpdateProgressAction =
    | { type: "step"; from: UpdateFollow; step: UpdatePollStep }
    | { type: "follow"; jobId: string };

const INITIAL_STATE: UpdateProgressState = { follow: { kind: "idle" }, job: null, error: null };

/** Reads one server's update status; rejects or resolves null when the read fails. */
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

/** Ends the poll without an error or a refresh, showing and following what it is given. */
function stopStep(show: UpdatePollStep["show"], follow: UpdateFollow): UpdatePollStep {
    return { show, error: null, refresh: false, poll: "stop", follow };
}

/** Handles a read while nothing is being followed: only the settled job stays visible; other finished jobs are hidden. */
function settledOrIdleStep(job: BuildUpdateJob | null, follow: UpdateFollow): UpdatePollStep {
    if (job === null) return stopStep({ kind: "unchanged" }, follow);
    if (follow.kind === "settled" && job.jobId === follow.jobId) return stopStep({ kind: "job", job }, follow);
    return stopStep({ kind: "hidden" }, { kind: "idle" });
}

/** Pauses a continuing poll once its window has passed, keeping whatever it shows. */
function withinDeadline(step: UpdatePollStep, now: number, deadline: number): UpdatePollStep {
    if (now < deadline) return step;
    return { ...step, error: "paused", poll: "stop" };
}

/**
 * Applies one poll step to what the hook shows, or starts following a requested job with nothing shown yet.
 * A step decided from a follow state that has since been replaced is stale and ignored.
 */
export function updateProgressReducer(state: UpdateProgressState, action: UpdateProgressAction): UpdateProgressState {
    if (action.type === "follow") return { follow: { kind: "following", jobId: action.jobId }, job: null, error: null };
    if (action.from !== state.follow) return state;
    return { follow: action.step.follow, job: shownJob(state.job, action.step.show), error: action.step.error };
}

/** Picks the job to show after a step: the step's job, none, or the one already shown. */
function shownJob(current: BuildUpdateJob | null, show: UpdatePollStep["show"]): BuildUpdateJob | null {
    if (show.kind === "job") return show.job;
    if (show.kind === "hidden") return null;
    return current;
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
    const [state, dispatch] = useReducer(updateProgressReducer, INITIAL_STATE);
    const [pollRun, setPollRun] = useState(0);
    // Effect events, so a caller passing a new reader or callback on each render does not restart the poll.
    const readLatest = useEffectEvent((id: string) => readStatus(id));
    const endFollowed = useEffectEvent(() => onFollowedUpdateEnded());
    const followAtStart = useEffectEvent(() => state.follow);

    // The poll stops when no update is in flight, so a new server revision (each page refresh brings one) is what
    // wakes it to pick up an update started elsewhere, by the schedule or by hosting support.
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let timeout: ReturnType<typeof setTimeout>;
        const deadline = Date.now() + POLL_WINDOW_MILLISECONDS;
        // Only this loop's own steps change the follow state while it runs; followJob restarts the loop.
        let follow = followAtStart();
        // Reads the status once and applies the decided step to state, the callback and the timer.
        async function poll() {
            let status: BuildStatus | null;
            // A rejected read, such as a server action lost to the network, counts as a failed read.
            try { status = await readLatest(serverId); }
            catch { status = null; }
            if (cancelled) return;
            const step = nextUpdatePollStep({ status, follow, now: Date.now(), deadline });
            dispatch({ type: "step", from: follow, step });
            follow = step.follow;
            if (step.refresh) endFollowed();
            if (step.poll === "continue") timeout = setTimeout(poll, POLL_MILLISECONDS);
        }
        void poll();
        return () => { cancelled = true; clearTimeout(timeout); };
    }, [serverId, enabled, revision, pollRun]);

    /** Starts following the update this page just requested, clearing the last job and error until it appears. */
    function followJob(jobId: string) {
        dispatch({ type: "follow", jobId });
        setPollRun(value => value + 1);
    }

    const { job, error } = state;
    const busy = job !== null && ACTIVE_STATES.includes(job.state);
    return { job, error, busy, followJob };
}
