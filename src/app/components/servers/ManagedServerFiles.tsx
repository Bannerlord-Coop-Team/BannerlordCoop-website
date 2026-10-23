"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { ServerSaveConfigPanels } from "./ServerSaveConfigPanels";
import { ManagedServerBackups, type ManagedServerAutosaves } from "./ManagedServerBackups";
import { ManagedServerTransfers } from "./ManagedServerTransfers";
import { ManagedServerCampaigns } from "./ManagedServerCampaigns";
import { ServerWorkspacePanel } from "./ServerManagementWorkspace";
import type { MyServerBackupStatus, MyServerBackupSummary, MyServerSavePage, MyServerSummary } from "@/app/lib/control-plane/types";
import type { OwnerFileStatus } from "../../../../supabase/functions/_shared/server-file-contract";

// Composes file and backup panels according to existing role permissions.
export function ManagedServerFiles({ userId, server, files, saves, backups, status, loadError, autosaves, autosaveLoadError }: {
    userId: string; server: MyServerSummary; files: OwnerFileStatus | null;
    backups: readonly MyServerBackupSummary[]; saves: MyServerSavePage | null; status: MyServerBackupStatus | null; loadError?: string;
    autosaves?: ManagedServerAutosaves | null; autosaveLoadError?: string;
}) {
    void saves;
    const { t } = useTranslations("managed-server");
    const canManage = server.accessRole === "owner" || server.accessRole === "manager";
    const readOnly = <p className="mt-3 text-sm leading-6 text-foreground-muted">{t("files.filesBackupHistoryAndSaveRestoreRequireOwnerOrManager")}</p>;
    return <>
        <ServerWorkspacePanel section="Save & config">
            <section id="server-files" aria-label={t("files.saveConfig")}>
                {canManage
                    ? <>
                        <ManagedServerCampaigns userId={userId} serverId={server.serverId} status={files} canDelete={canManage} />
                        <ManagedServerTransfers userId={userId} serverId={server.serverId} serverName={server.displayName} status={files} canImportConfig={server.accessRole === "owner" && !server.subscriptionHold} canEditConfig={server.accessRole === "owner" && !server.subscriptionHold} canExportSave={server.accessRole === "owner"} subscriptionRescue={server.accessRole === "owner" && server.subscriptionHold?.canExportSave === true} />
                    </>
                    : <ServerSaveConfigPanels saveNotice={readOnly} configNotice={readOnly} />}
            </section>
        </ServerWorkspacePanel>
        <ServerWorkspacePanel section="Backups">
            <section id="server-backups" aria-labelledby="server-backups-heading" className="rounded-lg border border-white/10 bg-surface p-5 sm:p-6">
                <h2 id="server-backups-heading" className="text-base font-semibold text-foreground">{t("files.backupsAndRestore")}</h2>
                {canManage
                    ? <ManagedServerBackups userId={userId} server={server} backups={backups} status={status} loadError={loadError} autosaves={autosaves} autosaveLoadError={autosaveLoadError} />
                    : readOnly}
            </section>
        </ServerWorkspacePanel>
    </>;
}
