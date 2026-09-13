import { ManagedServerBackups } from "./ManagedServerBackups";
import { ManagedServerTransfers } from "./ManagedServerTransfers";
import type { MyServerBackupStatus, MyServerBackupSummary, MyServerSummary } from "@/app/lib/control-plane/types";
import type { OwnerFileStatus } from "../../../../supabase/functions/_shared/server-file-contract";

export function ManagedServerFiles({ userId, server, files, backups, status, loadError }: {
    userId: string; server: MyServerSummary; files: OwnerFileStatus | null;
    backups: readonly MyServerBackupSummary[]; status: MyServerBackupStatus | null; loadError?: string;
}) {
    const canManage = server.accessRole === "owner" || server.accessRole === "manager";
    return <section id="server-backups" aria-labelledby="server-files-heading" className="mt-6 rounded-sm border border-white/10 bg-surface p-5 sm:p-6">
        <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">Server files</p>
        <h2 id="server-files-heading" className="mt-2 font-display text-2xl font-semibold text-foreground sm:text-3xl">Saves, configs &amp; backups</h2>
        {canManage ? <>
            <ManagedServerTransfers userId={userId} serverId={server.serverId} status={files} canImportConfig={server.accessRole === "owner"} />
            <div className="mt-6 border-t border-white/10 pt-6">
                <h3 id="server-backups-heading" className="font-display text-2xl font-semibold text-foreground">Backups and restore</h3>
                <ManagedServerBackups userId={userId} server={server} backups={backups} status={status} loadError={loadError} />
            </div>
        </> : <p className="mt-3 text-sm leading-6 text-foreground-muted">Files, backup history and save restore require owner or manager access. Your current access remains read-only.</p>}
    </section>;
}
