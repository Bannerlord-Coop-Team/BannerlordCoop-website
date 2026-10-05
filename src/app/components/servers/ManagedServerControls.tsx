"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { useManagedServerPolling } from "@/app/components/servers/ManagedServerPollingProvider";
import { operateManagedServer, readManagedServerStartStatus, setManagedServerPassword } from "@/app/servers/managed-server-actions";
import { useRouter } from "next/navigation";
import type { ManagedStartStatus } from "@/app/lib/hosting/my-servers-server";
import { Check, Download, LoaderCircle, Play, RotateCw, Square } from "lucide-react";
import { useEffect, useState, useTransition, type FormEvent } from "react";

const TRANSITIONAL_STATES = new Set([
    "provisioning",
    "configuring",
    "starting",
    "stopping",
    "maintenance",
    "updating",
    "deleting",
]);

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
    const { session: pollingSession, timedOutSession, beginPolling, endPolling } = useManagedServerPolling();
    const canOperate = accessRole === "owner" || accessRole === "manager";
    const displayedState = startStatus?.state === "succeeded" && expectedUpdatedAt === startRevision ? "running" : operationState;
    const stateIsTransitional = TRANSITIONAL_STATES.has(displayedState);
    const trackingStop = stopRevision !== null;
    const stopCheckPaused = trackingStop && timedOutSession?.serverId === serverId
        && timedOutSession.statusSource === "server" && timedOutSession.initialUpdatedAt === stopRevision;

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

    const trackingStart = startJobId !== null && !["succeeded", "failed", "cancelled"].includes(startStatus?.state ?? "");

    if (!canOperate) {
        return (
            <span className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-foreground-dim">
                {t("controls.readOnlyAccess")}</span>
        );
    }

    const busy = isPending || trackingStart || trackingStop || stateIsTransitional || pollingSession !== null;
    const canStart = ["stopped", "failed", "degraded"].includes(displayedState);
    const canStop = ["running", "starting", "failed", "degraded"].includes(displayedState);
    const canRestart = ["running", "degraded"].includes(displayedState);

    /** Confirms disruptive operations and reports the existing action result. */
    function requestOperation(operation: Operation) {
        if (busy) return;
        if (operation === "stop" && !window.confirm(
            t("controls.stopDisplaynamePlayersWillBeDisconnectedWithoutASaveFlush", { displayName: displayName }),
        )) return;
        if (operation === "restart-game" && !window.confirm(
            t("controls.restartDisplaynamePlayersWillBeDisconnectedWithoutASaveFlush", { displayName: displayName }),
        )) return;
        if (operation === "update-now" && !window.confirm(
            t("controls.updateDisplaynameNowABackupWillBeTakenFirstIf", { displayName: displayName }),
        )) return;

        setMessage(operation === "start" ? t("controls.sendingYourStartRequest") : operation === "stop" ? t("controls.sendingYourStopRequest") : "");
        setStartRevision(expectedUpdatedAt);
        setStartJobId(null);
        setStartStatus(null);
        setProgressPaused(false);
        setPendingOperation(operation);
        startTransition(async () => {
            try {
                const result = await operateManagedServer({
                    serverId,
                    action: operation,
                    ...(operation === "update-now" ? { expectedUpdatedAt } : {}),
                });
                setMessage(result.message);
                if (operation === "stop" && result.checkStatus) {
                    setStopRevision(expectedUpdatedAt);
                    beginPolling(serverId, expectedUpdatedAt);
                }
                if (operation === "start" && result.ok) {
                    if (result.operationId) setStartJobId(result.operationId);
                    else setStartStatus({ state: "succeeded", phase: "ready", progress: result.message });
                }
            } catch {
                if (operation === "stop") {
                    setMessage(t("controls.checkingWhetherYourServerHasStopped"));
                    setStopRevision(expectedUpdatedAt);
                    beginPolling(serverId, expectedUpdatedAt);
                } else {
                    setMessage(t("controls.theCommandCouldNotBeConfirmedItMayHaveExecuted"));
                }
            } finally {
                setPendingOperation(null);
            }
        });
    }

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
                    disabled={busy}
                    pending={pendingOperation === "update-now"}
                    onClick={() => requestOperation("update-now")}
                />
            </div>
            {(pendingOperation === "start" || startJobId !== null || startStatus !== null) && (
                <StartProgress status={startStatus} paused={progressPaused} />
            )}
            {progressPaused && <div className="max-w-xl text-sm leading-6 text-foreground-muted">
                <p>{t("controls.automaticProgressUpdatesArePausedReadinessHasNotBeenConfirmed")}</p>
                <button type="button" className="mt-2 min-h-10 rounded-md border border-gold/40 px-3 text-gold focus-visible:outline-2 focus-visible:outline-gold"
                    onClick={() => { setProgressPaused(false); setPollRun(current => current + 1); }}>
                    {t("controls.resumeProgressUpdates")}</button>
            </div>}
            {stopCheckPaused && <div className="max-w-xl text-sm leading-6 text-foreground-muted" role="status">
                <p>{t("controls.stopIsTakingLongerThanExpected")}</p>
                <button type="button" className="mt-2 min-h-10 rounded-md border border-gold/40 px-3 text-gold focus-visible:outline-2 focus-visible:outline-gold"
                    onClick={() => beginPolling(serverId, stopRevision!)}>
                    {t("controls.checkStatusAgain")}
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
    );
}

// Presents localized startup phases while preserving external progress.
function StartProgress({ status, paused }: { status: StartProgressStatus | null; paused: boolean }) {
    const { t } = useTranslations("managed-server");
    const phases = ["queued", "preparing", "starting", "verifying", "ready"] as const;
    const labels = [t("controls.startRequested"), t("controls.prepareServer"), t("controls.launchGameAndLoadCampaign"), t("controls.confirmReadiness"), t("controls.readyToJoin")];
    const current = phases.indexOf(status?.phase ?? "queued");
    const failed = status?.state === "failed" || status?.state === "cancelled";
    return <div className="w-full max-w-xl rounded-lg border border-gold/25 bg-gold/[0.04] p-4" role="status" aria-live="polite">
        <p className="font-medium text-foreground">{failed ? status.state === "cancelled" ? t("controls.startCancelled") : t("controls.serverCouldNotStart")
            : status?.state === "succeeded" ? t("controls.yourServerIsReadyToJoin") : t("controls.startingYourServer")}</p>
        <ol className="mt-3 space-y-2 text-sm">
            {phases.map((phase, index) => <li key={phase} aria-current={index === current ? "step" : undefined}
                className={`flex items-center gap-2 ${index <= current ? "text-foreground" : "text-foreground-dim"}`}>
                {index < current || (index === current && status?.state === "succeeded")
                    ? <Check aria-hidden="true" className="size-4 text-gold" />
                    : index === current && !failed && !paused ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-gold motion-reduce:animate-none" />
                        : <span aria-hidden="true" className="size-4 rounded-full border border-white/20" />}
                <span>{labels[index]}<span className="sr-only">{index < current ? t("controls.completed") : index === current ? t("controls.currentPhase") : t("controls.waiting")}</span></span>
            </li>)}
        </ol>
        <p className="mt-3 text-sm leading-6 text-foreground-muted">{failed ? t("controls.readinessWasNotConfirmedCheckServerStatusOrContactSupport")
            : status?.state === "retry-wait" ? t("controls.waitingToRetrySafelyProgress", { progress: status.progress })
                : status?.progress ?? t("controls.waitingForTheHostingServiceToAcceptYourRequest")}</p>
    </div>;
}

/** Owns the owner-only password form in Settings, preserving confirmation and pending guards. */
export function ManagedServerPassword({ serverId, accessRole, operationState, expectedUpdatedAt }: Omit<ManagedServerControlsProps, "displayName" | "observedGameState">) {
    const { t } = useTranslations("managed-server");
    const [isPending, startTransition] = useTransition();
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const { session: pollingSession } = useManagedServerPolling();
    const busy = isPending || TRANSITIONAL_STATES.has(operationState) || pollingSession !== null;
    if (accessRole !== "owner") return null;

    /** Applies a confirmed password change once and clears the sensitive draft after the response. */
    function savePassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || !password) return;
        if (operationState === "running" && !window.confirm(t("controls.changeThePasswordAndRestartTheServerAfterWarningPlayers"))) return;
        setMessage("");
        startTransition(async () => {
            try {
                const result = await setManagedServerPassword({ serverId, expectedUpdatedAt, password });
                setMessage(result.message);
            } catch {
                setMessage(t("controls.thePasswordChangeCouldNotBeConfirmedItMayHave"));
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
