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
    backup: Pick<MyServerBackupSummary, "canRestore" | "restoreState">,
) {
    if (backup.restoreState === "expired") return "This backup has expired.";
    if (backup.restoreState === "queued" || backup.restoreState === "restoring") {
        return "This backup is already part of a restore operation.";
    }
    // canRestore does not distinguish expiration from an incompatible installed build.
    if (!backup.canRestore) return "This backup is currently unavailable for save-only restore.";
    return undefined;
}
