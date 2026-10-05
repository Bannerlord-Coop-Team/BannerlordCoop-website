"use client";

import { useTranslations } from "@/app/lib/localization/client";
import type { Translator } from "@/app/lib/localization/types";


import {
    ACTIVE_BACKUP_JOB_STATES,
    canManageServerBackups,
    canRequestServerBackupRestore,
    latestServerBackupAt,
    partitionServerBackups,
    restoreDisabledReason,
    visibleBackupJob,
} from "@/app/components/servers/managed-server-backup-policy";
import { useManagedServerPolling } from "@/app/components/servers/ManagedServerPollingProvider";
import type {
    MyServerBackupJob,
    MyServerBackupStatus,
    MyServerBackupSummary,
    MyServerSummary,
} from "@/app/lib/control-plane/types";
import { manageServerBackup } from "@/app/servers/managed-server-backup-actions";
import type { ManagedServerBackupInput } from "@/app/servers/managed-server-backup-input";
import {
    clearManagedServerBackupIntent,
    managedServerBackupIntentKey,
    readManagedServerBackupIntent,
    retainManagedServerBackupIntent,
    storeManagedServerBackupIntent,
} from "@/app/servers/managed-server-backup-intent";
import { Archive, ChevronDown, LoaderCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";

/** Backup history that failed to load is re-read this many times, this far apart, before the notice stays. */
const MAXIMUM_LOAD_RETRIES = 5;
const LOAD_RETRY_MILLISECONDS = 10_000;

const TERMINAL_JOB_STATES = new Set(["succeeded", "failed", "cancelled"]);
const TRANSITIONAL_SERVER_STATES = new Set([
    "provisioning",
    "configuring",
    "starting",
    "stopping",
    "maintenance",
    "updating",
    "deletion-pending",
    "deleting",
    "deleted",
    "suspended",
    "unknown",
]);
// Dates carry a zone label because they render in UTC on the server and the viewer's zone after hydration.
const BACKUP_TIME_FORMAT: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
};
const subscribeToTimeZone = () => () => undefined;

type ManagedServerBackupsProps = {
    userId: string;
    server: MyServerSummary;
    backups: readonly MyServerBackupSummary[];
    status: MyServerBackupStatus | null;
    loadError?: string;
};

// Keys backup state to the current account and server.
export function ManagedServerBackups(props: ManagedServerBackupsProps) {
    const intentKey = managedServerBackupIntentKey(props.userId, props.server.serverId);
    return <ManagedServerBackupsSession key={intentKey} {...props} intentKey={intentKey} />;
}

// Resolves the viewer's IANA time zone, falling back to UTC when the runtime reports none.
function browserTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// Uses UTC for server HTML and hydration, then the viewer's own time zone.
function useViewerTimeZone() {
    return useSyncExternalStore(subscribeToTimeZone, browserTimeZone, () => "UTC");
}

// Presents durable backup operations and localized restore confirmations.
function ManagedServerBackupsSession({
    userId,
    intentKey,
    server,
    backups,
    status,
    loadError,
}: ManagedServerBackupsProps & { intentKey: string }) {
    const { t, number, date } = useTranslations("managed-server");
    const timeZone = useViewerTimeZone();
    const expiredListId = useId();
    const restoreMessages = { expired: t("backupReason.expired"), inProgress: t("backupReason.inProgress"), installedBuildUnknown: t("backupReason.installedBuildUnknown"), backupBuildUnknown: t("backupReason.backupBuildUnknown"), buildMismatch: t("backupReason.buildMismatch"), unknown: t("backupReason.unknown") };
    const [intentReady, setIntentReady] = useState(false);
    const [storageError, setStorageError] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [pending, setPending] = useState<{ id: string; retry: boolean } | null>(null);
    const [retainedIntent, setRetainedIntent] = useState<ManagedServerBackupInput | null>(null);
    const [feedback, setFeedback] = useState<{ target: string; text: string; jobId?: string } | null>(null);
    const [watchedJobIds, setWatchedJobIds] = useState<ReadonlySet<string>>(() => new Set());
    const [interruptingJobIds, setInterruptingJobIds] = useState<ReadonlySet<string>>(() => new Set());
    const [showExpired, setShowExpired] = useState(false);
    const retainedIntentRef = useRef<ManagedServerBackupInput | null>(null);
    const polledJobIds = useRef(new Set<string>());
    const router = useRouter();
    const loadRetries = useRef(0);
    const {
        session: pollingSession,
        timedOutSession,
        attachJob,
        beginPolling,
        endPolling,
    } = useManagedServerPolling();

    useEffect(() => {
        if (!loadError) { loadRetries.current = 0; return; }
        if (loadRetries.current >= MAXIMUM_LOAD_RETRIES) return;
        // History that failed to load reloads itself a few times instead of asking the owner to refresh.
        const timer = window.setTimeout(() => {
            loadRetries.current += 1;
            router.refresh();
        }, LOAD_RETRY_MILLISECONDS);
        return () => window.clearTimeout(timer);
    }, [loadError, backups, status, router]);
    const activeJob = status?.job && ACTIVE_BACKUP_JOB_STATES.has(status.job.state) ? status.job : null;
    // Progress seen on this page makes the job's eventual outcome worth reporting.
    if (activeJob !== null && !watchedJobIds.has(activeJob.jobId)) {
        setWatchedJobIds(new Set(watchedJobIds).add(activeJob.jobId));
    }
    // Outcomes of older jobs are history, not news: report only jobs requested or watched here.
    const shownJob = visibleBackupJob(status?.job, watchedJobIds);
    const currentServer = status === null ? server : {
        ...server,
        operationState: status.operationState,
        observedGameState: status.observedGameState,
        updatedAt: status.updatedAt,
    };
    const serverIsRunning = currentServer.observedGameState === "running"
        || currentServer.operationState === "running";
    const canManage = canManageServerBackups(server.accessRole);
    const statusIsStale = timedOutSession?.serverId === server.serverId
        && timedOutSession.statusSource === "backup"
        && !(status?.job != null
            && status.job.jobId === timedOutSession.jobId
            && TERMINAL_JOB_STATES.has(status.job.state));

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            try {
                const intent = readManagedServerBackupIntent(window.sessionStorage, intentKey, server.serverId);
                retainedIntentRef.current = intent;
                setRetainedIntent(intent);
                setIntentReady(true);
            } catch {
                setStorageError(true);
            }
        }, 0);
        return () => window.clearTimeout(timeout);
    }, [intentKey, server.serverId]);

    useEffect(() => {
        if (activeJob === null || polledJobIds.current.has(activeJob.jobId)) return;
        const timeout = window.setTimeout(() => {
            if (polledJobIds.current.has(activeJob.jobId)) return;
            if (pollingSession !== null) {
                if (
                    pollingSession.serverId === server.serverId
                    && pollingSession.statusSource === "backup"
                    && pollingSession.jobId === null
                ) {
                    polledJobIds.current.add(activeJob.jobId);
                    attachJob(server.serverId, activeJob.jobId);
                }
                return;
            }
            polledJobIds.current.add(activeJob.jobId);
            beginPolling(server.serverId, currentServer.updatedAt, activeJob.jobId, "backup");
        }, 0);
        return () => window.clearTimeout(timeout);
    }, [
        activeJob,
        attachJob,
        beginPolling,
        currentServer.updatedAt,
        pollingSession,
        server.serverId,
    ]);

    useEffect(() => {
        const job = status?.job;
        if (
            pollingSession?.serverId !== server.serverId
            || pollingSession.statusSource !== "backup"
            || pollingSession.jobId === null
            || job?.jobId !== pollingSession.jobId
            || !TERMINAL_JOB_STATES.has(job.state)
        ) return;
        const timeout = window.setTimeout(() => endPolling(server.serverId), 0);
        return () => window.clearTimeout(timeout);
    }, [endPolling, pollingSession, server.serverId, status?.job]);

    const busy = !intentReady || storageError || isPending
        || (pollingSession !== null && retainedIntent === null)
        || activeJob !== null
        || TRANSITIONAL_SERVER_STATES.has(currentServer.operationState);
    const pendingBackupId = pending?.id ?? null;
    // A first submission in flight is not an unconfirmed outcome; only show reconciliation once it is.
    const showRetainedNotice = retainedIntent !== null && (pending === null || pending.retry);

    // Formats a backup timestamp with a zone label in the viewer's time zone after hydration.
    function formatTime(value: string) {
        return date(value, { ...BACKUP_TIME_FORMAT, timeZone });
    }

    // Records a job requested or reconciled on this page so its outcome can be reported.
    function watchJob(jobId: string) {
        setWatchedJobIds((current) => current.has(jobId) ? current : new Set(current).add(jobId));
    }

    // Persists the existing backup intent before dispatch or reconciliation.
    function rememberIntent(intent: ManagedServerBackupInput | null, resolved?: ManagedServerBackupInput) {
        try {
            if (intent !== null) {
                storeManagedServerBackupIntent(window.sessionStorage, intentKey, intent);
            } else if (resolved !== undefined) {
                clearManagedServerBackupIntent(window.sessionStorage, intentKey, resolved);
            }
            retainedIntentRef.current = intent;
            setRetainedIntent(intent);
            return true;
        } catch {
            setStorageError(true);
            return false;
        }
    }

    // Dispatches a retained backup request and reports its outcome beside the control that sent it.
    function submitIntent(
        intent: ManagedServerBackupInput,
        pendingId: string,
        { retry = false, interruptsPlayers = false }: { retry?: boolean; interruptsPlayers?: boolean } = {},
    ) {
        if (!canManage || loadError || !intentReady || storageError || isPending) return;
        // Persist before dispatch: the response or polling refresh can remove this component.
        if (!rememberIntent(intent)) return;
        const feedbackTarget = retry ? "create" : pendingId;
        setFeedback(null);
        setPending({ id: pendingId, retry });
        startTransition(async () => {
            try {
                const result = await manageServerBackup(intent, userId);
                // Unconfirmed outcomes are reconciled beside Create backup, so they are reported there.
                setFeedback(result.ok
                    ? { target: feedbackTarget, text: result.message, jobId: result.jobId }
                    : { target: result.retrySameRequest ? "create" : feedbackTarget, text: result.message });
                if (result.ok) {
                    rememberIntent(null, intent);
                    watchJob(result.jobId);
                    if (interruptsPlayers) setInterruptingJobIds((current) => new Set(current).add(result.jobId));
                    polledJobIds.current.add(result.jobId);
                    beginPolling(server.serverId, intent.expectedUpdatedAt, result.jobId, "backup");
                } else if (result.retrySameRequest) {
                    beginPolling(server.serverId, intent.expectedUpdatedAt, undefined, "backup");
                } else {
                    rememberIntent(null, intent);
                }
            } catch {
                setFeedback({ target: "create", text: t("backups.theSubmissionOutcomeCouldNotBeConfirmedRetryThisRequest") });
                beginPolling(server.serverId, intent.expectedUpdatedAt, undefined, "backup");
            } finally {
                setPending(null);
            }
        });
    }

    // Confirms the brief interruption of a running server before creating a backup intent.
    function submitCreateBackup() {
        if (retainedIntentRef.current !== null) return;
        const interruptsPlayers = serverIsRunning;
        if (interruptsPlayers && !window.confirm([
            t("backups.createABackupNow"),
            t("backups.theServerIsRunningItWillSaveStopBrieflyAndStartAgain"),
        ].join("\n\n"))) return;
        const candidate: ManagedServerBackupInput = {
            serverId: server.serverId,
            action: "create-backup",
            expectedUpdatedAt: currentServer.updatedAt,
            requestId: crypto.randomUUID(),
        };
        submitIntent(
            retainManagedServerBackupIntent(retainedIntentRef.current, candidate),
            "create",
            { interruptsPlayers },
        );
    }

    // Confirms destructive save restoration before retaining its request.
    function submitRestore(backup: MyServerBackupSummary) {
        if (retainedIntentRef.current !== null) return;
        if (!window.confirm([
            t("backups.restoreTheSaveFromCreatedat", { createdAt: formatTime(backup.createdAt) }),
            t("backups.currentCampaignProgressWillBeReplacedHostingWillFirstSave"),
            serverIsRunning
                ? t("backups.connectedPlayersWillBeInterruptedThePriorRunningStateWill")
                : t("backups.theServerWillRemainStoppedAfterTheSelectedSaveValidates"),
            t("backups.theInstalledGameAndModVersionsWillNotChange"),
        ].join("\n\n"))) return;

        const candidate: ManagedServerBackupInput = {
            serverId: server.serverId,
            backupId: backup.backupId,
            action: "restore-backup",
            expectedUpdatedAt: currentServer.updatedAt,
            requestId: crypto.randomUUID(),
        };
        submitIntent(
            retainManagedServerBackupIntent(retainedIntentRef.current, candidate),
            backup.backupId,
        );
    }

    // Retries the exact retained backup request without creating a new identity.
    function retryPendingRequest() {
        const intent = retainedIntentRef.current;
        if (intent === null) return;
        submitIntent(intent, intent.action === "create-backup" ? "create" : intent.backupId, { retry: true });
    }

    const { current: currentBackups, expired: expiredBackups } = partitionServerBackups(backups);
    const renderedBackupIds = new Set([...currentBackups, ...(showExpired ? expiredBackups : [])]
        .map((backup) => backup.backupId));
    // An acceptance note is superseded once that job's own outcome is shown.
    const currentFeedback = feedback?.jobId !== undefined && shownJob?.jobId === feedback.jobId && TERMINAL_JOB_STATES.has(shownJob.state)
        ? null : feedback;
    // Row results stay beside their restore button; anything else stays beside Create backup.
    const rowFeedback = currentFeedback !== null && currentFeedback.target !== "create" && renderedBackupIds.has(currentFeedback.target)
        ? currentFeedback : null;
    const controlFeedback = currentFeedback !== null && rowFeedback === null ? currentFeedback : null;
    const lastBackupAt = latestServerBackupAt(backups);

    // Renders one retained backup with its restore control and any result for that row.
    function renderBackup(backup: MyServerBackupSummary) {
        const canRestore = canManage && canRequestServerBackupRestore(backup);
        const isRestoring = pendingBackupId === backup.backupId;
        const reason = restoreDisabledReason(backup, restoreMessages);
        return (
            <li key={backup.backupId} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="font-label text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                            {formatBackupType(backup.backupType, t)}
                        </p>
                        <BackupState state={backup.restoreState} />
                    </div>
                    <p className="mt-2 text-sm text-foreground-muted">
                        <time dateTime={backup.createdAt}>{formatTime(backup.createdAt)}</time>
                        <span aria-hidden="true"> · </span>
                        {formatByteCount(backup.byteSize, number, t)}
                    </p>
                    <p className="mt-1 text-xs text-foreground-dim">
                        {t("backups.retainedUntilDate", { date: formatTime(backup.retentionExpiresAt) })}
                    </p>
                    {backup.restoredAt !== null && (
                        <p className="mt-1 text-xs text-foreground-dim">
                            {t("backups.lastRestoredDate", { date: formatTime(backup.restoredAt) })}
                        </p>
                    )}
                    {reason && (
                        <p className="mt-1 text-xs text-foreground-dim">
                            {reason}
                        </p>
                    )}
                    {rowFeedback?.target === backup.backupId && (
                        <p role="status" className="mt-2 max-w-2xl text-xs leading-5 text-foreground">
                            {rowFeedback.text}
                        </p>
                    )}
                </div>
                {canManage && (
                    <button
                        type="button"
                        disabled={
                            busy
                            || !canRestore
                            || retainedIntent !== null
                        }
                        onClick={() => submitRestore(backup)}
                        title={retainedIntent !== null
                            ? t("backups.reconcileThePendingBackupRequestFirst")
                            : reason}
                        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-red-400/40 bg-red-500/[0.06] px-3 font-label text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-red-200 transition-colors hover:border-red-300/60 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-foreground-dim"
                    >
                        <RotateCcw aria-hidden="true" className={`size-3.5 ${isRestoring ? "animate-pulse" : ""}`} />
                        {isRestoring ? t("backups.submitting") : t("backups.restoreSave")}
                    </button>
                )}
            </li>
        );
    }

    return (
        <div className="mt-5 space-y-4">
            {storageError && (
                <p role="alert" className="border-l-2 border-crimson bg-crimson/10 px-4 py-3 text-sm text-red-200">
                    {t("backups.backupRequestRecoveryStorageIsUnavailableOrInvalidMutationsAre")}</p>
            )}
            {loadError && (
                <p role="status" className="border-l-2 border-gold/50 bg-gold/5 px-4 py-3 text-sm text-foreground-muted">
                    {loadError}
                </p>
            )}

            {shownJob !== null
                ? <BackupJobStatus job={shownJob} interruptsPlayers={interruptingJobIds.has(shownJob.jobId) || serverIsRunning} />
                : lastBackupAt !== null && !loadError && (
                    <p className="text-sm text-foreground-muted">{t("backups.lastBackupDate", { date: formatTime(lastBackupAt) })}</p>
                )}

            {statusIsStale && (
                <div className="flex flex-wrap items-center gap-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3 text-xs text-foreground-muted">
                    <p role="status">{t("backups.automaticStatusUpdatesHavePausedTheOperationMayStillBeRunning")}</p>
                    <button
                        type="button"
                        onClick={() => beginPolling(server.serverId, currentServer.updatedAt, activeJob?.jobId, "backup")}
                        className="min-h-9 border border-gold/35 px-3 text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                        {t("backups.refreshStatusAndResumeUpdates")}</button>
                </div>
            )}

            <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    {canManage ? (
                        <button
                            type="button"
                            disabled={
                                busy
                                || Boolean(loadError)
                                || retainedIntent !== null
                            }
                            onClick={submitCreateBackup}
                            className="inline-flex min-h-10 items-center justify-center gap-2 border border-gold/35 bg-gold/[0.07] px-3 font-label text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-gold transition-colors hover:border-gold/60 hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-foreground-dim"
                        >
                            <Archive aria-hidden="true" className={`size-3.5 ${pendingBackupId === "create" ? "animate-pulse" : ""}`} />
                            {pendingBackupId === "create" ? t("backups.submitting") : t("backups.createBackup")}
                        </button>
                    ) : (
                        <span className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-foreground-dim">
                            {t("backups.readOnlyAccess")}</span>
                    )}
                </div>
                <div aria-live="polite" className="max-w-2xl">
                    {showRetainedNotice && retainedIntent !== null ? (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3 text-xs leading-5 text-foreground-muted">
                            <div className="min-w-0 flex-1 space-y-1">
                                <p>{retainedIntent.action === "create-backup"
                                    ? t("backups.wereConfirmingYourBackupRequest")
                                    : t("backups.wereConfirmingYourRestoreRequest")}</p>
                                {controlFeedback && <p className="text-foreground">{controlFeedback.text}</p>}
                            </div>
                            <button
                                type="button"
                                disabled={isPending || !intentReady || storageError || !canManage || Boolean(loadError)}
                                onClick={retryPendingRequest}
                                className="inline-flex min-h-9 items-center justify-center border border-gold/35 bg-gold/[0.07] px-3 font-label text-[0.64rem] font-semibold uppercase tracking-[0.1em] text-gold transition-colors hover:border-gold/60 hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:border-white/10 disabled:text-foreground-dim"
                            >
                                {pending?.retry ? t("backups.reconciling") : t("backups.retryPendingRequest")}
                            </button>
                        </div>
                    ) : controlFeedback && (
                        <p className="mt-3 text-xs leading-5 text-foreground">{controlFeedback.text}</p>
                    )}
                </div>
            </div>

            {!loadError && (backups.length === 0 ? (
                <div className="border border-dashed border-white/10 px-4 py-8 text-center text-sm text-foreground-muted">
                    {t("backups.noRetainedBackupsAreAvailableYet")}</div>
            ) : (
                <>
                    {currentBackups.length > 0 && (
                        <ul className="divide-y divide-white/10 border border-white/10" aria-label={t("backups.retainedSaveBackups")}>
                            {currentBackups.map(renderBackup)}
                        </ul>
                    )}
                    {expiredBackups.length > 0 && (
                        <div>
                            <button
                                type="button"
                                aria-expanded={showExpired}
                                aria-controls={expiredListId}
                                onClick={() => setShowExpired(!showExpired)}
                                className="inline-flex min-h-10 items-center gap-2 text-sm text-foreground-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-gold"
                            >
                                <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${showExpired ? "rotate-180" : ""}`} />
                                {showExpired
                                    ? t("backups.hideExpiredBackups")
                                    : t("backups.showCountExpiredBackups", { count: expiredBackups.length })}
                            </button>
                            <ul id={expiredListId} hidden={!showExpired} className="mt-3 divide-y divide-white/10 border border-white/10" aria-label={t("backups.expiredBackups")}>
                                {showExpired && expiredBackups.map(renderBackup)}
                            </ul>
                        </div>
                    )}
                </>
            ))}
        </div>
    );
}

// Presents durable backup progress without translating external job output.
function BackupJobStatus({ job, interruptsPlayers }: { job: MyServerBackupJob; interruptsPlayers: boolean }) {
    const { t } = useTranslations("managed-server");
    const active = ACTIVE_BACKUP_JOB_STATES.has(job.state);
    const failed = job.state === "failed" || job.state === "cancelled";
    const message = active
        ? formatProgress(job, t)
        : job.state === "succeeded"
            ? job.action === "backup" ? t("backups.backupCompleted") : t("backups.saveRestoreCompleted")
            : job.action === "backup" ? t("backups.theBackupDidNotComplete") : t("backups.theSaveRestoreDidNotComplete");
    return (
        <div
            role={failed ? "alert" : "status"}
            className={`flex items-start gap-2 border-l-2 px-4 py-3 text-sm ${failed ? "border-crimson bg-crimson/10 text-red-200" : "border-gold bg-gold/[0.07] text-foreground-muted"}`}
        >
            {active && <LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin text-gold" />}
            <span>
                {message}
                {active && job.action === "backup" && interruptsPlayers && (
                    <span className="mt-1 block text-xs">{t("backups.theServerIsTemporarilyStoppedForThisBackup")}</span>
                )}
            </span>
        </div>
    );
}

// Renders a localized backup state with its existing severity styling.
function BackupState({ state }: { state: string }) {
    const { t } = useTranslations("managed-server");
    const positive = state === "available" || state === "restored";
    const negative = state === "failed" || state === "expired";
    return (
        <span className={`rounded-full border px-2 py-0.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em] ${
            positive
                ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                : negative
                    ? "border-red-400/25 bg-red-500/10 text-red-200"
                    : "border-gold/25 bg-gold/[0.07] text-gold"
        }`}>
            {formatBackupType(state, t)}
        </span>
    );
}

// Adds localized retry context to unchanged external progress.
function formatProgress(job: MyServerBackupJob, t: Translator["t"]) {
    if (job.state === "retry-wait") return t("backups.waitingToRetrySafelyProgress", { progress: job.progress });
    return job.progress;
}

// Localizes known backup labels and preserves unknown external codes.
function formatBackupType(value: string, t: Translator["t"]) {
    const known = new Set(["manual", "daily", "weekly", "automatic", "scheduled", "safety", "pre-update", "pre-import", "pre-restore", "manual-deletion", "role-removal", "final-deletion", "available", "restored", "failed", "expired", "queued", "restoring"]);
    if (known.has(value)) return t(`backupType.${value}`);
    return value.split(/[._-]/u).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

// Formats retained backup size using the selected locale.
function formatByteCount(value: number, number: Translator["number"], t: Translator["t"]) {
    if (value < 1_024) return t("bytes.b", { value: number(value) });
    if (value < 1_048_576) return t("bytes.kb", { value: number(value / 1_024, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
    if (value < 1_073_741_824) return t("bytes.mb", { value: number(value / 1_048_576, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
    return t("bytes.gb", { value: number(value / 1_073_741_824, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}
