"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LocalDateTime } from "./LocalDateTime";
import { VpsHostInventory } from "./VpsHostInventory";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { stateExplanation } from "@/app/lib/control-plane/explanations";
import type { HostingAdminHostResources, HostingAdminVpsInventory } from "@/app/lib/control-plane/types";
import type { WebsiteAccountSummary } from "@/app/lib/supabase/users";

export function VpsView({ inventory: initialInventory, accounts }: { inventory: HostingAdminVpsInventory; accounts: WebsiteAccountSummary[] }) {
    const [refresh, setRefresh] = useState<{ initial: HostingAdminVpsInventory; result?: HostingAdminVpsInventory; error?: string }>();
    const [attempt, setAttempt] = useState(0);
    const current = refresh?.initial === initialInventory ? refresh : undefined;
    const inventory = current?.result ?? initialInventory;
    const pending = initialInventory.liveDataIncluded === false && current === undefined;
    useEffect(() => {
        if (initialInventory.liveDataIncluded !== false) return;
        let cancelled = false;
        async function load() {
            try {
                const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
                if (!session?.access_token) throw new Error("Authentication is required.");
                const result = await requestControlPlaneAdmin<HostingAdminVpsInventory>({ accessToken: session.access_token, operation: "vps-hosts" });
                if (result.liveDataIncluded !== true) throw new Error("Live VPS data is unavailable.");
                if (!cancelled) setRefresh({ initial: initialInventory, result });
            } catch (error) {
                if (!cancelled) setRefresh({ initial: initialInventory, error: error instanceof Error ? error.message : "Live VPS data could not be loaded." });
            }
        }
        void load();
        return () => { cancelled = true; };
    }, [initialInventory, attempt]);
    const { controlPlaneHost, hosts } = inventory;
    const ownerLabels = new Map(accounts.map(account => [account.accountId, account.label]));
    const availableServiceNames = Array.isArray(inventory.availableServiceNames) ? inventory.availableServiceNames : [];
    const runnerTargetSourceCommit = inventory.runnerTargetSourceCommit ?? null;
    const checkedAt = hosts.find((host) => host.providerCheckedAt)?.providerCheckedAt ?? null;
    return (
        <section className="mt-8">
            <SectionHeading eyebrow="OVHcloud inventory" title="VPS hosts" count={hosts.length} />
            <p className="mt-3 text-xs text-foreground-muted">
                Registered VPS capacity and server assignments. {inventory.liveDataIncluded !== false && <>{availableServiceNames.length} authenticated OVH {availableServiceNames.length === 1 ? "VPS is" : "VPS products are"} available to onboard.</>}
                {checkedAt && <> Provider data checked <LocalDateTime value={checkedAt} />.</>}
            </p>
            {pending && <p role="status" className="mt-3 text-xs text-foreground-muted">Loading live resource and billing readings…</p>}
            {current?.error && <p role="alert" className="mt-3 text-xs text-red-200">{current.error} Registered inventory remains visible. <button type="button" className="underline" onClick={() => { setRefresh(undefined); setAttempt(value => value + 1); }}>Retry live readings</button></p>}
            <div className="mt-5 flex flex-col justify-between gap-3 border border-gold/25 bg-gold/8 p-4 sm:flex-row sm:items-center">
                <p className="text-xs leading-5 text-foreground-muted"><span className="font-semibold text-foreground">Adding capacity:</span> onboard an already-purchased OVH VPS. The durable workflow verifies account ownership, installs the reviewed runner, prepares every isolated slot, establishes private mTLS routes, and exposes capacity only after health proof.</p>
                <Link href="/admin/control-plane?view=operations#onboard-vps-host" className="shrink-0 border border-gold/40 px-4 py-2 font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-gold hover:bg-gold/10">Onboard VPS</Link>
            </div>
            <div className="mt-6">
                <HostResourcesCard name="Oracle control plane" resources={controlPlaneHost} pending={pending} />
            </div>
            <VpsHostInventory
                hosts={hosts}
                liveDataPending={pending}
                ownerLabels={Object.fromEntries(ownerLabels)}
                runnerTargetSourceCommit={runnerTargetSourceCommit}
            />
        </section>
    );
}

function HostResourcesCard({ name, resources, pending }: { name: string; resources: HostingAdminHostResources | null; pending: boolean }) {
    return (
        <section className="border border-white/10 bg-surface p-5">
            <div className="flex items-start justify-between gap-4">
                <div><p className="font-label text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-gold">System resources</p><h3 className="mt-1 break-all font-display text-xl font-semibold text-foreground">{name}</h3></div>
                <State value={resources ? "available" : pending ? "loading" : "unavailable"} />
            </div>
            {resources ? <dl className="mt-4 grid gap-x-5 sm:grid-cols-2">
                <Definition label="Disk" value={`${formatStorageBytes(resources.diskUsedBytes)} used · ${formatStorageBytes(resources.diskFreeBytes)} free`} help={`Total filesystem capacity: ${formatStorageBytes(resources.diskTotalBytes)}.`} />
                <Definition label="Memory" value={`${formatStorageBytes(resources.memoryUsedBytes)} / ${formatStorageBytes(resources.memoryTotalBytes)}`} help="Current host memory use and total physical memory." />
                <Definition label="CPU utilization" value={`${resources.cpuPercent.toFixed(1)}%`} help="CPU time used across all host CPUs during a short sample. Excludes idle time, I/O waits and time taken by the hypervisor." />
                <Definition label="Uptime" value={formatUptime(resources.uptimeSeconds)} help="Elapsed host uptime at the observation time." />
                <Definition label="Observed" value={<LocalDateTime value={resources.observedAt} />} help="When the host supplied this bounded resource snapshot." />
            </dl> : <p className="mt-4 text-xs leading-5 text-foreground-muted">{pending ? "Loading current resource readings…" : "No current trusted resource observation is available."}</p>}
        </section>
    );
}

function Definition({ label, value, tone, help }: { label: string; value: React.ReactNode; tone?: "ok" | "warning"; help?: string }) { return <div className="flex items-start justify-between gap-4 py-3 text-xs"><dt className={`${help ? "cursor-help underline decoration-dotted underline-offset-4" : ""} text-foreground-muted`} title={help} aria-label={help ? `${label}: ${help}` : undefined}>{label}</dt><dd className={`max-w-[65%] break-words text-right font-medium ${tone === "ok" ? "text-emerald-300" : tone === "warning" ? "text-amber-300" : "text-foreground"}`}>{value}</dd></div>; }
function SectionHeading({ eyebrow, title, count }: { eyebrow: string; title: string; count: number }) { return <div className="flex items-end justify-between gap-4"><div><p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">{eyebrow}</p><h2 className="mt-1 font-display text-3xl font-semibold text-foreground">{title}</h2></div><span className="font-display text-xl text-foreground-muted">{count}</span></div>; }
function State({ value }: { value: string }) { const good = ["running", "succeeded", "validated", "available", "healthy"].includes(value); const bad = ["failed", "degraded", "revoked", "rejected", "cancelled", "unavailable"].includes(value); const explanation = stateExplanation(value); return <span title={explanation} aria-label={`${value}: ${explanation}`} className={`inline-flex cursor-help border px-2 py-1 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] ${good ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : bad ? "border-crimson/30 bg-crimson/10 text-red-200" : "border-gold/25 bg-gold/8 text-gold"}`}>{value}</span>; }
function formatBytes(value: number) { return value < 1_048_576 ? `${Math.round(value / 1024)} KiB` : `${(value / 1_048_576).toFixed(1)} MiB`; }
function formatStorageBytes(value: number) { return value >= 1_073_741_824 ? `${(value / 1_073_741_824).toFixed(1)} GiB` : formatBytes(value); }
function formatUptime(seconds: number) { const days = Math.floor(seconds / 86_400); const hours = Math.floor((seconds % 86_400) / 3_600); return days > 0 ? `${days}d ${hours}h` : `${hours}h`; }
