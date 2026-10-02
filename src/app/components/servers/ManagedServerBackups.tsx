"use client";

import { useTranslations } from "@/app/lib/localization/client";
import type { Translator } from "@/app/lib/localization/types";


import {
    canManageServerBackups,
    canRequestServerBackupRestore,
    restoreDisabledReason,
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
import { Archive, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

const ACTIVE_JOB_STATES = new Set(["queued", "running", "retry-wait"]);
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
    const restoreMessages = { expired: t("backupReason.expired"), inProgress: t("backupReason.inProgress"), installedBuildUnknown: t("backupReason.installedBuildUnknown"), backupBuildUnknown: t("backupReason.backupBuildUnknown"), buildMismatch: t("backupReason.buildMismatch"), unknown: t("backupReason.unknown") };
    const [intentReady, setIntentReady] = useState(false);
    const [storageError, setStorageError] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [pendingBackupId, setPendingBackupId] = useState<string | null>(null);
    const [retainedIntent, setRetainedIntent] = useState<ManagedServerBackupInput | null>(null);
    const [message, setMessage] = useState("");
    const retainedIntentRef = useRef<ManagedServerBackupInput | null>(null);
    const polledJobIds = useRef(new Set<string>());
    const {
        session: pollingSession,
        timedOutSession,
        attachJob,
        beginPolling,
        endPolling,
    } = useManagedServerPolling();
    const activeJob = status?.job && ACTIVE_JOB_STATES.has(status.job.state) ? status.job : null;
    const currentServer = status === null ? server : {
        ...server,
        operationState: status.operationState,
        observedGameState: status.observedGameState,
        updatedAt: status.updatedAt,
    };
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

    // Dispatches a retained backup request and reports its existing outcome.
    function submitIntent(intent: ManagedServerBackupInput, pendingId: string) {
        if (!canManage || loadError || !intentReady || storageError || isPending) return;
        // Persist before dispatch: the response or polling refresh can remove this component.
        if (!rememberIntent(intent)) return;
        setMessage("");
        setPendingBackupId(pendingId);
        startTransition(async () => {
            try {
                const result = await manageServerBackup(intent, userId);
                setMessage(result.message);
                if (result.ok) {
                    rememberIntent(null, intent);
                    polledJobIds.current.add(result.jobId);
                    beginPolling(server.serverId, intent.expectedUpdatedAt, result.jobId, "backup");
                } else if (result.retrySameRequest) {
                    beginPolling(server.serverId, intent.expectedUpdatedAt, undefined, "backup");
                } else {
                    rememberIntent(null, intent);
                }
            } catch {
                setMessage(t("backups.theSubmissionOutcomeCouldNotBeConfirmedRetryThisRequest"));
                beginPolling(server.serverId, intent.expectedUpdatedAt, undefined, "backup");
            } finally {
                setPendingBackupId(null);
            }
        });
    }

    // Creates a backup intent only when no request needs reconciliation.
    function submitCreateBackup() {
        if (retainedIntentRef.current !== null) return;
        const candidate: ManagedServerBackupInput = {
            serverId: server.serverId,
            action: "create-backup",
            expectedUpdatedAt: currentServer.updatedAt,
            requestId: crypto.randomUUID(),
        };
        submitIntent(
            retainManagedServerBackupIntent(retainedIntentRef.current, candidate),
            "create",
        );
    }

    // Confirms destructive save restoration before retaining its request.
    function submitRestore(backup: MyServerBackupSummary) {
        if (retainedIntentRef.current !== null) return;
        const createdAt = date(backup.createdAt, { dateStyle: "medium", timeStyle: "short" });
        const wasRunning = currentServer.observedGameState === "running"
            || currentServer.operationState === "running";
        if (!window.confirm([
            t("backups.restoreTheSaveFromCreatedat", { createdAt: createdAt }),
            t("backups.currentCampaignProgressWillBeReplacedHostingWillFirstSave"),
            wasRunning
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
        submitIntent(intent, intent.action === "create-backup" ? "create" : intent.backupId);
    }

    return (
        <div className="mt-5 space-y-4">
            {storageError && (
                <p role="alert" className="border-l-2 border-crimson bg-crimson/10 px-4 py-3 text-sm text-red-200">
                    {t("backups.backupRequestRecoveryStorageIsUnavailableOrInvalidMutationsAre")}</p>
            )}
            {loadError && (
                <p role="alert" className="border-l-2 border-crimson bg-crimson/10 px-4 py-3 text-sm text-red-200">
                    {loadError}
                </p>
            )}

            {status?.job && <BackupJobStatus job={status.job} />}

            {statusIsStale && (
                <div className="flex flex-wrap items-center gap-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3 text-xs text-foreground-muted">
                    <p role="status">{t("backups.automaticStatusUpdatesPausedAfterOneMinuteTheOperationMay")}</p>
                    <button
                        type="button"
                        onClick={() => beginPolling(server.serverId, currentServer.updatedAt, activeJob?.jobId, "backup")}
                        className="min-h-9 border border-gold/35 px-3 text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                        {t("backups.refreshStatusAndResumeUpdates")}</button>
                </div>
            )}

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

            {!loadError && (backups.length === 0 ? (
                <div className="border border-dashed border-white/10 px-4 py-8 text-center text-sm text-foreground-muted">
                    {t("backups.noRetainedBackupsAreAvailableYet")}</div>
            ) : (
                <ul className="divide-y divide-white/10 border border-white/10" aria-label={t("backups.retainedSaveBackups")}>
                    {backups.map((backup) => {
                        const canRestore = canManage && canRequestServerBackupRestore(backup);
                        const isRestoring = pendingBackupId === backup.backupId;
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
                                        <time dateTime={backup.createdAt}>{date(backup.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time>
                                        <span aria-hidden="true"> · </span>
                                        {formatByteCount(backup.byteSize, number, t)}
                                    </p>
                                    <p className="mt-1 text-xs text-foreground-dim">
                                        {t("backups.retainedUntilDate", { date: date(backup.retentionExpiresAt, { dateStyle: "medium", timeStyle: "short" }) })}
                                    </p>
                                    {backup.restoredAt !== null && (
                                        <p className="mt-1 text-xs text-foreground-dim">
                                            {t("backups.lastRestoredDate", { date: date(backup.restoredAt, { dateStyle: "medium", timeStyle: "short" }) })}
                                        </p>
                                    )}
                                    {restoreDisabledReason(backup, restoreMessages) && (
                                        <p className="mt-1 text-xs text-foreground-dim">
                                            {restoreDisabledReason(backup, restoreMessages)}
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
                                            : restoreDisabledReason(backup, restoreMessages)}
                                        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-red-400/40 bg-red-500/[0.06] px-3 font-label text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-red-200 transition-colors hover:border-red-300/60 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-foreground-dim"
                                    >
                                        <RotateCcw aria-hidden="true" className={`size-3.5 ${isRestoring ? "animate-pulse" : ""}`} />
                                        {isRestoring ? t("backups.submitting") : t("backups.restoreSave")}
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            ))}

            {retainedIntent !== null && (
                <div className="flex max-w-2xl flex-wrap items-center justify-between gap-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3 text-xs leading-5 text-foreground-muted">
                    <p role="status">
                        {t("backups.thisRequestHasAnUnconfirmedOutcomeItsExactRequestId")}</p>
                    <button
                        type="button"
                        disabled={isPending || !intentReady || storageError || !canManage || Boolean(loadError)}
                        onClick={retryPendingRequest}
                        className="inline-flex min-h-9 items-center justify-center border border-gold/35 bg-gold/[0.07] px-3 font-label text-[0.64rem] font-semibold uppercase tracking-[0.1em] text-gold transition-colors hover:border-gold/60 hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:border-white/10 disabled:text-foreground-dim"
                    >
                        {isPending ? t("backups.reconciling") : t("backups.retryPendingRequest")}
                    </button>
                </div>
            )}

            {message && (
                <p aria-live="polite" className="max-w-2xl text-xs leading-5 text-foreground-muted">
                    {message}
                </p>
            )}
        </div>
    );
}

// Presents durable backup progress without translating external job output.
function BackupJobStatus({ job }: { job: MyServerBackupJob }) {
    const { t } = useTranslations("managed-server");
    const active = ACTIVE_JOB_STATES.has(job.state);
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
            <span>{message}</span>
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
    const known = new Set(["manual", "automatic", "scheduled", "safety", "pre-update", "pre-restore", "available", "restored", "failed", "expired", "queued", "restoring"]);
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
