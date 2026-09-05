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
