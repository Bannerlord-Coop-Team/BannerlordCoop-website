import type {
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

export function restoreDisabledReason(
    backup: Pick<MyServerBackupSummary, "canRestore" | "restoreState" | "restoreUnavailableReason">,
) {
    if (!backup.canRestore) {
        switch (backup.restoreUnavailableReason) {
            case "expired": return "This backup has expired and can no longer be restored.";
            case "restore_in_progress": return "This backup is already part of a restore operation. Wait for it to finish.";
            case "installed_build_unknown": return "The server's installed game/mod version has not been confirmed. Refresh after server setup or its current operation finishes.";
            case "backup_build_unknown": return "This backup has no recorded game/mod version, so compatibility cannot be checked. Choose a newer backup.";
            case "build_mismatch": return "This backup was created on a different game/mod build from the one currently installed. Save-only restore requires an exact build match; choose a backup from the current build.";
        }
    }
    if (backup.restoreState === "expired") return "This backup has expired and can no longer be restored.";
    if (backup.restoreState === "queued" || backup.restoreState === "restoring") {
        return "This backup is already part of a restore operation. Wait for it to finish.";
    }
    if (!backup.canRestore) return "The server did not provide a restore-blocking reason. Refresh to check again; contact support if no reason appears.";
    return undefined;
}
