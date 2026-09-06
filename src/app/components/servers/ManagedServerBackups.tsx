"use client";

import { LocalDateTime } from "@/app/components/admin/LocalDateTime";
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
import { retainManagedServerBackupIntent } from "@/app/servers/managed-server-backup-intent";
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
    server: MyServerSummary;
    backups: readonly MyServerBackupSummary[];
    status: MyServerBackupStatus | null;
    loadError?: string;
};

export function ManagedServerBackups({
    server,
    backups,
    status,
    loadError,
}: ManagedServerBackupsProps) {
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

    const busy = isPending
        || (pollingSession !== null && retainedIntent === null)
        || activeJob !== null
        || TRANSITIONAL_SERVER_STATES.has(currentServer.operationState);

    function rememberIntent(intent: ManagedServerBackupInput | null) {
        retainedIntentRef.current = intent;
        setRetainedIntent(intent);
    }

    function submitIntent(intent: ManagedServerBackupInput, pendingId: string) {
        rememberIntent(intent);
        setMessage("");
        setPendingBackupId(pendingId);
        startTransition(async () => {
            try {
                const result = await manageServerBackup(intent);
                setMessage(result.message);
                if (result.ok) {
                    rememberIntent(null);
                    polledJobIds.current.add(result.jobId);
                    beginPolling(server.serverId, intent.expectedUpdatedAt, result.jobId, "backup");
                } else if (result.retrySameRequest) {
                    beginPolling(server.serverId, intent.expectedUpdatedAt, undefined, "backup");
                } else {
                    rememberIntent(null);
                }
            } catch {
                setMessage("The submission outcome could not be confirmed. Retry this request to reconcile it without creating a duplicate.");
                beginPolling(server.serverId, intent.expectedUpdatedAt, undefined, "backup");
            } finally {
                setPendingBackupId(null);
            }
        });
    }

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

    function submitRestore(backup: MyServerBackupSummary) {
        if (retainedIntentRef.current !== null) return;
        const createdAt = new Date(backup.createdAt).toLocaleString();
        const wasRunning = currentServer.observedGameState === "running"
            || currentServer.operationState === "running";
        if (!window.confirm([
            `Restore the save from ${createdAt}?`,
            "Current campaign progress will be replaced. Hosting will first save and safely stop the game, verify it is stopped, and create a safety backup.",
            wasRunning
                ? "Connected players will be interrupted. The prior running state will be restored only after the selected save validates."
                : "The server will remain stopped after the selected save validates.",
            "The installed game and mod versions will not change.",
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

    function retryPendingRequest() {
        const intent = retainedIntentRef.current;
        if (intent === null) return;
        submitIntent(intent, intent.action === "create-backup" ? "create" : intent.backupId);
    }

    return (
        <div className="mt-5 space-y-4">
            {loadError && (
                <p role="alert" className="border-l-2 border-crimson bg-crimson/10 px-4 py-3 text-sm text-red-200">
                    {loadError}
                </p>
            )}

            {status?.job && <BackupJobStatus job={status.job} />}

            {statusIsStale && (
                <div className="flex flex-wrap items-center gap-3 border-l-2 border-gold bg-gold/[0.07] px-4 py-3 text-xs text-foreground-muted">
                    <p role="status">Automatic status updates paused after one minute. The operation may still be running.</p>
                    <button
                        type="button"
                        onClick={() => beginPolling(server.serverId, currentServer.updatedAt, activeJob?.jobId, "backup")}
                        className="min-h-9 border border-gold/35 px-3 text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                        Refresh status and resume updates
                    </button>
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-2xl text-xs leading-5 text-foreground-muted">
                    Backups are retained off-host. Restoring replaces current campaign progress and never changes the installed game or mod version.
                </p>
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
                        {pendingBackupId === "create" ? "Submitting…" : "Create backup"}
                    </button>
                ) : (
                    <span className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-foreground-dim">
                        Read-only access
                    </span>
                )}
            </div>

            {!loadError && (backups.length === 0 ? (
                <div className="border border-dashed border-white/10 px-4 py-8 text-center text-sm text-foreground-muted">
                    No retained backups are available yet.
                </div>
            ) : (
                <ul className="divide-y divide-white/10 border border-white/10" aria-label="Retained save backups">
                    {backups.map((backup) => {
                        const canRestore = canManage && canRequestServerBackupRestore(backup);
                        const isRestoring = pendingBackupId === backup.backupId;
                        return (
                            <li key={backup.backupId} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-label text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                                            {formatBackupType(backup.backupType)}
                                        </p>
                                        <BackupState state={backup.restoreState} />
                                    </div>
                                    <p className="mt-2 text-sm text-foreground-muted">
                                        <LocalDateTime value={backup.createdAt} />
                                        <span aria-hidden="true"> · </span>
                                        {formatByteCount(backup.byteSize)}
                                    </p>
                                    <p className="mt-1 text-xs text-foreground-dim">
                                        Retained until <LocalDateTime value={backup.retentionExpiresAt} />
                                    </p>
                                    {backup.restoredAt !== null && (
                                        <p className="mt-1 text-xs text-foreground-dim">
                                            Last restored <LocalDateTime value={backup.restoredAt} />
                                        </p>
                                    )}
                                    {!backup.canRestore && ["available", "restored", "failed"].includes(backup.restoreState) && (
                                        <p className="mt-1 text-xs text-foreground-dim">
                                            {restoreDisabledReason(backup)}
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
                                            ? "Reconcile the pending backup request first."
                                            : restoreDisabledReason(backup)}
                                        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-red-400/40 bg-red-500/[0.06] px-3 font-label text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-red-200 transition-colors hover:border-red-300/60 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-foreground-dim"
                                    >
                                        <RotateCcw aria-hidden="true" className={`size-3.5 ${isRestoring ? "animate-pulse" : ""}`} />
                                        {isRestoring ? "Submitting…" : "Restore save"}
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
                        This request has an unconfirmed outcome. Its exact request ID and inputs are retained so reconciliation cannot create another request.
                    </p>
                    <button
                        type="button"
                        disabled={isPending}
                        onClick={retryPendingRequest}
                        className="inline-flex min-h-9 items-center justify-center border border-gold/35 bg-gold/[0.07] px-3 font-label text-[0.64rem] font-semibold uppercase tracking-[0.1em] text-gold transition-colors hover:border-gold/60 hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:border-white/10 disabled:text-foreground-dim"
                    >
                        {isPending ? "Reconciling…" : "Retry pending request"}
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

function BackupJobStatus({ job }: { job: MyServerBackupJob }) {
    const active = ACTIVE_JOB_STATES.has(job.state);
    const failed = job.state === "failed" || job.state === "cancelled";
    const message = active
        ? formatProgress(job)
        : job.state === "succeeded"
            ? job.action === "backup" ? "Backup completed." : "Save restore completed."
            : job.action === "backup" ? "The backup did not complete." : "The save restore did not complete.";
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

function BackupState({ state }: { state: string }) {
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
            {formatBackupType(state)}
        </span>
    );
}

function formatProgress(job: MyServerBackupJob) {
    if (job.state === "retry-wait") return `Waiting to retry safely. ${job.progress}`;
    return job.progress;
}

function formatBackupType(value: string) {
    return value
        .split(/[._-]/u)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function formatByteCount(value: number) {
    if (value < 1_024) return `${value} B`;
    if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
    if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
    return `${(value / 1_073_741_824).toFixed(1)} GB`;
}
