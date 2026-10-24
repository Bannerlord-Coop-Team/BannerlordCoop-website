"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { Database } from "lucide-react";
import { ServerSaveConfigPanels } from "./ServerSaveConfigPanels";
import { ManagedServerBackups, type ManagedServerAutosaves } from "./ManagedServerBackups";
import { ManagedServerTransfers } from "./ManagedServerTransfers";
import { ManagedServerCampaigns } from "./ManagedServerCampaigns";
import { ServerWorkspacePanel } from "./ServerManagementWorkspace";
import { WorkspaceCard } from "./server-workspace-ui";
import { ManagedServerMaintenance } from "./ManagedServerMaintenance";
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
    const readOnly = <p className="text-sm leading-6 text-foreground-muted">{t("files.filesBackupHistoryAndSaveRestoreRequireOwnerOrManager")}</p>;
    return <>
        <ServerWorkspacePanel section="Save & config">
            <section id="server-files" aria-label={t("files.saveConfig")}>
                {canManage
                    ? <ManagedServerTransfers userId={userId} serverId={server.serverId} serverName={server.displayName} status={files} canImportConfig={server.accessRole === "owner" && !server.subscriptionHold} canEditConfig={server.accessRole === "owner" && !server.subscriptionHold} canExportSave={server.accessRole === "owner"} subscriptionRescue={server.accessRole === "owner" && server.subscriptionHold?.canExportSave === true}
                        campaigns={<ManagedServerCampaigns userId={userId} serverId={server.serverId} status={files} canDelete={canManage} />} />
                    : <ServerSaveConfigPanels saveNotice={readOnly} configNotice={readOnly} />}
            </section>
            <ManagedServerMaintenance serverId={server.serverId} userId={userId} canUpdate={canManage} releaseChannel={server.releaseChannel} />
        </ServerWorkspacePanel>
        <ServerWorkspacePanel section="Backups">
            {canManage
                ? <ManagedServerBackups userId={userId} server={server} backups={backups} status={status} loadError={loadError} autosaves={autosaves} autosaveLoadError={autosaveLoadError} />
                : <WorkspaceCard id="server-backups" headingId="server-backups-heading" title={t("files.backupsAndRestore")} icon={Database}>{readOnly}</WorkspaceCard>}
        </ServerWorkspacePanel>
    </>;
}
