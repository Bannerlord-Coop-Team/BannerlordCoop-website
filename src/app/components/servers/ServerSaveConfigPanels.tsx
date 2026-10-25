"use client";

import { useTranslations } from "@/app/lib/localization/client";

import type { ReactNode } from "react";
import { Download, Save, SlidersHorizontal, Upload } from "lucide-react";
import { ManagedServerConfigEditor, type ConfigAccess } from "./ManagedServerConfigEditor";
import { fileButtonClass } from "./server-file-styles";
import { WorkspaceCard } from "./server-workspace-ui";
import type { ManagedServerConfiguration } from "../../../../supabase/functions/_shared/managed-server-configuration";

export { fileButtonClass } from "./server-file-styles";

// Composes save and configuration panels with localized unavailable states.
export function ServerSaveConfigPanels({ saveName, campaigns, configuration, configAccess, saveActions, configActions, saveNotice, configNotice, configStatus }: {
    saveName?: string; campaigns?: ReactNode; configuration?: ManagedServerConfiguration; configAccess?: ConfigAccess; saveActions?: ReactNode; configActions?: ReactNode;
    saveNotice?: ReactNode; configNotice?: ReactNode; configStatus?: ReactNode;
}) {
    const { t } = useTranslations("managed-server");
    return <div className="space-y-5">
        <WorkspaceCard headingId="campaign-save-heading" title={campaigns ? t("campaigns.title") : t("saveConfigPanels.campaignSave")} icon={Save}
            description={campaigns && saveName && <span className="break-all font-mono">{saveName}</span>}
            actions={saveActions ?? <>
                <button disabled className={fileButtonClass}><Upload className="size-4" aria-hidden="true" />{t("saveConfigPanels.importSave")}</button>
                <button disabled className={fileButtonClass}><Download className="size-4" aria-hidden="true" />{t("saveConfigPanels.exportSave")}</button>
            </>}>
            <div className="space-y-3">
                {campaigns ?? <p className="break-all font-mono text-sm">{saveName ?? t("saveConfigPanels.campaignSaveUnavailable")}</p>}
                {saveNotice}
            </div>
        </WorkspaceCard>
        <WorkspaceCard headingId="configuration-heading" title={t("saveConfigPanels.configuration")} icon={SlidersHorizontal} flush
            description={t("saveConfigPanels.changesApplyOnNextStart")}
            actions={configActions ?? <>
                <button disabled className={fileButtonClass}><Upload className="size-4" aria-hidden="true" />{t("saveConfigPanels.importConfig")}</button>
                <button disabled className={fileButtonClass}><Download className="size-4" aria-hidden="true" />{t("saveConfigPanels.exportConfig")}</button>
            </>}>
            {/* Import and export feedback sits directly under the buttons that started it. */}
            {configStatus && <div className="px-5 empty:hidden">{configStatus}</div>}
            <ManagedServerConfigEditor configuration={configuration} access={configAccess} notice={configNotice} />
        </WorkspaceCard>
    </div>;
}
