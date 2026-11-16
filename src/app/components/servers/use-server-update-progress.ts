"use client";

import { useEffect, useEffectEvent, useReducer } from "react";
import type { BuildUpdateJob, BuildStatus } from "../../../../supabase/functions/_shared/server-build-contract";

const ACTIVE_UPDATE_JOB_STATES: readonly BuildUpdateJob["state"][] = ["queued", "running", "retry-wait"];
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

/** One poll's decision: what the reducer shows and follows, and whether the effect refreshes and polls again. */
export type UpdatePollStep = {
    show: { kind: "job"; job: BuildUpdateJob } | { kind: "hidden" } | { kind: "unchanged" };
    error: UpdateProgressError | null;
    refresh: boolean;
    poll: "continue" | "stop";
    follow: UpdateFollow;
};

type UpdatePollInput = { status: BuildStatus | null; follow: UpdateFollow; now: number; deadline: number };

/**
 * Everything the hook shows and follows, kept together so a new follow target can never keep an older job on screen.
 * `generation` counts the follows this page started; each poll loop belongs to the generation it started in.
 */
export type UpdateProgressState = {
    follow: UpdateFollow;
    job: BuildUpdateJob | null;
    error: UpdateProgressError | null;
    generation: number;
};

/** A poll step from the loop started in `generation`, or a request to follow a job this page just started. */
export type UpdateProgressAction =
    | { type: "step"; generation: number; step: UpdatePollStep }
    | { type: "follow"; jobId: string };

/** The state before the first poll: nothing followed, shown or failed, in the first generation. */
export const INITIAL_UPDATE_PROGRESS_STATE: UpdateProgressState = { follow: { kind: "idle" }, job: null, error: null, generation: 0 };

/** Reads one server's update status; rejects or resolves null when the read fails. */
export type ReadBuildStatus = (serverId: string) => Promise<BuildStatus | null>;

/** Decides one poll's outcome, then pauses a poll that would continue once its window has passed, keeping what it shows. */
export function nextUpdatePollStep({ status, follow, now, deadline }: UpdatePollInput): UpdatePollStep {
    const step = decidePollStep(status, follow);
    if (step.poll === "continue" && now >= deadline) return { ...step, error: "paused", poll: "stop" };
    return step;
}

/** Decides one poll's outcome from the latest status read (null when the read failed) and the follow state alone. */
function decidePollStep(status: BuildStatus | null, follow: UpdateFollow): UpdatePollStep {
    const job = status?.job ?? null;
    if (job !== null && isActiveJob(job)) return followActiveStep(job);
    if (follow.kind !== "following") return settledOrIdleStep(job, follow);
    if (status === null) return waitStep(follow, "unavailable");
    // The followed job is not visible yet, or an older finished job is still the latest: keep waiting.
    if (job === null || job.jobId !== follow.jobId) return waitStep(follow, null);
    return settleFollowedStep(job);
}

/** Tells whether a job is still in flight: queued, running or waiting to retry. */
function isActiveJob(job: BuildUpdateJob): boolean {
    return ACTIVE_UPDATE_JOB_STATES.includes(job.state);
}

/** Shows and follows an in-progress job, the server's current update, and polls again. */
function followActiveStep(job: BuildUpdateJob): UpdatePollStep {
    return { show: { kind: "job", job }, error: null, refresh: false, poll: "continue", follow: { kind: "following", jobId: job.jobId } };
}

/**
 * Refreshes the page once because the followed update changed the server. The follow becomes settled, not idle, so the
 * poll the refresh restarts still shows this job and does not refresh again.
 */
function settleFollowedStep(job: BuildUpdateJob): UpdatePollStep {
    return { show: { kind: "job", job }, error: null, refresh: true, poll: "stop", follow: { kind: "settled", jobId: job.jobId } };
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

/** Every action except a poll step: a request from this page that changes what the hook follows. */
type UpdateProgressRequest = Exclude<UpdateProgressAction, { type: "step" }>;

/**
 * Applies a poll step, or applies a request in a new generation so the loop still running for the old follow state
 * becomes stale. No action other than a step can change what the loop follows without starting a new generation.
 */
export function updateProgressReducer(state: UpdateProgressState, action: UpdateProgressAction): UpdateProgressState {
    if (action.type === "step") return applyStep(state, action.generation, action.step);
    return { ...applyRequest(action), generation: state.generation + 1 };
}

/** Applies one poll step to what the hook shows and follows; a step from a loop of an earlier generation is ignored. */
function applyStep(state: UpdateProgressState, generation: number, step: UpdatePollStep): UpdateProgressState {
    if (generation !== state.generation) return state;
    return { ...state, follow: step.follow, job: shownJob(state.job, step.show), error: step.error };
}

/** Starts following the job this page just requested, with nothing shown or failed until it appears. */
function applyRequest(action: UpdateProgressRequest): Omit<UpdateProgressState, "generation"> {
    return { follow: { kind: "following", jobId: action.jobId }, job: null, error: null };
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
    const [state, dispatch] = useReducer(updateProgressReducer, INITIAL_UPDATE_PROGRESS_STATE);
    // Effect events: a caller passing a new reader or callback on each render does not restart the poll, and each
    // loop reads the generation and follow state once when it starts instead of restarting on every step.
    const readLatest = useEffectEvent((id: string) => readStatus(id));
    const endFollowed = useEffectEvent(() => onFollowedUpdateEnded());
    const stateAtStart = useEffectEvent(() => state);

    // The poll stops when no update is in flight, so a new server revision (each page refresh brings one) is what
    // wakes it to pick up an update started elsewhere, by the schedule or by hosting support.
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let timeout: ReturnType<typeof setTimeout>;
        const deadline = Date.now() + POLL_WINDOW_MILLISECONDS;
        // Only this loop's own steps change the follow state while it runs: the reducer applies every other action in a
        // new generation, which restarts the loop and drops any step still tagged with this loop's older generation.
        const start = stateAtStart();
        const generation = start.generation;
        let follow = start.follow;
        // Reads the status once and applies the decided step to state, the callback and the timer.
        async function poll() {
            let status: BuildStatus | null;
            // A rejected read, such as a server action lost to the network, counts as a failed read.
            try { status = await readLatest(serverId); }
            catch { status = null; }
            if (cancelled) return;
            const step = nextUpdatePollStep({ status, follow, now: Date.now(), deadline });
            dispatch({ type: "step", generation, step });
            follow = step.follow;
            if (step.refresh) endFollowed();
            if (step.poll === "continue") timeout = setTimeout(poll, POLL_MILLISECONDS);
        }
        void poll();
        return () => { cancelled = true; clearTimeout(timeout); };
    }, [serverId, enabled, revision, state.generation]);

    /** Starts following the update this page just requested, clearing the last job and error until it appears. */
    function followJob(jobId: string) {
        dispatch({ type: "follow", jobId });
    }

    const { job, error } = state;
    const busy = job !== null && isActiveJob(job);
    // The one rule for whether the Console has update progress or an error to show.
    const hasStatus = job !== null || error !== null;
    return { job, error, busy, hasStatus, followJob };
}
