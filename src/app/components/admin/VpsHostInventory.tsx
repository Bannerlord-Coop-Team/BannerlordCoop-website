"use client";

import { LocalDateTime } from "@/app/components/admin/LocalDateTime";
import { RunnerOnboardingStatus } from "@/app/components/admin/RunnerOnboardingStatus";
import { formatDiscordOwner } from "@/app/lib/control-plane/presentation";
import { stateExplanation } from "@/app/lib/control-plane/explanations";
import type {
    HostingAdminHostResources,
    HostingAdminVpsHost,
    HostingServerResources,
} from "@/app/lib/control-plane/types";
import { AlertTriangle, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

type DiskPressure = {
    level: "normal" | "warning" | "critical";
    usedPercent: number;
};

type VpsHostInventoryProps = {
    hosts: HostingAdminVpsHost[];
    ownerLabels: Record<string, string>;
    runnerTargetSourceCommit: string | null;
};

const SUMMARY_GRID = "grid-cols-[12rem_9rem_15rem_12rem_8rem_12rem_3rem]";
const SLOT_GRID = "grid-cols-[10rem_20rem_11rem_13rem_8rem]";

export function VpsHostInventory({
    hosts,
    ownerLabels,
    runnerTargetSourceCommit,
}: VpsHostInventoryProps) {
    const [expandedHost, setExpandedHost] = useState<string | null>(null);
    const idPrefix = useId();

    if (hosts.length === 0) {
        return <div className="mt-6 border border-white/10 bg-surface px-6 py-12 text-center text-sm text-foreground-muted">No registered OVH VPS hosts.</div>;
    }

    return (
        <div className="mt-6 overflow-x-auto border border-white/10 bg-surface">
            <div role="table" aria-label="VPS host inventory" className="mx-auto w-max">
                <div role="rowgroup">
                    <div role="row" className={`grid ${SUMMARY_GRID} gap-x-4 border-b border-l-2 border-white/10 border-l-transparent px-4 py-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-foreground-muted`}>
                        <span role="columnheader">Host</span>
                        <span role="columnheader">Capacity</span>
                        <span role="columnheader">Slots</span>
                        <span role="columnheader">System</span>
                        <span role="columnheader">Billing</span>
                        <span role="columnheader">Runner</span>
                        <span role="columnheader" className="sr-only">Details</span>
                    </div>
                </div>
                <div role="presentation" className="divide-y divide-white/10">
                    {hosts.map((host, index) => {
                        const expanded = expandedHost === host.name;
                        const panelId = `${idPrefix}-host-${index}`;
                        const pressure = diskPressureLevel(host.resources);
                        return (
                            <section role="rowgroup"
                                key={host.name}
                                className={pressure?.level === "critical"
                                    ? "border-l-2 border-crimson"
                                    : pressure?.level === "warning"
                                        ? "border-l-2 border-amber-400"
                                        : "border-l-2 border-transparent"}
                            >
                                <div role="row" className={`grid ${SUMMARY_GRID} items-center gap-x-4 px-4 py-3 hover:bg-white/[0.025]`}>
                                    <div role="cell"><HostIdentity host={host} /></div>
                                    <div role="cell"><CapacitySummary host={host} /></div>
                                    <div role="cell"><SlotSummary host={host} ownerLabels={ownerLabels} /></div>
                                    <div role="cell"><SystemSummary resources={host.resources} /></div>
                                    <div role="cell"><p className="text-xs font-semibold text-foreground">{formatVpsCost(host.cost)}</p></div>
                                    <div role="cell"><RunnerOnboardingStatus
                                        compact
                                        serviceName={host.name}
                                        runningServers={host.runningServers}
                                        targetSourceCommit={runnerTargetSourceCommit}
                                        onboarding={host.runnerOnboarding}
                                        update={host.runnerUpdate ?? null}
                                    /></div>
                                    <div role="cell" className="justify-self-end"><button
                                        type="button"
                                        aria-expanded={expanded}
                                        aria-controls={panelId}
                                        aria-label={`${expanded ? "Collapse" : "Expand"} details for ${host.name}`}
                                        onClick={() => setExpandedHost(expanded ? null : host.name)}
                                        className="flex size-10 items-center justify-center border-l border-white/10 text-gold outline-none transition-colors hover:bg-gold/10 focus-visible:ring-2 focus-visible:ring-gold"
                                    >
                                        <ChevronDown aria-hidden="true" className={`size-5 transition-transform ${expanded ? "rotate-180" : "-rotate-90"}`} />
                                    </button></div>
                                </div>
                                {expanded && <ExpandedHost id={panelId} host={host} ownerLabels={ownerLabels} runnerTargetSourceCommit={runnerTargetSourceCommit} />}
                            </section>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export function diskPressureLevel(resources: HostingAdminHostResources | null): DiskPressure | null {
    if (!resources) return null;
    const { diskUsedBytes: used, diskFreeBytes: free, diskTotalBytes: total } = resources;
    if (![used, free, total].every((value) => Number.isSafeInteger(value) && value >= 0) || total === 0) return null;
    const usedPercent = Math.min(100, Math.floor((used / total) * 100));
    return {
        usedPercent,
        level: usedPercent >= 90 ? "critical" : usedPercent >= 80 ? "warning" : "normal",
    };
}

function HostIdentity({ host }: { host: HostingAdminVpsHost }) {
    return <div className="min-w-0"><p className="truncate font-mono text-xs text-foreground" title={host.name}>{host.name}</p><p className="mt-1 truncate text-xs text-foreground-muted" title={`${host.region} · ${host.locationId}`}>{host.region} · {host.locationId}</p></div>;
}

function CapacitySummary({ host }: { host: HostingAdminVpsHost }) {
    return <dl aria-label={`${host.totalSlots} total slots, ${host.runningServers} running, ${host.availableServers} free`} className="grid max-w-28 grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        <dt className="text-foreground-muted">Slots</dt><dd className="font-semibold text-foreground">{host.totalSlots}</dd>
        <dt className="text-foreground-muted">Running</dt><dd className="font-semibold text-foreground">{host.runningServers}</dd>
        <dt className="text-foreground-muted">Free</dt><dd className="font-semibold text-foreground">{host.availableServers}</dd>
    </dl>;
}

function SlotSummary({ host, ownerLabels }: { host: HostingAdminVpsHost; ownerLabels: Record<string, string> }) {
    const slots = Array.isArray(host.occupiedSlots) ? host.occupiedSlots : [];
    return <ul className="space-y-1 text-xs">
        {slots.map((slot) => {
            const ownerName = ownerLabels[slot.ownerDiscordUserId] ?? slot.ownerDiscordUserId;
            const label = `${ownerName} (${slot.displayName})`;
            return <li key={`${slot.slotIndex}:${slot.serverId}`} className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${slot.operationState === "running" ? "bg-emerald-400" : "bg-white/30"}`} /><Link href={`/admin/control-plane?view=server&serverId=${encodeURIComponent(slot.serverId)}`} className="truncate font-semibold text-foreground hover:text-gold hover:underline" title={label}>{label}</Link></li>;
        })}
        {host.availableServers > 0 && <li className="flex items-center gap-2 text-foreground-dim"><span aria-hidden="true" className="size-2 rounded-full bg-white/20" />{host.availableServers} available</li>}
    </ul>;
}

function SystemSummary({ resources }: { resources: HostingAdminHostResources | null }) {
    const pressure = diskPressureLevel(resources);
    if (!resources || !pressure) return <StateBadge value="unavailable" />;
    const alert = pressure.level !== "normal";
    const diskTone = pressure.level === "critical" ? "text-red-200" : pressure.level === "warning" ? "text-amber-300" : "text-foreground-muted";
    return <dl className="space-y-1 text-xs text-foreground-muted">
        <div className="flex gap-2"><dt>CPU</dt><dd>{resources.cpuPercent.toFixed(1)}%</dd></div>
        <div className="flex gap-2"><dt>Mem</dt><dd>{formatStorageBytes(resources.memoryUsedBytes)} / {formatStorageBytes(resources.memoryTotalBytes)}</dd></div>
        <div className={`flex items-center gap-2 ${diskTone}`} aria-label={`Disk ${pressure.level}: ${pressure.usedPercent}% used, ${formatStorageBytes(resources.diskFreeBytes)} free`}>
            {alert && <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />}
            <dt>Disk</dt><dd className={alert ? "font-semibold" : undefined}>{pressure.usedPercent}%{alert && ` · ${formatStorageBytes(resources.diskFreeBytes)} free`}</dd>
        </div>
    </dl>;
}

function ExpandedHost({ id, host, ownerLabels, runnerTargetSourceCommit }: { id: string; host: HostingAdminVpsHost; ownerLabels: Record<string, string>; runnerTargetSourceCommit: string | null }) {
    const slots = Array.isArray(host.occupiedSlots) ? host.occupiedSlots : [];
    return (
        <div role="row">
            <div id={id} role="cell" aria-colspan={7} className="border-t border-white/10 bg-black/10">
                <div role="region" aria-label={`Details for ${host.name}`}>
                    {slots.length > 0 ? <div role="table" aria-label={`Occupied slots for ${host.name}`}>
                        <div role="rowgroup">
                            <div role="row" className={`grid ${SLOT_GRID} justify-center gap-x-4 border-b border-white/10 px-6 py-2 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em] text-foreground-dim`}>
                                <span role="columnheader">Slot / UDP</span><span role="columnheader">Player / Server</span><span role="columnheader">CPU</span><span role="columnheader">Memory</span><span role="columnheader">Status</span>
                            </div>
                        </div>
                        <div role="rowgroup" className="divide-y divide-white/10">
                            {slots.map((slot) => <div role="row" key={`${slot.slotIndex}:${slot.serverId}`} className={`grid ${SLOT_GRID} items-center justify-center gap-x-4 px-6 py-2.5 text-xs`}>
                                <div role="cell"><p className="font-label font-semibold uppercase tracking-[0.08em] text-gold">Slot {slot.slotIndex + 1} · UDP {slot.gamePort}</p></div>
                                <div role="cell" className="min-w-0"><p className="truncate font-semibold text-foreground" title={formatDiscordOwner(ownerLabels[slot.ownerDiscordUserId], slot.ownerDiscordUserId)}>{formatDiscordOwner(ownerLabels[slot.ownerDiscordUserId], slot.ownerDiscordUserId)}</p><Link href={`/admin/control-plane?view=server&serverId=${encodeURIComponent(slot.serverId)}`} className="block truncate font-mono text-[0.62rem] text-foreground-muted hover:text-gold hover:underline" title={slot.displayName}>{slot.displayName}</Link></div>
                                <div role="cell"><p className="text-foreground-muted">{formatCpu(slot.resources)}</p></div>
                                <div role="cell"><p className="text-foreground-muted">{formatMemory(slot.resources)}</p></div>
                                <div role="cell"><StateBadge value={slot.operationState} /></div>
                            </div>)}
                        </div>
                    </div> : <p className="px-6 py-4 text-xs text-foreground-muted">No occupied slots.</p>}
                    <HostDetailFooter host={host} runnerTargetSourceCommit={runnerTargetSourceCommit} />
                </div>
            </div>
        </div>
    );
}

function HostDetailFooter({ host, runnerTargetSourceCommit }: { host: HostingAdminVpsHost; runnerTargetSourceCommit: string | null }) {
    const resources = host.resources;
    const runnerSource = host.runnerOnboarding?.sourceCommit;
    const latestUpdate = host.runnerUpdate;
    return <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 px-6 py-2.5 text-[0.68rem] text-foreground-muted">
        {resources && <>
            <span>Disk {formatStorageBytes(resources.diskUsedBytes)} used / {formatStorageBytes(resources.diskFreeBytes)} free</span>
            <span>Uptime {formatUptime(resources.uptimeSeconds)}</span>
            <span>Observed <LocalDateTime value={resources.observedAt} /></span>
        </>}
        <span>Expires <LocalDateTime value={host.expirationDate} empty="Unknown" /></span>
        <span>Auto-renew {host.autoRenew === true ? "enabled" : host.autoRenew === false ? "disabled" : "unknown"}</span>
        {runnerSource && <span title={runnerSource}>Runner {runnerSource.slice(0, 12)}</span>}
        {runnerTargetSourceCommit && <span title={runnerTargetSourceCommit}>Target {runnerTargetSourceCommit.slice(0, 12)}</span>}
        {latestUpdate && <span title={`${latestUpdate.priorSourceCommit} → ${latestUpdate.targetSourceCommit}`}>Latest update {latestUpdate.state} · {humanize(latestUpdate.progressStage)} · {latestUpdate.priorSourceCommit.slice(0, 8)} → {latestUpdate.targetSourceCommit.slice(0, 8)}{latestUpdate.errorCode ? ` · ${latestUpdate.errorCode}` : ""}</span>}
    </div>;
}

function StateBadge({ value }: { value: string }) {
    const good = ["running", "succeeded", "validated", "available", "healthy"].includes(value);
    const bad = ["failed", "degraded", "revoked", "rejected", "cancelled", "unavailable"].includes(value);
    const explanation = stateExplanation(value);
    return <span title={explanation} aria-label={`${value}: ${explanation}`} className={`inline-flex w-fit cursor-help border px-2 py-1 font-label text-[0.58rem] font-semibold uppercase tracking-[0.08em] ${good ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : bad ? "border-crimson/30 bg-crimson/10 text-red-200" : "border-gold/25 bg-gold/8 text-gold"}`}>{value}</span>;
}

function formatVpsCost(cost: HostingAdminVpsHost["cost"]) {
    if (!cost) return "Unknown";
    const amount = new Intl.NumberFormat("en", { style: "currency", currency: cost.currencyCode }).format(cost.priceInMicrocents / 100_000_000);
    const cadence = cost.interval === 1 && cost.duration === "P1M" ? "month" : cost.interval === 1 && cost.duration === "P1Y" ? "year" : `${cost.interval} × ${cost.duration}`;
    return `${amount} / ${cadence}`;
}

function formatCpu(resources: HostingServerResources | null | undefined) {
    return resources ? `${resources.cpuVcpus.toFixed(2)} / ${resources.cpuLimitVcpus.toFixed(0)} vCPUs` : "Unavailable";
}

function formatMemory(resources: HostingServerResources | null | undefined) {
    return resources ? `${formatStorageBytes(resources.memoryUsedBytes)} / ${formatStorageBytes(resources.memoryLimitBytes)}` : "Unavailable";
}

function formatStorageBytes(value: number) {
    return value >= 1_073_741_824 ? `${(value / 1_073_741_824).toFixed(1)} GiB` : value >= 1_048_576 ? `${(value / 1_048_576).toFixed(1)} MiB` : `${Math.round(value / 1024)} KiB`;
}

function formatUptime(seconds: number) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

function humanize(value: string) {
    return value.replaceAll("-", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}
