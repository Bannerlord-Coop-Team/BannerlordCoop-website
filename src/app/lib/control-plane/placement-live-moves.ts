import type {
    HostingAdminPlacementExecutor,
    HostingPlacementBackoff,
    HostingPlacementMoveStep,
    HostingPlacementRelocation,
    HostingPlacementRelocationProgress,
    HostingPlacementRelocationWarning,
} from "./types";

/** While a move is announced or queued the panel re-reads the executor this often. */
export const PLACEMENT_LIVE_POLL_MILLISECONDS = 15_000;

/** A relocation job's steps in the order it runs them. */
export const PLACEMENT_MOVE_STEPS: readonly HostingPlacementMoveStep[] = [
    "preparing", "saving-and-stopping", "backing-up", "restoring", "switching-address", "starting-game", "finishing",
];

const STEP_LABELS: Record<HostingPlacementMoveStep, string> = {
    preparing: "Starting",
    "saving-and-stopping": "Saving & stopping",
    "backing-up": "Restore point",
    restoring: "Restoring",
    "switching-address": "Switching address",
    "starting-game": "Starting game",
    finishing: "Finishing",
};

const WARNING_MINUTES = [60, 10] as const;

/** Why the executor or its job settled a move, for the codes it sets itself. Other job codes show as they are. */
const ERROR_LABELS: Record<string, string> = {
    placement_disabled: "Cancelled because automatic placement was switched off.",
    placement_window_missed: "Cancelled because the move could not start within its announced window.",
    server_not_found: "Cancelled because the server no longer exists.",
    placement_job_missing: "Its relocation job could not be found.",
    placement_job_cancelled: "Cancelled by an administrator.",
};

export type PlacementTrackPhase = "done" | "current" | "waiting" | "not-needed" | "failed" | "cancelled";

/**
 * Where a move stands. A queued move can be putting its server back after a failure, or have a job that
 * already failed or was cancelled while the executor has not yet recorded the outcome.
 */
export type PlacementMoveStanding = "announced" | "moving" | "returning" | "job-failed" | "job-cancelled" | "job-succeeded" | "settled";

/** One stop on a move's track, from its in-game warnings to the end. */
export type PlacementTrackStep = {
    id: "warned" | HostingPlacementMoveStep | "returning" | "done";
    label: string;
    phase: PlacementTrackPhase;
    /** When the move first reached it; null when it did not or has no single time. */
    reachedAt: string | null;
    /** What the step means here, such as why no warning was needed. */
    note: string | null;
    /** The warned step's 60- and 10-minute warnings. */
    warnings: Array<{ minutes: 60 | 10; label: string; sentAt: string | null }>;
};

export function isActivePlacementRelocation(relocation: Pick<HostingPlacementRelocation, "state">) {
    return relocation.state === "announced" || relocation.state === "queued";
}

/** Where a move stands, from its state and, while it is queued, its job. */
export function placementMoveStanding(relocation: Pick<HostingPlacementRelocation, "state">, progress: HostingPlacementRelocationProgress | null): PlacementMoveStanding {
    if (relocation.state === "announced") return "announced";
    if (relocation.state !== "queued") return "settled";
    if (progress?.returning === true) return "returning";
    if (progress?.jobState === "failed") return "job-failed";
    if (progress?.jobState === "cancelled") return "job-cancelled";
    if (progress?.jobState === "succeeded") return "job-succeeded";
    return "moving";
}

/** What a queued move whose job ended, or that is putting its server back, is waiting for. */
const STANDING_NOTES: Partial<Record<PlacementMoveStanding, string>> = {
    returning: "Putting the server back on its original VPS",
    "job-failed": "The job failed; the executor records the outcome on its next run",
    "job-cancelled": "The job was cancelled; the executor records the outcome on its next run",
    "job-succeeded": "The job finished; the executor records the move on its next run",
};

export function placementMoveStandingNote(standing: PlacementMoveStanding) {
    return STANDING_NOTES[standing] ?? null;
}

/** Moves under way first, then finished ones, each in the control plane's newest-first order. */
export function orderPlacementRelocations<T extends Pick<HostingPlacementRelocation, "state">>(relocations: readonly T[]) {
    return [...relocations.filter(isActivePlacementRelocation), ...relocations.filter((relocation) => !isActivePlacementRelocation(relocation))];
}

/** "vps-1a2b3c4d" for "vps-1a2b3c4d.vps.ovh.net"; other names are kept. */
export function shortServiceName(serviceName: string) {
    return serviceName.replace(/\.vps\.ovh\.net$/u, "");
}

/** The move's live progress, or null for an older control plane that sends none (or an unusable one). */
export function placementRelocationProgress(relocation: HostingPlacementRelocation): HostingPlacementRelocationProgress | null {
    const progress = relocation.progress;
    if (typeof progress !== "object" || progress === null || !Array.isArray(progress.steps) || !Array.isArray(progress.warnings)) return null;
    return progress;
}

export function placementMoveStepLabel(step: HostingPlacementMoveStep) {
    return STEP_LABELS[step] ?? step;
}

/** A readable reason for a failed or cancelled move, or null when the code has none here. */
export function placementRelocationErrorLabel(errorCode: string) {
    return ERROR_LABELS[errorCode] ?? null;
}

function warningLabel(warning: HostingPlacementRelocationWarning | undefined, announced: boolean) {
    if (warning === undefined) return announced ? "pending" : "not sent";
    switch (warning.state) {
        case "succeeded": return "sent";
        case "queued": case "running": case "retry-wait": return "pending";
        case "unsupported": return "not possible on this runner";
        default: return "not sent";
    }
}

/**
 * The move's track: warned, the job's seven steps and the end. Only a move under way has a current
 * step. A move that leaves a stopped server stopped reads "Stays stopped" where a running one starts
 * its game, and with no job yet to say which, the step says it starts only a game that was running.
 */
export function placementRelocationTrack(relocation: HostingPlacementRelocation, progress: HostingPlacementRelocationProgress): PlacementTrackStep[] {
    const standing = placementMoveStanding(relocation, progress);
    // Only a move whose job is still working forward has a current job step.
    const active = standing === "moving";
    const announced = standing === "announced";
    const warned: PlacementTrackStep = relocation.mode === "offline"
        ? { id: "warned", label: "Warned", phase: "not-needed", reachedAt: null, note: "No warning needed: the server was stopped", warnings: [] }
        : {
            id: "warned", label: "Warned", phase: announced ? "current" : "done", reachedAt: null, note: null,
            warnings: WARNING_MINUTES.map((minutes) => {
                const warning = progress.warnings.find((item) => item.minutes === minutes);
                return { minutes, label: warningLabel(warning, announced), sentAt: warning?.state === "succeeded" ? warning.sentAt : null };
            }),
        };
    const steps = PLACEMENT_MOVE_STEPS.map((step): PlacementTrackStep => {
        const reached = progress.steps.find((item) => item.step === step)?.reachedAt ?? null;
        const phase: PlacementTrackPhase = active && progress.step === step ? "current" : reached !== null ? "done" : "waiting";
        if (step === "starting-game" && reached === null) {
            if (progress.restartsGame === false) return { id: step, label: "Stays stopped", phase: "not-needed", reachedAt: null, note: "The game was stopped, so the move leaves it stopped", warnings: [] };
            if (progress.restartsGame === null) return { id: step, label: "Starting game", phase, reachedAt: null, note: "Only if the game is running when the move begins", warnings: [] };
        }
        return { id: step, label: placementMoveStepLabel(step), phase, reachedAt: reached, note: null, warnings: [] };
    });
    const ended = relocation.completedAt ?? progress.jobCompletedAt;
    const end: PlacementTrackStep = relocation.state === "succeeded" ? { id: "done", label: "Done", phase: "done", reachedAt: ended, note: null, warnings: [] }
        : relocation.state === "failed" ? { id: "done", label: "Failed", phase: "failed", reachedAt: ended, note: null, warnings: [] }
            : relocation.state === "cancelled" ? { id: "done", label: "Cancelled", phase: "cancelled", reachedAt: ended, note: null, warnings: [] }
                // Not reached yet; a queued move whose job ended or is going back says why.
                : { id: "done", label: "Done", phase: "waiting", reachedAt: null, note: standing === "returning" ? "The move failed, so the server goes back" : placementMoveStandingNote(standing), warnings: [] };
    const returning: PlacementTrackStep[] = standing === "returning"
        ? [{ id: "returning", label: "Returning", phase: "current", reachedAt: null, note: placementMoveStandingNote(standing), warnings: [] }]
        : [];
    return [warned, ...steps, ...returning, end];
}

/** "4 min 12 s" from a finished job's start to its end, or null without both times. */
export function placementRelocationDuration(progress: Pick<HostingPlacementRelocationProgress, "jobStartedAt" | "jobCompletedAt">) {
    if (progress.jobStartedAt === null || progress.jobCompletedAt === null) return null;
    const milliseconds = Date.parse(progress.jobCompletedAt) - Date.parse(progress.jobStartedAt);
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
    const seconds = Math.round(milliseconds / 1_000);
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    if (hours > 0) return `${hours} h ${minutes} min`;
    return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

/** "3 moves queued in the last 24 hours"; the count is informational, as moves are not rate limited. */
export function placementMovesQueuedLabel(count: number) {
    return `${count} ${count === 1 ? "move" : "moves"} queued in the last 24 hours`;
}

/** The servers waiting out a failure backoff, named from the listed moves where possible, or by server ID. */
export function placementBackoffs(executor: Pick<HostingAdminPlacementExecutor, "status" | "relocations">) {
    const backedOff = executor.status?.backedOff;
    if (!Array.isArray(backedOff)) return [];
    return backedOff.map((backoff: HostingPlacementBackoff) => {
        const relocation = executor.relocations.find((item) => item.relocationId === backoff.relocationId)
            ?? executor.relocations.find((item) => item.serverId === backoff.serverId);
        // Plain sentences read as a reason in parentheses without their full stop; other codes show as they are.
        const reason = backoff.errorCode === null ? null : placementRelocationErrorLabel(backoff.errorCode)?.replace(/\.$/u, "") ?? backoff.errorCode;
        return { serverId: backoff.serverId, displayName: relocation?.displayName ?? backoff.serverId, until: backoff.until, reason };
    });
}

/**
 * One executor read at a time. `shared` joins a read under way, or the one queued to follow it; `fresh` waits
 * for a read under way and then reads again (callers meanwhile share that one), for a caller that needs
 * settings newer than its own request. A read is only ever started when none is under way or queued.
 */
export function createPlacementExecutorReads<T>(read: () => Promise<T>) {
    let current: Promise<T> | null = null;
    let next: Promise<T> | null = null;
    function start() {
        const reading = read().finally(() => {
            if (current === reading) current = null;
        });
        current = reading;
        return reading;
    }
    return {
        // Between a read ending and the queued one starting, a caller joins the queued one rather than racing it.
        shared: () => current ?? next ?? start(),
        fresh(): Promise<T> {
            if (current === null && next === null) return start();
            next ??= current!.then(() => undefined, () => undefined).then(() => {
                next = null;
                return start();
            });
            return next;
        },
    };
}

/** The executor's announced or queued relocation, if the read names one it lists. */
export function activePlacementRelocation(executor: Pick<HostingAdminPlacementExecutor, "status" | "relocations">) {
    const relocationId = executor.status?.activeRelocationId ?? null;
    if (relocationId === null) return null;
    return executor.relocations.find((relocation) => relocation.relocationId === relocationId) ?? null;
}
