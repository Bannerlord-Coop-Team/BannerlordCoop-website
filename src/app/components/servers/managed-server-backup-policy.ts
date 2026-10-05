import type {
    MyServerBackupJob,
    MyServerBackupSummary,
    MyServerSummary,
} from "@/app/lib/control-plane/types";

const RESTORABLE_STATES = new Set(["available", "restored", "failed"]);

export function canManageServerBackups(accessRole: MyServerSummary["accessRole"]) {
    return accessRole === "owner" || accessRole === "manager";
}

export function canRequestServerBackupRestore(
    backup: Pick<MyServerBackupSummary, "canRestore" | "restoreState">,
) {
    return backup.canRestore && RESTORABLE_STATES.has(backup.restoreState);
}

const defaultRestoreMessages = {
    "expired": "This backup has expired and can no longer be restored.",
    "inProgress": "This backup is already part of a restore operation. Wait for it to finish.",
    "installedBuildUnknown": "The server's installed game/mod version has not been confirmed. Refresh after server setup or its current operation finishes.",
    "backupBuildUnknown": "This backup has no recorded game/mod version, so compatibility cannot be checked. Choose a newer backup.",
    "buildMismatch": "This backup was created on a different game/mod build from the one currently installed. Save-only restore requires an exact build match; choose a backup from the current build.",
    "unknown": "The server did not provide a restore-blocking reason. Refresh to check again; contact support if no reason appears."
};

// Reports the existing restore guard with optional injected website presentation.
export function restoreDisabledReason(
    backup: Pick<MyServerBackupSummary, "canRestore" | "restoreState" | "restoreUnavailableReason">,
    messages = defaultRestoreMessages,
) {
    if (!backup.canRestore) {
        switch (backup.restoreUnavailableReason) {
            case "expired": return messages.expired;
            case "restore_in_progress": return messages.inProgress;
            case "installed_build_unknown": return messages.installedBuildUnknown;
            case "backup_build_unknown": return messages.backupBuildUnknown;
            case "build_mismatch": return messages.buildMismatch;
        }
    }
    if (backup.restoreState === "expired") return messages.expired;
    if (backup.restoreState === "queued" || backup.restoreState === "restoring") {
        return messages.inProgress;
    }
    if (!backup.canRestore) return messages.unknown;
    return undefined;
}

export const ACTIVE_BACKUP_JOB_STATES: ReadonlySet<string> = new Set(["queued", "running", "retry-wait"]);

// Expired backups remain listed for reference but are collapsed behind the current history.
export function isExpiredServerBackup(
    backup: Pick<MyServerBackupSummary, "restoreState" | "restoreUnavailableReason">,
) {
    return backup.restoreState === "expired" || backup.restoreUnavailableReason === "expired";
}

// Splits backup history into current and expired groups, keeping the server's order in each.
export function partitionServerBackups<T extends Pick<MyServerBackupSummary, "restoreState" | "restoreUnavailableReason">>(
    backups: readonly T[],
) {
    const current: T[] = [];
    const expired: T[] = [];
    for (const backup of backups) (isExpiredServerBackup(backup) ? expired : current).push(backup);
    return { current, expired };
}

// Finds the newest backup timestamp for the neutral last-backup summary.
export function latestServerBackupAt(backups: readonly Pick<MyServerBackupSummary, "createdAt">[]) {
    let latest: string | null = null;
    let latestTime = Number.NEGATIVE_INFINITY;
    for (const backup of backups) {
        const time = Date.parse(backup.createdAt);
        if (Number.isFinite(time) && time > latestTime) {
            latest = backup.createdAt;
            latestTime = time;
        }
    }
    return latest;
}

// Always shows durable progress, but reports outcomes only for jobs requested or watched on this page.
export function visibleBackupJob<T extends Pick<MyServerBackupJob, "jobId" | "state">>(
    job: T | null | undefined,
    watchedJobIds: ReadonlySet<string>,
) {
    if (!job) return null;
    return ACTIVE_BACKUP_JOB_STATES.has(job.state) || watchedJobIds.has(job.jobId) ? job : null;
}
