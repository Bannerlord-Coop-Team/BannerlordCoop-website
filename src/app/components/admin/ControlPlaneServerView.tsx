"use client";

import Link from "next/link";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { formatAccountOwner, releaseChannelLabel } from "@/app/lib/control-plane/presentation";
import type { ServerDashboardResult, ServerProgress } from "@/app/lib/control-plane/types";
import { serverProgressView, type ServerProgressView } from "@/app/lib/control-plane/server-progress";
import type { WebsiteAccountSummary } from "@/app/lib/supabase/users";
import { vpsProviderLabel } from "@/app/lib/control-plane/vps-providers";
import { ControlPlaneProgress, isActiveJob, useControlPlaneProgress } from "./ControlPlaneProgress";
import { Panel, Definition, State, RecordedRelease, SectionHeading, BackupsTable, AuditTable } from "./ControlPlanePresentation";

async function readServer(current: ServerProgressView, accessToken: string, signal: AbortSignal): Promise<ServerProgressView> {
    const input = { serverId: current.dashboard.server.serverId };
    const progress = await requestControlPlaneAdmin<ServerProgress>({ accessToken, signal, operation: "server-progress", input });
    // Hydrate composition and history once after completion, through the same fresh authority boundary.
    if (progress.activeJob === null && progress.server.softDeletedAt === null) {
        return serverProgressView(await requestControlPlaneAdmin<ServerDashboardResult>({ accessToken, signal, operation: "server-dashboard", input }));
    }
    return { ...current, dashboard: { ...current.dashboard,
        server: { ...current.dashboard.server, ...progress.server,
            operationState: progress.server.softDeletedAt === null ? progress.server.operationState : "deleted" }, activeJob: progress.activeJob } };
}
function active(value: ServerProgressView) {
    return value.dashboard.server.operationState !== "deleted" && value.dashboard.activeJob !== null && isActiveJob(value.dashboard.activeJob);
}
function fingerprint(value: ServerProgressView) {
    const { server, activeJob: job } = value.dashboard;
    return JSON.stringify([server.operationState, server.desiredState, server.observedVmState, server.observedGameState,
        job?.jobId, job?.state, job?.progressStage, job?.attemptCount, job?.errorCode]);
}

export function ControlPlaneServerView({ initial, accounts }: { initial: ServerProgressView; accounts: WebsiteAccountSummary[] }) {
    const progress = useControlPlaneProgress(initial, readServer, active, fingerprint);
    if (progress.value === null) return <ControlPlaneProgress active={false} error={progress.error} />;
    const result = progress.value;
    if (result.dashboard.server.operationState === "deleted") return <p className="mt-8" role="status">This server has been deleted.</p>;
    const { server } = result.dashboard;
    const pinnedBuild = [result.dashboard.installedBuild, result.dashboard.desiredBuild]
        .find(build => build?.buildId === server.pinnedBuildId) ?? null;
    const activeJob = result.dashboard.activeJob;
    const ownerLabels = Object.fromEntries(accounts.map(account => [account.accountId, account.label]));
    return (
        <div className="mt-8 space-y-8">
            <ControlPlaneProgress active={progress.active} error={progress.error} />
            <section className="flex flex-col justify-between gap-5 border border-white/10 bg-surface p-5 lg:flex-row lg:items-start">
                <div><p className="font-label text-[0.65rem] uppercase tracking-[0.14em] text-gold">Managed server</p><h2 className="mt-2 font-display text-3xl font-semibold text-foreground">{server.displayName}</h2><p className="mt-2 font-mono text-xs text-foreground-dim">{server.serverId}</p></div>
                <State value={server.operationState} desiredState={server.desiredState} />
            </section>
            {activeJob && (
                <section className="border border-gold/25 bg-gold/8 p-5" aria-live="polite">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                        <div>
                            <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-gold">Operation in progress</p>
                            <p className="mt-2 text-sm text-foreground"><span className="font-semibold">{activeJob.action}</span> · {activeJob.state}</p>
                            <p className="mt-1 font-mono text-xs text-foreground-muted">{activeJob.progressStage}</p>
                        </div>
                        <Link href={`/admin/control-plane?view=jobs&serverId=${encodeURIComponent(server.serverId)}`} className="border border-gold/35 px-4 py-2 text-center font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-gold hover:bg-gold/10">Track job</Link>
                    </div>
                </section>
            )}
            <section className="grid gap-6 lg:grid-cols-3">
                <Panel title="Ownership"><Definition label="Owner account" value={formatAccountOwner(server, ownerLabels)} /><Definition label="Region" value={hostingRegionLabel(server.friendlyRegion)} /><Definition label="Provider" value={vpsProviderLabel(server.provider)} /><Definition label="Resource" value={server.providerResourceId ?? "Unassigned"} /></Panel>
                <Panel title="Desired / observed"><Definition label="Desired" value={server.desiredState} /><Definition label="VM" value={server.observedVmState} /><Definition label="Game" value={server.observedGameState} /><Definition label="Agent" value={result.dashboard.runtime?.agentHealthy ? "Healthy" : "Unavailable"} tone={result.dashboard.runtime?.agentHealthy ? "ok" : "warning"} /></Panel>
                <Panel title="Composition"><Definition label="Channel" value={releaseChannelLabel(server.releaseChannel)} /><Definition label="Installed version" value={<RecordedRelease build={result.dashboard.installedBuild} buildId={server.installedBuildId} />} /><Definition label="Desired version" value={<RecordedRelease build={result.dashboard.desiredBuild} buildId={server.desiredBuildId} />} /><Definition label="Update policy" value={server.pinnedBuildId ? "Pinned version" : `Follow ${releaseChannelLabel(server.releaseChannel)} channel`} />{server.pinnedBuildId && <Definition label="Pinned version" value={<RecordedRelease build={pinnedBuild} buildId={server.pinnedBuildId} />} />}<Definition label="Save" value={result.dashboard.activeSave?.displayName ?? "Default bootstrap pending"} /></Panel>
            </section>
            <section><SectionHeading eyebrow="Recovery" title="Backups" count={result.backups.items.length} /><BackupsTable backups={result.backups.items} /></section>
            <section><SectionHeading eyebrow="Trace" title="Server audit" count={result.audit.items.length} /><AuditTable events={result.audit.items} /></section>
        </div>
    );
}
