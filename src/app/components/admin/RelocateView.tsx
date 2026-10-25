"use client";

import { ArrowLeftRight, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Empty, State } from "@/app/components/admin/ControlPlanePresentation";
import { formatAccountOwner } from "@/app/lib/control-plane/presentation";
import {
    RELOCATION_JOB_ACTION,
    relocationRows,
    relocationTargets,
    type RelocationRegionOption,
    type RelocationRow,
} from "@/app/lib/control-plane/relocation";
import { requestControlPlaneAdminWithRefresh } from "@/app/lib/control-plane/stale-request";
import type { RelocateViewData } from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import type { WebsiteAccountSummary } from "@/app/lib/supabase/users";

const ANY_HOST = "";
const buttonClass = "inline-flex min-h-9 items-center gap-1.5 border px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-40";

/** Lists every server with the VPS slot it occupies; Relocate opens a pop-up so several moves can be queued from one page. */
export function RelocateView({ data, query, accounts }: { data: RelocateViewData; query: string; accounts: WebsiteAccountSummary[] }) {
    const { servers, inventory, regionCatalog, activeJobs } = data;
    const hosts = useMemo(() => Array.isArray(inventory.hosts) ? inventory.hosts : [], [inventory.hosts]);
    const rows = useMemo(() => relocationRows(servers.items, hosts, activeJobs), [servers.items, hosts, activeJobs]);
    const ownerLabels = useMemo(() => Object.fromEntries(accounts.map((user) => [user.accountId, user.label])), [accounts]);
    const [selected, setSelected] = useState<RelocationRow | null>(null);
    // Queued moves read as relocating straight away; the refreshed job list takes over once it arrives.
    const [queued, setQueued] = useState<ReadonlySet<string>>(new Set());

    return (
        <section className="mt-8">
            <form method="get" className="flex max-w-xl gap-2">
                <input type="hidden" name="view" value="relocate" />
                <input name="q" defaultValue={query} placeholder="Name, owner, server, VPS…" className="min-h-11 flex-1 border border-white/15 bg-surface px-3 text-sm text-foreground outline-none placeholder:text-foreground-dim focus:border-gold" />
                <button className="border border-crimson bg-crimson px-5 font-label text-xs font-semibold uppercase tracking-[0.12em] text-white">Search</button>
            </form>
            <div className="mt-6 overflow-x-auto border border-white/10 bg-surface">
                <table className="w-full min-w-200 text-left text-sm">
                    <thead className="border-b border-white/10 font-label text-[0.65rem] uppercase tracking-[0.12em] text-foreground-muted">
                        <tr><th className="p-4">Server</th><th className="p-4">State</th><th className="p-4">Region</th><th className="p-4">VPS</th><th className="p-4"><span className="sr-only">Relocate</span></th></tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">{rows.map((row) => {
                        const relocating = queued.has(row.server.serverId) || row.activeJob?.action === RELOCATION_JOB_ACTION;
                        const blockedBy = relocating ? null : row.activeJob;
                        const blockedReason = row.hostName === null ? "This server does not occupy a VPS slot."
                            : blockedBy !== null ? `Waiting for the ${blockedBy.action} job to finish.` : undefined;
                        return (
                            <tr key={row.server.serverId}>
                                <td className="p-4"><p className="font-semibold text-gold">{row.server.displayName}</p><p className="mt-1 text-xs text-foreground-muted">{formatAccountOwner(row.server, ownerLabels)}</p></td>
                                <td className="p-4">{relocating ? <span className="inline-flex border border-sky-400/30 bg-sky-400/10 px-2 py-1 font-label text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-sky-300">Relocating</span> : <State value={row.server.operationState} desiredState={row.server.desiredState} />}</td>
                                <td className="p-4 text-sm text-foreground">{row.regionLabel}</td>
                                <td className="p-4 font-mono text-xs text-foreground-muted">{row.hostName === null ? "—" : `${row.hostName} · slot ${row.slotIndex}`}</td>
                                <td className="p-4 text-right">
                                    <button
                                        type="button"
                                        disabled={relocating || blockedReason !== undefined}
                                        title={blockedReason}
                                        onClick={() => setSelected(row)}
                                        className={`${buttonClass} border-gold/40 text-gold hover:bg-gold/10`}
                                    >
                                        <ArrowLeftRight aria-hidden="true" className="size-3.5" /> Relocate
                                    </button>
                                </td>
                            </tr>
                        );
                    })}</tbody>
                </table>
                {rows.length === 0 && <Empty>No managed servers match this filter.</Empty>}
            </div>
            {selected !== null && (
                <RelocateDialog
                    key={selected.server.serverId}
                    row={selected}
                    targets={relocationTargets(hosts, regionCatalog, selected.hostName)}
                    onClose={() => setSelected(null)}
                    onQueued={(serverId) => {
                        setQueued((current) => new Set(current).add(serverId));
                        setSelected(null);
                    }}
                />
            )}
        </section>
    );
}

/** The relocation pop-up; `preselected` opens it on a planned region and VPS, such as a placement-plan step. */
export function RelocateDialog({ row, targets, onClose, onQueued, preselected, reason, children }: {
    row: RelocationRow;
    targets: RelocationRegionOption[];
    onClose: () => void;
    onQueued: (serverId: string) => void;
    preselected?: { region: string; serviceName: string };
    /** Audit reason sent with the request; the control plane's default applies when omitted. */
    reason?: string;
    /** Extra context shown above the warning. */
    children?: ReactNode;
}) {
    const router = useRouter();
    const dialogRef = useRef<HTMLDialogElement>(null);
    // One request id per pop-up, so a repeated click replays the same idempotent request.
    const [requestId] = useState(() => crypto.randomUUID());
    const [region, setRegion] = useState(() => (preselected !== undefined && targets.some((target) => target.region === preselected.region)
        ? preselected.region
        : targets.find((target) => target.freeSlots > 0)?.region) ?? "");
    const [host, setHost] = useState(() => preselected !== undefined && region === preselected.region
        && targets.find((target) => target.region === region)?.hosts.some((option) => option.name === preselected.serviceName)
        ? preselected.serviceName
        : ANY_HOST);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const target = targets.find((option) => option.region === region);
    const hostFull = host !== ANY_HOST && target?.hosts.find((option) => option.name === host)?.freeSlots === 0;
    const plannedHostMissing = preselected !== undefined && host === ANY_HOST && region === preselected.region
        && !target?.hosts.some((option) => option.name === preselected.serviceName);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog && !dialog.open) dialog.showModal();
    }, []);

    async function relocate() {
        if (target === undefined || target.freeSlots === 0 || hostFull) return;
        setPending(true);
        setError("");
        try {
            const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
            if (!session?.access_token) throw new Error("Authentication is required.");
            await requestControlPlaneAdminWithRefresh({
                accessToken: session.access_token,
                requestId,
                operation: "relocate-server",
                input: {
                    serverId: row.server.serverId,
                    expectedUpdatedAt: row.server.updatedAt,
                    targetRegion: target.region,
                    targetServiceName: host === ANY_HOST ? null : host,
                    ...(reason === undefined ? {} : { reason }),
                },
            }, () => router.refresh());
            onQueued(row.server.serverId);
            router.refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "The relocation could not be queued.");
        } finally {
            setPending(false);
        }
    }

    const selectClass = "mt-1.5 min-h-10 w-full border border-white/15 bg-background px-3 text-sm text-foreground outline-none focus:border-gold";
    return (
        <dialog
            ref={dialogRef}
            aria-labelledby="relocate-title"
            onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}
            className="fixed inset-0 m-auto max-h-[90svh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border border-gold/30 bg-surface-raised p-5 text-foreground shadow-2xl backdrop:bg-black/70 sm:p-6"
        >
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="font-label text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gold">Relocate server</p>
                    <h2 id="relocate-title" className="mt-2 font-display text-3xl font-semibold">{row.server.displayName}</h2>
                </div>
                <button type="button" aria-label="Close" disabled={pending} onClick={onClose} className="p-1 text-foreground-muted focus-visible:outline-gold"><X aria-hidden="true" className="size-5" /></button>
            </div>
            <p className="mt-4 text-sm text-foreground-muted">Currently on <span className="text-foreground">{row.regionLabel}</span> · <span className="font-mono text-xs">{row.hostName} · slot {row.slotIndex}</span></p>
            {targets.length === 0 ? <p className="mt-5 text-sm text-foreground-muted">There is no other VPS to move this server to.</p> : <div className="mt-5 space-y-4">
                <label className="block text-xs text-foreground-muted">Region
                    <select value={region} disabled={pending} onChange={(event) => { setRegion(event.target.value); setHost(ANY_HOST); }} className={selectClass}>
                        {region === "" && <option value="" disabled>Every region is full</option>}
                        {targets.map((option) => <option key={option.region} value={option.region} disabled={option.freeSlots === 0}>
                            {option.label}{option.freeSlots === 0 ? " (full)" : ""}
                        </option>)}
                    </select>
                </label>
                <label className="block text-xs text-foreground-muted">VPS
                    <select value={host} disabled={pending || target === undefined} onChange={(event) => setHost(event.target.value)} className={selectClass}>
                        <option value={ANY_HOST}>Any free slot</option>
                        {target?.hosts.map((option) => <option key={option.name} value={option.name} disabled={option.freeSlots === 0}>
                            {option.name} · {option.freeSlots === 0 ? "full" : `${option.freeSlots} free`}
                        </option>)}
                    </select>
                </label>
                {hostFull && <p className="text-sm text-amber-200">{host} has no free slot right now. Wait for earlier relocations to finish, then try again.</p>}
                {plannedHostMissing && <p className="text-sm text-amber-200">The planned VPS {preselected?.serviceName} is not offered for {target?.label ?? "this region"}. Choose a VPS.</p>}
                {children}
                <p className="text-sm text-amber-200">The server will be stopped and moved. Its IP address will change.</p>
            </div>}
            {error && <p role="alert" className="mt-4 text-sm text-red-200">{error}</p>}
            <div className="mt-6 flex justify-end gap-3 border-t border-white/10 pt-4">
                <button type="button" disabled={pending} onClick={onClose} className={`${buttonClass} border-white/15 text-foreground-muted hover:text-foreground`}>Cancel</button>
                <button type="button" disabled={pending || target === undefined || target.freeSlots === 0 || hostFull} onClick={relocate} className={`${buttonClass} border-crimson bg-crimson text-white`}>
                    {pending && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}{pending ? "Relocating" : "Relocate"}
                </button>
            </div>
        </dialog>
    );
}
