"use client";

import { useTranslations } from "@/app/lib/localization/client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { CloudDownload, ScrollText, Wrench, type LucideIcon } from "lucide-react";
import { DownloadServerLogButton } from "./DownloadServerLogButton";
import { fileButtonClass } from "./server-file-styles";
import { WorkspaceCard, workspaceListClass } from "./server-workspace-ui";

type MaintenanceSlot = { slot: HTMLElement | null; setSlot: (slot: HTMLElement | null) => void };

/** Undefined outside a maintenance provider; otherwise the update row's mount point, null until it renders. */
const MaintenanceSlotContext = createContext<MaintenanceSlot | undefined>(undefined);

/** Shares the Maintenance card's update slot between the lifecycle controls and the Save & config tab. */
export function ManagedServerMaintenanceProvider({ children }: { children: ReactNode }) {
    const [slot, setSlot] = useState<HTMLElement | null>(null);
    return <MaintenanceSlotContext.Provider value={{ slot, setSlot }}>{children}</MaintenanceSlotContext.Provider>;
}

/** Where Update now renders: the Maintenance card's slot, null until it mounts, undefined when there is no card. */
export function useMaintenanceUpdateSlot() {
    return useContext(MaintenanceSlotContext)?.slot;
}

/** Collects the server's rare housekeeping actions, the release update and the log download, in one card. */
export function ManagedServerMaintenance({ serverId, userId, canUpdate, releaseChannel }: {
    serverId: string; userId: string; canUpdate: boolean; releaseChannel?: string;
}) {
    const { t } = useTranslations("managed-server");
    const setSlot = useContext(MaintenanceSlotContext)?.setSlot;
    const channel = releaseChannel === "nightly" ? t("settingsPanel.nightly") : t("settingsPanel.stable");
    return <WorkspaceCard headingId="server-maintenance-heading" title={t("maintenance.title")} icon={Wrench}>
        <ul className={workspaceListClass}>
            {canUpdate && <MaintenanceRow icon={CloudDownload} title={t("maintenance.update")} description={t("maintenance.updateDescription", { channel })}
                action={<div ref={setSlot} className="flex flex-col items-start gap-2 sm:items-end" />} />}
            <MaintenanceRow icon={ScrollText} title={t("maintenance.log")} description={t("maintenance.logDescription")}
                action={<DownloadServerLogButton serverId={serverId} userId={userId} className={fileButtonClass} />} />
        </ul>
    </WorkspaceCard>;
}

/** Lays out one maintenance action: an icon tile and its name and purpose, with the action on the right. */
function MaintenanceRow({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action: ReactNode }) {
    return <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-gold/25 bg-gold/10 text-gold"><Icon className="size-4" /></span>
            <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="mt-0.5 text-sm leading-6 text-foreground-muted">{description}</p>
            </div>
        </div>
        {/* On narrow screens the action sits under the text, lined up with it rather than the icon. */}
        <div className="shrink-0 pl-12 sm:max-w-xs sm:pl-0">{action}</div>
    </li>;
}
