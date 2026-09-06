import type { Backup } from "./types";

export function restorableBackups(backups: readonly Backup[], serverId: string, now: number): Backup[] {
    return backups.filter((backup) => backup.serverId === serverId
        && ["available", "restored", "failed"].includes(backup.restoreState)
        && Date.parse(backup.retentionExpiresAt) > now);
}

export function backupDescription(backup: Backup): string {
    const date = new Date(backup.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    return `${date} · ${backup.backupType.replaceAll("-", " ")} · ${(backup.byteSize / 1_048_576).toFixed(1)} MiB · ${backup.buildId ?? "Build not recorded"}`;
}
