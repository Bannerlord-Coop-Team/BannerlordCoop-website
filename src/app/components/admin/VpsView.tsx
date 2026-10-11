"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LocalDateTime } from "./LocalDateTime";
import { VpsInventoryBrowser } from "./VpsInventoryBrowser";
import { VpsSlotSummary } from "./VpsSlotSummary";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { stateExplanation } from "@/app/lib/control-plane/explanations";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";
import type { HostingAdminHostResources, HostingAdminRegionRequest, HostingAdminRegionRequestNotification, HostingAdminVpsInventory, HostingPage, VpsViewData } from "@/app/lib/control-plane/types";
import type { WebsiteAccountSummary } from "@/app/lib/supabase/users";

/** Shows registered VPS capacity, labelled by the stored region catalog, with live readings and region requests. */
export function VpsView({ inventory: initialInventory, regionCatalog, accounts }: VpsViewData & { accounts: WebsiteAccountSummary[] }) {
    const readings = useVpsReadings(initialInventory, "resources");
    const billing = useVpsReadings(initialInventory, "billing");
    const oracle = useVpsReadings(initialInventory, "oracle");
    const inventory = readings.result ?? initialInventory;
    const pending = readings.pending;
    const providerHosts = new Map(billing.result?.hosts.map(host => [host.name, host]));
    const hosts = inventory.hosts.map(host => {
        const provider = providerHosts.get(host.name);
        return { ...host, cost: provider?.cost ?? null, expirationDate: provider?.expirationDate ?? null,
            autoRenew: provider?.autoRenew ?? null, providerCheckedAt: provider?.providerCheckedAt ?? null };
    });
    const controlPlaneHost = oracle.result?.controlPlaneHost ?? null;
    const ownerLabels = new Map(accounts.map(account => [account.accountId, account.label]));
    const availableServiceNames = billing.result?.availableServiceNames ?? [];
    const runnerTargetSourceCommit = inventory.runnerTargetSourceCommit ?? null;
    const checkedAt = hosts.find((host) => host.providerCheckedAt)?.providerCheckedAt ?? null;
    return (
        <section className="mt-8">
            <SectionHeading eyebrow="OVHcloud inventory" title="VPS hosts" count={hosts.length} />
            <p className="mt-3 text-xs text-foreground-muted">
                Registered VPS capacity and server assignments. {billing.result && <>{availableServiceNames.length} authenticated OVH {availableServiceNames.length === 1 ? "VPS is" : "VPS products are"} available to onboard.</>}
                {checkedAt && <> Provider data checked <LocalDateTime value={checkedAt} />.</>}
            </p>
            {pending && <p role="status" className="mt-3 text-xs text-foreground-muted">Loading live resource readings…</p>}
            {readings.error && <p role="alert" className="mt-3 text-xs text-red-200">{readings.error} {readings.result ? "Showing the last resource readings; retrying automatically." : "Registered inventory remains visible; retrying automatically."} <button type="button" className="underline" onClick={readings.refreshReadings}>Retry live readings</button></p>}
            {billing.pending && <p role="status" className="mt-3 text-xs text-foreground-muted">Loading billing readings…</p>}
            {billing.error && <p role="alert" className="mt-3 text-xs text-red-200">Billing unavailable. {billing.error} {billing.result ? "Showing the last billing readings; retrying automatically." : "Retrying automatically."} <button type="button" className="underline" onClick={billing.refreshReadings}>Retry billing</button></p>}
            <VpsSlotSummary hosts={hosts} regionCatalog={regionCatalog} />
            <div className="mt-5 flex flex-col justify-between gap-3 border border-gold/25 bg-gold/8 p-4 sm:flex-row sm:items-center">
                <p className="text-xs leading-5 text-foreground-muted"><span className="font-semibold text-foreground">Adding capacity:</span> onboard an already-purchased OVH VPS. The durable workflow verifies account ownership, installs the reviewed runner, prepares every isolated slot, establishes private mTLS routes, and exposes capacity only after health proof.</p>
                <Link href="/admin/control-plane?view=operations#onboard-vps-host" className="shrink-0 border border-gold/40 px-4 py-2 font-label text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-gold hover:bg-gold/10">Onboard VPS</Link>
            </div>
            <div className="mt-6">
                {oracle.error && <p role="alert" className="mb-3 text-xs text-red-200">Oracle readings unavailable. {oracle.error} {oracle.result?.controlPlaneHost ? "Showing the last Oracle readings; retrying automatically." : "Retrying automatically."} <button type="button" className="underline" onClick={oracle.refreshReadings}>Retry Oracle readings</button></p>}
                <HostResourcesCard name="Oracle control plane" resources={controlPlaneHost} pending={oracle.pending} />
            </div>
            <VpsInventoryBrowser
                hosts={hosts}
                accounts={accounts}
                liveDataPending={pending}
                billingPending={billing.pending}
                billingUnavailable={!!billing.error && !billing.result}
                onRefresh={readings.refreshReadings}
                ownerLabels={Object.fromEntries(ownerLabels)}
                runnerTargetSourceCommit={runnerTargetSourceCommit}
                regionCatalog={regionCatalog}
            />
            <RegionRequestsPane accounts={accounts} />
        </section>
    );
}

function RegionRequestsPane({ accounts }: { accounts: WebsiteAccountSummary[] }) {
    const [requests, setRequests] = useState<HostingPage<HostingAdminRegionRequest> | null>(null);
    const [error, setError] = useState("");
    const [pendingRequest, setPendingRequest] = useState<string | null>(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
                if (!session?.access_token) throw new Error("Authentication is required.");
                const result = await requestControlPlaneAdmin<HostingPage<HostingAdminRegionRequest>>({
                    accessToken: session.access_token,
                    requestId: crypto.randomUUID(),
                    operation: "region-requests",
                    input: { cursor: null, limit: 100 },
                });
                if (!cancelled) {
                    setRequests(result);
                    setError("");
                }
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : "Region requests could not be loaded.");
            }
        }
        void load();
        return () => { cancelled = true; };
    }, [reload]);

    async function resolve(requestId: string, resolution: "fulfilled" | "dismissed") {
        if (pendingRequest !== null) return;
        setPendingRequest(requestId);
        setError("");
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            await requestControlPlaneAdmin({
                accessToken: session.access_token,
                requestId: crypto.randomUUID(),
                operation: "resolve-region-request",
                input: { requestId, resolution },
            });
            setRequests(current => current === null ? current : { ...current, items: current.items.filter(item => item.requestId !== requestId) });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "The region request could not be resolved.");
        } finally {
            setPendingRequest(null);
        }
    }

    // Emails the requester that their region has capacity, then marks the row notified.
    async function notify(requestId: string) {
        if (pendingRequest !== null) return;
        setPendingRequest(requestId);
        setError("");
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            const result = await requestControlPlaneAdmin<HostingAdminRegionRequestNotification>({
                accessToken: session.access_token,
                requestId: crypto.randomUUID(),
                operation: "notify-region-request",
                input: { requestId },
            });
            setRequests(current => current === null ? current : {
                ...current,
                items: current.items.map(item => item.requestId === requestId ? { ...item, notifiedAt: result.notifiedAt } : item),
            });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "The requester could not be notified.");
        } finally {
            setPendingRequest(null);
        }
    }

    return (
        <section className="mt-8 overflow-hidden border border-gold/30 bg-surface" aria-labelledby="pending-region-requests-heading">
            <div className="flex items-end justify-between gap-4 border-b border-white/10 px-5 py-4">
                <div>
                    <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">Admin queue</p>
                    <h2 id="pending-region-requests-heading" className="mt-1 font-display text-2xl font-semibold text-foreground">Pending region requests</h2>
                </div>
                <span className="font-display text-xl text-foreground-muted">{requests?.items.length ?? "…"}</span>
            </div>
            {error && <div role="alert" className="border-b border-crimson/40 bg-crimson/10 px-5 py-3 text-xs text-red-200">{error} <button type="button" className="ml-2 underline" onClick={() => setReload(value => value + 1)}>Retry</button></div>}
            {requests?.items.length === 0 && <p className="px-5 py-6 text-sm text-foreground-muted">No pending region requests.</p>}
            {requests && requests.items.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-190 text-left text-sm">
                        <thead className="border-b border-white/10 font-label text-[0.62rem] uppercase tracking-[0.12em] text-foreground-muted">
                            <tr><th className="p-4">Region</th><th className="p-4">Requester email</th><th className="p-4">Current allocation</th><th className="p-4">Requested</th><th className="p-4 text-right">Actions</th></tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                            {requests.items.map(request => (
                                <tr key={request.requestId}>
                                    <td className="p-4 font-semibold text-foreground">{hostingRegionLabel(request.region)}<span className="mt-1 block font-mono text-[0.62rem] font-normal text-foreground-dim">{request.requestId}</span></td>
                                    <td className="p-4 text-xs text-foreground-muted">
                                        {formatRequesterEmail(request, accounts)}
                                        {request.notifiedAt !== null && <span className="mt-1 block w-fit border border-gold/40 bg-gold/10 px-2 py-0.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em] text-gold">Notified <LocalDateTime value={request.notifiedAt} /></span>}
                                    </td>
                                    <td className="p-4 text-xs text-foreground-muted">{formatAllocatedRegions(request.allocatedRegions)}</td>
                                    <td className="p-4 text-xs text-foreground-muted"><LocalDateTime value={request.createdAt} /></td>
                                    <td className="p-4"><div className="flex justify-end gap-2">
                                        {request.notifiedAt === null && request.requesterEmail !== null && <button type="button" disabled={pendingRequest !== null} onClick={() => void notify(request.requestId)} className="min-h-9 border border-gold/40 px-3 font-label text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-gold hover:border-gold hover:bg-gold/10 disabled:cursor-wait disabled:opacity-50">Notify</button>}
                                        <button type="button" disabled={pendingRequest !== null} onClick={() => void resolve(request.requestId, "dismissed")} className="min-h-9 border border-white/20 px-3 font-label text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-foreground-muted hover:border-white/40 hover:text-foreground disabled:cursor-wait disabled:opacity-50">Dismiss</button>
                                    </div></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function formatRequesterEmail(request: HostingAdminRegionRequest, accounts: readonly WebsiteAccountSummary[]) {
    if (request.requesterEmail !== null) return request.requesterEmail;
    const principal = request.discordUserId.toLowerCase();
    return accounts.find(account => account.email !== null
        && (account.accountId.toLowerCase() === principal || account.discordUserId === request.discordUserId))?.email
        ?? "Email unavailable";
}

function formatAllocatedRegions(regions: readonly string[]) {
    if (regions.length === 0) return "—";
    return regions.map(hostingRegionLabel).join(", ");
}

function useVpsReadings(initialInventory: HostingAdminVpsInventory, kind: "resources" | "billing" | "oracle") {
    const [refresh, setRefresh] = useState<{ initial: HostingAdminVpsInventory; result?: HostingAdminVpsInventory; error?: string }>();
    const [attempt, setAttempt] = useState(0);
    const current = refresh?.initial === initialInventory ? refresh : undefined;
    const pending = initialInventory.liveDataIncluded === false && current === undefined;
    const refreshReadings = useCallback(() => setAttempt(value => value + 1), []);
    useEffect(() => {
        let cancelled = false;
        let inFlight = false;
        let timer: ReturnType<typeof setTimeout>;
        const interval = kind === "billing" ? 60_000 : 5_000;
        const controller = new AbortController();
        async function load() {
            if (cancelled || inFlight || document.visibilityState === "hidden") return;
            clearTimeout(timer);
            inFlight = true;
            const requestController = new AbortController();
            const deadline = kind !== "resources"
                ? setTimeout(() => requestController.abort(), kind === "oracle" ? 10_000 : 15_000) : undefined;
            try {
                const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
                if (cancelled) return;
                if (!session?.access_token) throw new Error("Authentication is required.");
                const signal = AbortSignal.any([controller.signal, requestController.signal]);
                const result = kind === "oracle"
                    ? { ...initialInventory, liveDataIncluded: true, controlPlaneHost:
                        await requestControlPlaneAdmin<HostingAdminHostResources | null>({ accessToken: session.access_token,
                            operation: "control-plane-host-resources", signal }) }
                    : await requestControlPlaneAdmin<HostingAdminVpsInventory>({ accessToken: session.access_token, operation: "vps-hosts",
                        input: { includeLiveData: kind === "resources", includeProviderInventory: kind === "billing" }, signal });
                if (result.liveDataIncluded !== (kind !== "billing")) throw new Error("Live VPS data is unavailable.");
                if (!cancelled) setRefresh({ initial: initialInventory, result });
            } catch (error) {
                if (!cancelled) setRefresh(previous => ({
                    initial: initialInventory,
                    result: previous?.initial === initialInventory ? previous.result
                        : initialInventory.liveDataIncluded !== false ? initialInventory : undefined,
                    error: requestController.signal.aborted ? `${kind === "oracle" ? "Oracle" : "Billing"} readings timed out.`
                        : error instanceof Error ? error.message : "VPS readings could not be loaded.",
                }));
            } finally {
                clearTimeout(deadline);
                inFlight = false;
                if (!cancelled) timer = setTimeout(() => void load(), interval);
            }
        }
        function visibilityChanged() {
            clearTimeout(timer);
            if (document.visibilityState !== "hidden") void load();
        }
        if (initialInventory.liveDataIncluded === false || attempt > 0) void load();
        else timer = setTimeout(() => void load(), interval);
        document.addEventListener("visibilitychange", visibilityChanged);
        return () => {
            cancelled = true;
            clearTimeout(timer);
            controller.abort();
            document.removeEventListener("visibilitychange", visibilityChanged);
        };
    }, [initialInventory, attempt, kind]);
    return { result: current?.result ?? (initialInventory.liveDataIncluded !== false ? initialInventory : undefined),
        error: current?.error, pending, refreshReadings };

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
