import type { ManagedServerBackupInput } from "@/app/servers/managed-server-backup-input";

export function retainManagedServerBackupIntent(
    retained: ManagedServerBackupInput | null,
    candidate: ManagedServerBackupInput,
) {
    return retained ?? candidate;
}
