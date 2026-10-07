"use client";

import { useTranslations } from "@/app/lib/localization/client";

import {
    useManagedConsoleSignals,
    useManagedServerPolling,
    useManagedServerStatusSlot,
    type ManagedConsoleSignal,
} from "@/app/components/servers/ManagedServerPollingProvider";
import { operateManagedServer, readManagedServerStartStatus, setManagedServerPassword } from "@/app/servers/managed-server-actions";
import { useRouter } from "next/navigation";
import type { ManagedStartStatus } from "@/app/lib/hosting/my-servers-server";
import { Check, Download, LoaderCircle, Play, RotateCw, Square } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const TRANSITIONAL_STATES = new Set([
    "provisioning",
    "configuring",
    "starting",
    "stopping",
    "maintenance",
    "updating",
    "deleting",
]);

/** Lifecycle states with dictionary labels; others keep their title-cased external value. */
const LABELLED_STATES = new Set(["running", "stopped", "starting", "stopping", "failed", "degraded", "unknown", "provisioning", "configuring", "maintenance", "updating", "deletion-pending", "deleting", "deleted", "suspended", "awaiting-save", "ready", "offline", "online"]);

/** Restart progress gives way to plain guidance if the game has not reported ready by then. */
const RESTART_WATCH_MILLISECONDS = 5 * 60_000;
/** An unconfirmed request is checked for at least this long before the observed state is reported. */
const VERIFY_WINDOW_MILLISECONDS = 20_000;

type StartProgressStatus = Pick<ManagedStartStatus, "state" | "phase" | "progress">;

type Operation = "start" | "stop" | "restart-game" | "update-now";

type ManagedServerControlsProps = {
    serverId: string;
    displayName: string;
    accessRole: "owner" | "manager" | "support" | "admin";
    operationState: string;
    observedGameState: string;
    expectedUpdatedAt: string;
};

const RESTART_STEPS = ["requested", "stopping", "loading", "ready"] as const;

export type RestartStage = (typeof RESTART_STEPS)[number] | "failed";

/** Restart evidence gathered from live console phases. */
export type RestartProgress = {
    stage: RestartStage;
    /** Streams numbered at or above this boundary carry the restarted run. */
    boundary: number;
    /** A stream that showed the restarted run booting or loading. */
    resumedConnection: number | null;
    accepted: boolean;
    consoleLost: boolean;
    detail?: string;
};

/** Begins tracking before the request is sent, so the old run's shutdown is not missed. */
export function beginRestartProgress(): RestartProgress {
    return { stage: "requested", boundary: Number.POSITIVE_INFINITY, resumedConnection: null, accepted: false, consoleLost: false };
}

/** Reports whether restart progress has reached a final step. */
function restartSettled(progress: RestartProgress) {
    return progress.stage === "ready" || progress.stage === "failed";
}

/** Moves to at least the given step without ever moving backwards. */
function atLeast(progress: RestartProgress, stage: "stopping" | "loading"): RestartProgress {
    const current = RESTART_STEPS.indexOf(progress.stage as (typeof RESTART_STEPS)[number]);
    return current >= RESTART_STEPS.indexOf(stage) ? progress : { ...progress, stage };
}

/** Records an accepted Restart: streams opened after this point carry the restarted game. */
export function acceptRestartProgress(progress: RestartProgress, latestConnection: number): RestartProgress {
    if (restartSettled(progress)) return progress;
    return { ...atLeast(progress, "stopping"), boundary: Math.min(progress.boundary, latestConnection + 1), accepted: true };
}

/** Advances only on evidence from the restarted run, never on replayed output from the run being stopped. */
export function advanceRestartProgress(progress: RestartProgress, signal: ManagedConsoleSignal): RestartProgress {
    if (restartSettled(progress)) return progress;
    if (signal.type === "unavailable") return progress.consoleLost ? progress : { ...progress, consoleLost: true };
    if (signal.type === "closed") {
        if (!signal.runEnded) return progress;
        return { ...atLeast(progress, "stopping"), boundary: Math.min(progress.boundary, signal.connection + 1) };
    }
    if (signal.type !== "phase") return progress;
    if (signal.phase === "stopping") return atLeast(progress, "stopping");
    const restarted = signal.connection >= progress.boundary || signal.connection === progress.resumedConnection;
    if (!restarted) {
        // Runner streams follow only new output (podman logs --tail=0) and survive the container restart,
        // so once Restart is pressed a booting or loading game is the restarted run on whichever stream reports it.
        if (signal.phase !== "boot" && signal.phase !== "loading") return progress;
        return { ...atLeast(progress, "loading"), resumedConnection: signal.connection };
    }
    if (signal.phase === "fatal") return { ...progress, stage: "failed", ...(signal.detail ? { detail: signal.detail } : {}) };
    if (signal.phase === "serving") return { ...progress, stage: "ready" };
    return atLeast(progress, "loading");
}

/** Provides confirmed lifecycle operations without mixing in server configuration. */
export function ManagedServerControls({
    serverId,
    displayName,
    accessRole,
    operationState,
    observedGameState,
    expectedUpdatedAt,
}: ManagedServerControlsProps) {
    const { t } = useTranslations("managed-server");
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [pendingOperation, setPendingOperation] = useState<Operation | null>(null);
    const [message, setMessage] = useState("");
    const [startRevision, setStartRevision] = useState(expectedUpdatedAt);
    const [startJobId, setStartJobId] = useState<string | null>(null);
    const [startStatus, setStartStatus] = useState<StartProgressStatus | null>(null);
    const [progressPaused, setProgressPaused] = useState(false);
    const [pollRun, setPollRun] = useState(0);
    const [stopRevision, setStopRevision] = useState<string | null>(null);
    const [restartRevision, setRestartRevision] = useState<string | null>(null);
    const [restartWindowOpen, setRestartWindowOpen] = useState(false);
    const [restart, setRestart] = useState<RestartProgress | null>(null);
    const [verifyRevision, setVerifyRevision] = useState<string | null>(null);
    const [verifyWindowOpen, setVerifyWindowOpen] = useState(false);
    const restartRef = useRef<RestartProgress | null>(null);
    const timers = useRef<{ restart?: ReturnType<typeof setTimeout>; restartWindow?: ReturnType<typeof setTimeout>; verify?: ReturnType<typeof setTimeout> }>({});
    const { session: pollingSession, timedOutSession, beginPolling, endPolling } = useManagedServerPolling();
    const consoleSignals = useManagedConsoleSignals();
    const statusSlot = useManagedServerStatusSlot();
    const canOperate = accessRole === "owner" || accessRole === "manager";
    const displayedState = startStatus?.state === "succeeded" && expectedUpdatedAt === startRevision ? "running" : operationState;
    const stateIsTransitional = TRANSITIONAL_STATES.has(displayedState);
    const trackingStop = stopRevision !== null;
    const trackingRestart = restart !== null && !restartSettled(restart);
    const stopCheckPaused = trackingStop && timedOutSession?.serverId === serverId
        && timedOutSession.statusSource === "server" && timedOutSession.initialUpdatedAt === stopRevision;
    const verifyTimedOut = verifyRevision !== null && timedOutSession?.serverId === serverId
        && timedOutSession.statusSource === "server" && timedOutSession.initialUpdatedAt === verifyRevision;

    useEffect(() => {
        const scheduled = timers.current;
        return () => {
            clearTimeout(scheduled.restart);
            clearTimeout(scheduled.restartWindow);
            clearTimeout(scheduled.verify);
        };
    }, []);

    useEffect(() => {
        if (stopRevision === null || isPending) return;
        // A completed command is not enough: require a newer, confirmed server observation.
        if (operationState !== "stopped" || observedGameState !== "stopped" || expectedUpdatedAt <= stopRevision) return;
        const timeout = setTimeout(() => {
            setMessage(t("controls.serverStopped"));
            setStopRevision(null);
            endPolling(serverId);
        }, 0);
        return () => clearTimeout(timeout);
    }, [serverId, stopRevision, operationState, observedGameState, expectedUpdatedAt, isPending, endPolling, t]);

    useEffect(() => {
        const current = restartRef.current;
        if (restartRevision === null || restartWindowOpen || current === null || !current.accepted || restartSettled(current)
            || expectedUpdatedAt <= restartRevision) return;
        // The control plane can report a crashed or stopped run before the console does; report it rather than wait.
        if (!["failed", "stopped"].includes(operationState) && observedGameState !== "failed") return;
        const timeout = setTimeout(() => {
            clearTimeout(timers.current.restart);
            updateRestart(null);
            setMessage(t("controls.statusCheckedCurrentStateState", { state: stateLabel(operationState, t) }));
            setRestartRevision(null);
            endPolling(serverId);
        }, 0);
        return () => clearTimeout(timeout);
    }, [serverId, restart, restartRevision, restartWindowOpen, operationState, observedGameState, expectedUpdatedAt, endPolling, t]);

    useEffect(() => {
        if (verifyRevision === null || isPending) return;
        // Settle on a newer settled observation, or on the current one once the short check window has passed.
        const observed = expectedUpdatedAt > verifyRevision;
        if (!verifyTimedOut && ((!observed && verifyWindowOpen) || TRANSITIONAL_STATES.has(operationState))) return;
        const timeout = setTimeout(() => {
            setMessage(t("controls.statusCheckedCurrentStateState", { state: stateLabel(operationState, t) }));
            setVerifyRevision(null);
            endPolling(serverId);
        }, 0);
        return () => clearTimeout(timeout);
    }, [serverId, verifyRevision, verifyWindowOpen, verifyTimedOut, operationState, expectedUpdatedAt, isPending, endPolling, t]);

    useEffect(() => {
        if (startJobId === null) return;
        let cancelled = false;
        let timeout: ReturnType<typeof setTimeout>;
        const deadline = Date.now() + 15 * 60_000;
        // Refreshes existing operation progress and reports localized connection feedback.
        async function poll() {
            try {
                const result = await readManagedServerStartStatus(serverId, startJobId!);
                if (cancelled) return;
                if (result.ok) {
                    setStartStatus(result.status);
                    setMessage("");
                    if (["succeeded", "failed", "cancelled"].includes(result.status.state)) { router.refresh(); return; }
                } else {
                    setMessage(result.message);
                    if (!result.retryable) { setProgressPaused(true); return; }
                }
            } catch {
                if (cancelled) return;
                setMessage(t("controls.reconnectingToServerProgressYourStartRequestIsStillBeing"));
            }
            if (Date.now() >= deadline) {
                setProgressPaused(true);
                return;
            }
            timeout = setTimeout(poll, 2_000);
        }
        void poll();
        return () => { cancelled = true; clearTimeout(timeout); };
    }, [serverId, startJobId, pollRun, router]);

    /** Keeps the restart ref and rendered progress in step. */
    function updateRestart(next: RestartProgress | null) {
        restartRef.current = next;
        setRestart(next);
    }

    /** Stops following a restart that cannot be confirmed live, without blocking the controls. */
    function settleRestartWithGuidance() {
        clearTimeout(timers.current.restart);
        updateRestart(null);
        setMessage(t("controls.restartingPlayersCanRejoinOnceTheCampaignFinishesLoadingUsually"));
        endPolling(serverId);
    }

    // Applies live console phases to the restart being followed.
    const followConsoleSignal = useEffectEvent((signal: ManagedConsoleSignal) => {
        const current = restartRef.current;
        if (signal.serverId !== serverId || current === null || restartSettled(current)) return;
        const next = advanceRestartProgress(current, signal);
        if (next === current) return;
        if (next.consoleLost && next.accepted) {
            settleRestartWithGuidance();
            return;
        }
        updateRestart(next);
        if (restartSettled(next)) {
            clearTimeout(timers.current.restart);
            endPolling(serverId);
            router.refresh();
        }
    });

    useEffect(() => {
        if (!trackingRestart || consoleSignals === null) return;
        return consoleSignals.subscribe((signal) => followConsoleSignal(signal));
    }, [consoleSignals, trackingRestart]);

    const trackingStart = startJobId !== null && !["succeeded", "failed", "cancelled"].includes(startStatus?.state ?? "");

    if (!canOperate) {
        return (
            <span className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-foreground-dim">
                {t("controls.readOnlyAccess")}</span>
        );
    }

    // A successful restart command leaves console readiness as background progress,
    // so a missed console phase cannot prevent the owner from stopping or restarting.
    const watchingAcceptedRestart = trackingRestart && restart.accepted;
    const restartPolling = watchingAcceptedRestart && pollingSession?.serverId === serverId
        && pollingSession.statusSource === "server" && pollingSession.initialUpdatedAt === restartRevision;
    const busy = isPending || trackingStart || (trackingStop && !stopCheckPaused)
        || (trackingRestart && !watchingAcceptedRestart) || stateIsTransitional || (pollingSession !== null && !restartPolling);
    const canStart = ["stopped", "failed", "degraded"].includes(displayedState);
    const canStop = ["running", "starting", "failed", "degraded"].includes(displayedState);
    const canRestart = ["running", "degraded"].includes(displayedState);
    const operationLabels: Record<Operation, string> = {
        start: t("controls.start"),
        stop: t("controls.stop"),
        "restart-game": t("controls.restart"),
        "update-now": t("controls.updateNow"),
    };

    /** Follows an accepted Restart through live console phases, or explains the wait when they are unavailable. */
    function followRestart() {
        const current = restartRef.current;
        if (current === null || restartSettled(current)) return;
        if (consoleSignals === null || !consoleSignals.isAttached(serverId) || current.consoleLost) {
            settleRestartWithGuidance();
            router.refresh();
            return;
        }
        updateRestart(acceptRestartProgress(current, consoleSignals.latestConnection(serverId)));
        setRestartWindowOpen(true);
        clearTimeout(timers.current.restartWindow);
        timers.current.restartWindow = setTimeout(() => setRestartWindowOpen(false), VERIFY_WINDOW_MILLISECONDS);
        setMessage("");
        beginPolling(serverId, expectedUpdatedAt);
        clearTimeout(timers.current.restart);
        timers.current.restart = setTimeout(settleRestartWithGuidance, RESTART_WATCH_MILLISECONDS);
    }

    /** Follows a Stop until a newer observation confirms it. */
    function trackStop() {
        setStopRevision(expectedUpdatedAt);
        beginPolling(serverId, expectedUpdatedAt);
    }

    /** Follows server status after an unconfirmed request until it settles, without resending anything. */
    function verifyStatus() {
        setVerifyRevision(expectedUpdatedAt);
        setVerifyWindowOpen(true);
        clearTimeout(timers.current.verify);
        timers.current.verify = setTimeout(() => setVerifyWindowOpen(false), VERIFY_WINDOW_MILLISECONDS);
        beginPolling(serverId, expectedUpdatedAt);
    }

    /** Confirms disruptive operations and reports the existing action result. */
    function requestOperation(operation: Operation) {
        if (busy) return;
        if (operation === "stop" && !window.confirm(
            t("controls.stopDisplaynameEveryoneConnectedWillBeDisconnectedTheServerSaves", { displayName: displayName }),
        )) return;
        if (operation === "restart-game" && !window.confirm(
            t("controls.restartDisplaynameEveryoneConnectedWillBeDisconnectedWhileItRestarts", { displayName: displayName }),
        )) return;
        if (operation === "update-now" && !window.confirm(
            t("controls.updateDisplaynameNowABackupWillBeTakenFirstIf", { displayName: displayName }),
        )) return;

        setMessage(operation === "start" ? t("controls.sendingYourStartRequest")
            : operation === "stop" ? t("controls.sendingYourStopRequest")
                : operation === "update-now" ? t("controls.sendingYourUpdateRequest") : "");
        setStartRevision(expectedUpdatedAt);
        setStartJobId(null);
        setStartStatus(null);
        setProgressPaused(false);
        setVerifyRevision(null);
        setStopRevision(null);
        clearTimeout(timers.current.restart);
        updateRestart(operation === "restart-game" ? beginRestartProgress() : null);
        setRestartRevision(operation === "restart-game" ? expectedUpdatedAt : null);
        setPendingOperation(operation);
        startTransition(async () => {
            try {
                const result = await operateManagedServer({
                    serverId,
                    action: operation,
                    ...(operation === "update-now" ? { expectedUpdatedAt } : {}),
                });
                if (operation === "restart-game" && result.ok) {
                    followRestart();
                    return;
                }
                if (operation === "restart-game") updateRestart(null);
                setMessage(result.message);
                if (result.refresh) router.refresh();
                if (operation === "stop" && result.checkStatus) {
                    trackStop();
                } else if (result.checkStatus) {
                    verifyStatus();
                }
                if (operation === "start" && result.ok) {
                    if (result.operationId) setStartJobId(result.operationId);
                    else setStartStatus({ state: "succeeded", phase: "ready", progress: result.message });
                }
            } catch {
                if (operation === "restart-game") updateRestart(null);
                if (operation === "stop") {
                    setMessage(t("controls.checkingWhetherYourServerHasStopped"));
                    trackStop();
                } else {
                    setMessage(t("controls.weCouldnTConfirmThatYourOperationRequestWentThrough", { operation: operationLabels[operation] }));
                    verifyStatus();
                }
            } finally {
                setPendingOperation(null);
            }
        });
    }

    const showStart = pendingOperation === "start" || startJobId !== null || startStatus !== null;
    const statusArea = showStart || restart !== null || progressPaused || stopCheckPaused || message ? (
        <div className="flex w-full flex-col items-start gap-2">
            {showStart && <StartProgress status={startStatus} paused={progressPaused} />}
            {restart !== null && <RestartProgressCard progress={restart} />}
            {progressPaused && <div className="max-w-xl text-sm leading-6 text-foreground-muted">
                <p>{t("controls.automaticProgressUpdatesArePausedReadinessHasNotBeenConfirmed")}</p>
                <button type="button" className="mt-2 min-h-10 rounded-md border border-gold/40 px-3 text-gold focus-visible:outline-2 focus-visible:outline-gold"
                    onClick={() => { setProgressPaused(false); setPollRun(current => current + 1); }}>
                    {t("controls.resumeProgressUpdates")}</button>
            </div>}
            {stopCheckPaused && <div className="max-w-xl text-sm leading-6 text-foreground-muted" role="status">
                <p>{t("controls.stoppingIsTakingLongerThanUsualSoAutomaticStatusUpdates")}</p>
                <button type="button" className="mt-2 min-h-10 rounded-md border border-gold/40 px-3 text-gold focus-visible:outline-2 focus-visible:outline-gold"
                    onClick={() => beginPolling(serverId, stopRevision!)}>
                    {t("controls.checkNow")}
                </button>
            </div>}
            {message && !stopCheckPaused && (
                <p
                    aria-live="polite"
                    className="max-w-xl text-left text-xs leading-5 text-foreground-muted"
                >
                    {message}
                </p>
            )}
        </div>
    ) : null;

    return (
        <div className="flex flex-col items-start gap-2">
            <div className="flex flex-wrap gap-2">
                <ControlButton
                    label={t("controls.start")}
                    icon={Play}
                    disabled={busy || !canStart}
                    pending={pendingOperation === "start" || trackingStart}
                    onClick={() => requestOperation("start")}
                />
                <ControlButton
                    label={t("controls.stop")}
                    icon={Square}
                    disabled={busy || !canStop}
                    pending={pendingOperation === "stop" || (trackingStop && !stopCheckPaused)}
                    onClick={() => requestOperation("stop")}
                />
                <ControlButton
                    label={t("controls.restart")}
                    icon={RotateCw}
                    disabled={busy || !canRestart}
                    pending={pendingOperation === "restart-game"}
                    onClick={() => requestOperation("restart-game")}
                />
                <ControlButton
                    label={t("controls.updateNow")}
                    icon={Download}
                    disabled={busy || trackingRestart}
                    pending={pendingOperation === "update-now"}
                    onClick={() => requestOperation("update-now")}
                />
            </div>
            {statusArea !== null && (statusSlot === undefined ? statusArea : statusSlot ? createPortal(statusArea, statusSlot) : null)}
        </div>
    );
}

// Resolves a lifecycle state label, keeping unknown external values readable.
function stateLabel(state: string, t: (key: string) => string) {
    if (LABELLED_STATES.has(state)) return t(`state.${state}`);
    return state.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

// Renders an operation's phases as a checklist with its current step and outcome.
function OperationProgress({ title, labels, current, outcome, footer }: {
    title: string;
    labels: string[];
    current: number;
    outcome: "active" | "succeeded" | "failed" | "paused";
    footer?: ReactNode;
}) {
    const { t } = useTranslations("managed-server");
    return <div className="w-full max-w-xl rounded-lg border border-gold/25 bg-gold/[0.04] p-4" role="status" aria-live="polite">
        <p className="font-medium text-foreground">{title}</p>
        <ol className="mt-3 space-y-2 text-sm">
            {labels.map((label, index) => <li key={index} aria-current={index === current ? "step" : undefined}
                className={`flex items-center gap-2 ${index <= current ? "text-foreground" : "text-foreground-dim"}`}>
                {index < current || (index === current && outcome === "succeeded")
                    ? <Check aria-hidden="true" className="size-4 text-gold" />
                    : index === current && outcome === "active" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-gold motion-reduce:animate-none" />
                        : <span aria-hidden="true" className="size-4 rounded-full border border-white/20" />}
                <span>{label}<span className="sr-only">{index < current ? t("controls.completed") : index === current ? t("controls.currentPhase") : t("controls.waiting")}</span></span>
            </li>)}
        </ol>
        {footer && <p className="mt-3 text-sm leading-6 text-foreground-muted">{footer}</p>}
    </div>;
}

// Presents localized startup phases while preserving external progress.
function StartProgress({ status, paused }: { status: StartProgressStatus | null; paused: boolean }) {
    const { t } = useTranslations("managed-server");
    const phases = ["queued", "preparing", "starting", "verifying", "ready"] as const;
    const labels = [t("controls.startRequested"), t("controls.prepareServer"), t("controls.launchGameAndLoadCampaign"), t("controls.confirmReadiness"), t("controls.readyToJoin")];
    const failed = status?.state === "failed" || status?.state === "cancelled";
    const outcome = failed ? "failed" : status?.state === "succeeded" ? "succeeded" : paused ? "paused" : "active";
    return <OperationProgress
        title={failed ? status.state === "cancelled" ? t("controls.startCancelled") : t("controls.serverCouldNotStart")
            : status?.state === "succeeded" ? t("controls.yourServerIsReadyToJoin") : t("controls.startingYourServer")}
        labels={labels}
        current={phases.indexOf(status?.phase ?? "queued")}
        outcome={outcome}
        footer={failed ? [status.progress, t("controls.youCanPressActionToTryAgain", { action: t("controls.start") })].filter(Boolean).join(" ")
            : status?.state === "retry-wait" ? t("controls.waitingToRetrySafelyProgress", { progress: status.progress })
                : status?.progress ?? t("controls.waitingForTheHostingServiceToAcceptYourRequest")}
    />;
}

// Presents restart phases observed in the live console, never claiming readiness before the game reports it.
function RestartProgressCard({ progress }: { progress: RestartProgress }) {
    const { t } = useTranslations("managed-server");
    const labels = [t("controls.restartRequested"), t("controls.stopTheGame"), t("controls.loadCampaign"), t("controls.readyToJoin")];
    const failed = progress.stage === "failed";
    const ready = progress.stage === "ready";
    return <OperationProgress
        title={failed ? t("controls.serverCouldNotRestart") : ready ? t("controls.yourServerIsReadyToJoin") : t("controls.restartingYourServer")}
        labels={labels}
        current={failed ? RESTART_STEPS.indexOf("loading") : RESTART_STEPS.indexOf(progress.stage as (typeof RESTART_STEPS)[number])}
        outcome={failed ? "failed" : ready ? "succeeded" : "active"}
        footer={failed ? <>{t("controls.theGameStoppedWithAnErrorBeforeTheCampaignFinished")}{progress.detail && <span className="mt-1 block break-words font-mono text-xs">{progress.detail}</span>}</>
            : progress.stage === "requested" ? t("controls.sendingYourRestartRequest")
                : ready ? undefined : t("controls.playersCanRejoinOnceTheCampaignFinishesLoading")}
    />;
}

/** Owns the owner-only password form in Settings, preserving confirmation and pending guards. */
export function ManagedServerPassword({ serverId, accessRole, operationState, expectedUpdatedAt }: Omit<ManagedServerControlsProps, "displayName" | "observedGameState">) {
    const { t } = useTranslations("managed-server");
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const { session: pollingSession } = useManagedServerPolling();
    const busy = isPending || TRANSITIONAL_STATES.has(operationState) || pollingSession !== null;
    if (accessRole !== "owner") return null;

    /** Applies a confirmed password change once, clears the draft, and refreshes status when the outcome is unknown. */
    function savePassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || !password) return;
        if (operationState === "running" && !window.confirm(t("controls.changeThePasswordAndRestartTheServerAfterWarningPlayers"))) return;
        setMessage("");
        startTransition(async () => {
            try {
                const result = await setManagedServerPassword({ serverId, expectedUpdatedAt, password });
                setMessage(result.message);
                if (result.checkStatus) router.refresh();
            } catch {
                setMessage(t("controls.weCouldnTConfirmThePasswordChangeSoWeRefreshed"));
                router.refresh();
            } finally {
                setPassword("");
            }
        });
    }

    return <section aria-labelledby="game-password-heading" className="rounded-lg border border-white/10 bg-surface p-5">
        <h2 id="game-password-heading" className="text-base font-semibold">{t("controls.gamePassword")}</h2>
        <p className="mt-1 text-sm leading-6 text-foreground-muted">{t("controls.controlsWhoCanJoinTheGameChangingItWhileRunning")}</p>
        <form onSubmit={savePassword} className="mt-4 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm font-medium">{t("controls.newGamePassword")}<input className="mt-2 block min-h-11 w-full rounded-md border border-white/15 bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-40" type="password" autoComplete="new-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
            </label>
            <button type="submit" disabled={busy || !password} className="min-h-11 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40">{isPending ? t("controls.saving") : t("controls.setPassword")}</button>
        </form>
        {message && <p role="status" className="mt-3 text-sm leading-6 text-foreground-muted">{message}</p>}
    </section>;
}

/** Renders a lifecycle action with consistent target size and pending feedback. */
function ControlButton({
    label,
    icon: Icon,
    disabled,
    pending,
    onClick,
}: {
    label: string;
    icon: typeof Play;
    disabled: boolean;
    pending: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-white/15 bg-white/[0.03] px-2 py-2 text-xs font-medium text-foreground transition hover:border-gold/50 hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 sm:gap-2 sm:px-3 sm:text-sm"
        >
            <Icon aria-hidden="true" className={`size-3.5 ${pending ? "animate-pulse" : ""}`} />
            {pending ? `${label}…` : label}
        </button>
    );
}
