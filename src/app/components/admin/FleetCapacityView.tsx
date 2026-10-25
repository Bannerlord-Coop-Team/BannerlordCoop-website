"use client";

import { ArrowUp, Equal, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Empty, SectionHeading } from "@/app/components/admin/ControlPlanePresentation";
import { LocalDateTime } from "@/app/components/admin/LocalDateTime";
import { MetricHint } from "@/app/components/admin/MetricHint";
import { SlotSizingView } from "@/app/components/admin/SlotSizingView";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import {
    atOnceLabel,
    burstHeadroomLabel,
    busyBand,
    busyCellLabel,
    busyStripSummary,
    capacityHourLabels,
    capacityVerdict,
    capacitySizeLabel,
    capacityWindowLabel,
    concurrentLabel,
    decodeHourly,
    demandSourceLabel,
    effectiveVcpuLabel,
    fleetCapacityDataNote,
    fleetCapacityErrorMessage,
    fleetCapacityHints,
    fleetCapacityHostGroups,
    fleetCapacityHostNote,
    fleetCapacityTypeLabel,
    fleetCapacityTypical,
    formatCores,
    formatCoresExact,
    formatGiB,
    formatMhz,
    formatPercent,
    formatServerHours,
    formatShare,
    HOST_METRICS_MISSING,
    hostMetricsMissing,
    knownMhz,
    limitedByLabel,
    occupantDemandLabel,
    perServerSourceLabel,
    parseFleetCapacity,
    staticRuleComparison,
    staticSlots,
    stealBand,
    stealCellLabel,
    stealFigures,
    stealStripSummary,
    type FleetCapacityHints,
} from "@/app/lib/control-plane/fleet-capacity";
import { vpsProviderLabel } from "@/app/lib/control-plane/vps-providers";
import { overlapDayAxisLabel, overlapDays } from "@/app/lib/control-plane/placement-measured-overlap";
import { shortServiceName } from "@/app/lib/control-plane/placement-live-moves";
import type {
    HostingAdminFleetCapacity,
    HostingFleetCapacityHost,
    HostingFleetCapacityInstanceType,
    HostingFleetCapacityStat,
} from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { HEATMAP_CLASSES, HEATMAP_NO_DATA } from "./placement-heatmap-classes";

const buttonClass = "inline-flex min-h-9 items-center gap-1.5 border border-white/15 px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-foreground-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
const paneClass = "border border-white/10 bg-surface p-5";
const tableHeadClass = "border-b border-white/10 font-label text-[0.62rem] uppercase tracking-[0.12em] text-foreground-muted";
const badgeClass = "inline-flex w-fit items-center gap-1 border px-2 py-0.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em]";
const VERDICT_CLASSES = {
    risk: "border-crimson/40 bg-crimson/10 text-red-200",
    headroom: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    match: "border-white/15 text-foreground-muted",
} as const;
const VERDICT_ROW_CLASSES = { risk: "border-l-crimson", headroom: "border-l-emerald-500/60", match: "border-l-transparent", unknown: "border-l-transparent" } as const;
type Days = ReturnType<typeof overlapDays>;

async function readCapacity(signal: AbortSignal): Promise<HostingAdminFleetCapacity> {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session?.access_token) throw new Error("Authentication is required.");
    const result = await requestControlPlaneAdmin<unknown>({
        accessToken: session.access_token,
        requestId: crypto.randomUUID(),
        operation: "fleet-capacity",
        input: {},
        signal,
    });
    const capacity = parseFleetCapacity(result);
    if (capacity === null) throw new Error("The control plane returned an unexpected fleet capacity.");
    return capacity;
}

type CapacityState =
    | { kind: "loading"; previous: HostingAdminFleetCapacity | null }
    | { kind: "ready"; capacity: HostingAdminFleetCapacity }
    | { kind: "error"; message: string; previous: HostingAdminFleetCapacity | null };

/**
 * What a server needs while it runs and how many servers each instance type and VPS could run at once, from the
 * control plane's measured week. It is read once when the tab opens and on Refresh, not polled: the control plane
 * allows each administrator six reads every five minutes.
 */
export function FleetCapacityView() {
    const [state, setState] = useState<CapacityState>({ kind: "loading", previous: null });
    const controller = useRef<AbortController | null>(null);

    const load = useCallback(async () => {
        // One read at a time: a Refresh while one is under way does nothing.
        if (controller.current !== null) return;
        const request = new AbortController();
        controller.current = request;
        setState((current) => ({ kind: "loading", previous: current.kind === "ready" ? current.capacity : current.previous }));
        try {
            const capacity = await readCapacity(request.signal);
            if (!request.signal.aborted) setState({ kind: "ready", capacity });
        } catch (cause) {
            if (!request.signal.aborted) {
                setState((current) => ({ kind: "error", message: fleetCapacityErrorMessage(cause), previous: current.kind === "loading" ? current.previous : null }));
            }
        } finally {
            if (controller.current === request) controller.current = null;
        }
    }, []);

    useEffect(() => {
        // Deferred to its own task, like the other reads a tab starts on opening.
        const timer = window.setTimeout(() => void load(), 0);
        return () => {
            window.clearTimeout(timer);
            controller.current?.abort();
            controller.current = null;
        };
    }, [load]);

    const capacity = state.kind === "ready" ? state.capacity : state.previous;
    const hints = useMemo(() => capacity === null ? null : fleetCapacityHints(capacity.model), [capacity]);
    // Too little data overall, and VPSs without host metrics, each get their own note.
    const notes = capacity === null ? [] : [fleetCapacityDataNote(capacity), fleetCapacityHostNote(capacity)].filter((note) => note !== null);
    return (
        <div className="mt-8 space-y-8">
            <section aria-label="Fleet capacity" className={paneClass}>
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="min-w-0 flex-1">
                        <SectionHeading eyebrow="Measured over the last 7 days" title="Fleet capacity" count={capacity?.hosts.length ?? 0} />
                    </div>
                    <button type="button" onClick={() => void load()} disabled={state.kind === "loading"} className={buttonClass}>
                        {state.kind === "loading" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}
                        Refresh
                    </button>
                </div>
                <p className="mt-2 max-w-3xl text-xs leading-5 text-foreground-muted">
                    How much CPU and memory a game server needs while it runs, how much CPU each VPS loses to other tenants, how many servers each instance type and VPS could run at once at those needs, from 5-minute samples, and how many slots each VPS is recommended. Nothing on this tab changes anything.
                </p>
                {state.kind === "loading" && <p role="status" className="mt-4 text-xs text-foreground-muted">Loading fleet capacity…</p>}
                {state.kind === "error" && (
                    <p role="alert" className="mt-4 border-l-2 border-crimson bg-crimson/10 px-3 py-2 text-xs text-red-200">
                        {state.message} <button type="button" className="ml-2 underline" onClick={() => void load()}>Retry</button>
                    </p>
                )}
                {notes.map((note) => <p key={note} className="mt-4 max-w-3xl border-l-2 border-gold/60 bg-gold/8 px-3 py-2 text-xs leading-5 text-foreground">{note}</p>)}
                {capacity !== null && (
                    <p className="mt-3 text-[0.65rem] text-foreground-dim">
                        Measured {capacityWindowLabel(capacity)} · {capacity.fleet.servers} {capacity.fleet.servers === 1 ? "server" : "servers"} on {capacity.fleet.hosts} {capacity.fleet.hosts === 1 ? "VPS" : "VPSs"} · generated <LocalDateTime value={capacity.generatedAt} />
                    </p>
                )}
            </section>
            {capacity !== null && hints !== null && <>
                <ServerNeeds capacity={capacity} hints={hints} />
                <ProvidersPane capacity={capacity} hints={hints} />
                <InstanceTypesPane capacity={capacity} hints={hints} />
            </>}
            {/* Its own read, budget and states, shown whatever the capacity read does, just above the VPSs' servers at once. */}
            <SlotSizingView />
            {capacity !== null && hints !== null && <HostsPane capacity={capacity} hints={hints} />}
        </div>
    );
}

/** A figure that has no data yet. */
function NoData() {
    return <span title="Not enough data yet" className="text-foreground-dim"><span aria-hidden="true">—</span><span className="sr-only">No data yet</span></span>;
}

function figure<T>(value: T | null | undefined, format: (value: T) => string): ReactNode {
    return value === null || value === undefined ? <NoData /> : format(value);
}

function PaneHeading({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
    return (
        <div>
            <p className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">{eyebrow}</p>
            <h2 id={id} className="mt-1 font-display text-3xl font-semibold text-foreground">{title}</h2>
        </div>
    );
}

function ServerNeeds({ capacity, hints }: { capacity: HostingAdminFleetCapacity; hints: FleetCapacityHints }) {
    const { demand } = capacity.fleet;
    const cpu = demand.cpuCores;
    const memory = demand.memoryBytes;
    const tiles: Array<{ label: string; hint: string; value: ReactNode }> = [
        { label: "CPU p50", hint: `${hints.cpu} ${hints.cpuP50}`, value: figure(cpu?.p50, formatCores) },
        { label: "CPU p95", hint: `${hints.cpu} ${hints.cpuP95}`, value: figure(cpu?.p95, formatCores) },
        { label: "CPU max", hint: `${hints.cpu} ${hints.cpuMax}`, value: figure(cpu?.max, formatCores) },
        { label: "Running server-hours", hint: hints.runningHours, value: formatServerHours(demand.runningServerHours) },
        { label: "Memory p50", hint: `${hints.memory} ${hints.p50}`, value: figure(memory?.p50, formatGiB) },
        { label: memory?.p99 === undefined ? "Memory p95" : "Memory p99", hint: `${hints.memory} ${hints.p95}`, value: figure(memory?.p99 ?? memory?.p95, formatGiB) },
        { label: "Memory max", hint: `${hints.memory} ${hints.max}`, value: figure(memory?.max, formatGiB) },
        { label: "Throttled", hint: hints.throttled, value: figure(demand.throttledShare, formatShare) },
    ];
    return (
        <section aria-labelledby="capacity-needs-heading" className={paneClass}>
            <PaneHeading eyebrow="Per server while running, across the fleet" title="What a server needs" id="capacity-needs-heading" />
            <dl className="mt-4 grid grid-cols-2 gap-px border border-white/10 bg-white/10 lg:grid-cols-4">
                {tiles.map((tile) => (
                    <div key={tile.label} className="flex flex-col-reverse bg-surface px-5 py-4">
                        <dt className="mt-1 text-xs text-foreground-muted"><MetricHint label={tile.label} hint={tile.hint} /></dt>
                        <dd className="font-display text-2xl text-foreground">{tile.value}</dd>
                    </div>
                ))}
            </dl>
            <p className="mt-3 text-xs leading-5 text-foreground-muted">{staticRuleComparison(capacity)}</p>
        </section>
    );
}

function StealCells({ steal, typical }: { steal: HostingFleetCapacityStat | null; typical: boolean }) {
    return <>
        <td className="p-3 text-right font-mono">{figure(typical ? steal?.p50 : steal?.mean, formatPercent)}</td>
        <td className="p-3 text-right font-mono">{figure(steal?.p95, formatPercent)}</td>
        <td className="p-3 text-right font-mono">{figure(steal?.max, formatPercent)}</td>
    </>;
}

function ProvidersPane({ capacity, hints }: { capacity: HostingAdminFleetCapacity; hints: FleetCapacityHints }) {
    const typical = fleetCapacityTypical(capacity);
    return (
        <section aria-label="Providers" className={paneClass}>
            <SectionHeading eyebrow="Steal and per-server needs by provider" title="Providers" count={capacity.providers.length} />
            <div className="mt-4 overflow-x-auto border border-white/10">
                {capacity.providers.length === 0 ? <Empty>No provider has VPSs in the read yet.</Empty> : (
                    <table className="w-full min-w-200 text-left text-xs">
                        <thead className={tableHeadClass}>
                            <tr>
                                <th className="p-3">Provider</th>
                                <th className="p-3 text-right">VPSs</th>
                                <th className="p-3 text-right">Servers</th>
                                <th className="p-3 text-right">{typical ? <MetricHint label="Steal p50" hint={hints.stealP50} /> : <MetricHint label="Steal mean" hint={hints.steal} />}</th>
                                <th className="p-3 text-right"><MetricHint label="Steal p95" hint={hints.stealP95} /></th>
                                <th className="p-3 text-right"><MetricHint label="Steal max" hint={hints.stealMax} /></th>
                                <th className="p-3 text-right"><MetricHint label="CPU p50" hint={`${hints.cpu} ${hints.cpuP50}`} /></th>
                                <th className="p-3 text-right"><MetricHint label="CPU p95" hint={`${hints.cpu} ${hints.cpuP95}`} /></th>
                                <th className="p-3 text-right"><MetricHint label={capacity.model.memoryPercentile === 99 ? "Memory p99" : "Memory p95"} hint={`${hints.memory} ${hints.p95}`} /></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 text-foreground">
                            {capacity.providers.map((entry) => (
                                <tr key={entry.provider}>
                                    <th scope="row" className="p-3 font-medium">{vpsProviderLabel(entry.provider)}</th>
                                    <td className="p-3 text-right font-mono">{entry.hosts}</td>
                                    <td className="p-3 text-right font-mono">{entry.servers}</td>
                                    <StealCells steal={entry.steal} typical={typical} />
                                    <td className="p-3 text-right font-mono">{figure(entry.demand.cpuCores?.p50, formatCores)}</td>
                                    <td className="p-3 text-right font-mono">{figure(entry.demand.cpuCores?.p95, formatCores)}</td>
                                    <td className="p-3 text-right font-mono">{figure(entry.demand.memoryBytes?.p99 ?? entry.demand.memoryBytes?.p95, formatGiB)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </section>
    );
}

/**
 * Servers at once with its verdict, a cue that does not rely on colour alone. From a control plane that fits on typical
 * demand: "Can run 4 at once", its co-online servers and slots (an instance type's static slots), the read's verdict and,
 * as information, its burst headroom. From an earlier one: modelled servers against today's slots.
 */
function ModelledCue({ entry, slots }: {
    entry: Pick<HostingFleetCapacityHost, "modelledServers" | "verdict" | "concurrentServers" | "concurrentSource" | "burstServers" | "burstCpuCores">;
    slots: number;
}) {
    const verdict = capacityVerdict(entry, slots);
    const modelled = entry.modelledServers;
    const burst = burstHeadroomLabel(entry);
    const of = `${slots} ${slots === 1 ? "slot" : "slots"}`;
    return (
        <div className="flex flex-col items-end gap-1">
            {entry.verdict === undefined ? (
                <span className="font-mono text-foreground">
                    {modelled === null ? <NoData /> : modelled}
                    <span className="text-foreground-muted"> / {of}</span>
                </span>
            ) : <>
                <span className="text-right text-foreground">{atOnceLabel(modelled)}</span>
                <span className="text-right text-foreground-muted">
                    {entry.concurrentServers === undefined || entry.concurrentSource === undefined
                        ? `static slots ${slots}`
                        : `${concurrentLabel({ concurrentServers: entry.concurrentServers, concurrentSource: entry.concurrentSource })} · slots ${slots}`}
                </span>
            </>}
            {verdict.kind !== "unknown" && (
                <span title={verdict.description} className={`${badgeClass} ${VERDICT_CLASSES[verdict.kind]}`}>
                    {verdict.kind === "risk" ? <TriangleAlert aria-hidden="true" className="size-3" /> : verdict.kind === "headroom" ? <ArrowUp aria-hidden="true" className="size-3" /> : <Equal aria-hidden="true" className="size-3" />}
                    {verdict.label}
                </span>
            )}
            {burst !== null && <span className="text-right text-[0.65rem] text-foreground-dim">{burst}</span>}
        </div>
    );
}

function InstanceTypesPane({ capacity, hints }: { capacity: HostingAdminFleetCapacity; hints: FleetCapacityHints }) {
    const typical = fleetCapacityTypical(capacity);
    return (
        <section aria-label="Instance types" className={paneClass}>
            <SectionHeading eyebrow="Modelled per VPS of each type" title="Instance types" count={capacity.instanceTypes.length} />
            <div className="mt-4 overflow-x-auto border border-white/10">
                {capacity.instanceTypes.length === 0 ? <Empty>No instance types in the read yet.</Empty> : (
                    <table className="w-full min-w-300 text-left text-xs">
                        <thead className={tableHeadClass}>
                            <tr>
                                <th className="p-3">Provider</th>
                                <th className="p-3 text-right">vCPU</th>
                                <th className="p-3 text-right">RAM</th>
                                <th className="p-3">CPU model</th>
                                <th className="p-3 text-right">MHz</th>
                                <th className="p-3 text-right">VPSs</th>
                                <th className="p-3 text-right">Servers</th>
                                <th className="p-3 text-right"><MetricHint label="CPU p50" hint={`${hints.cpu} ${hints.cpuP50}`} /></th>
                                <th className="p-3 text-right"><MetricHint label="CPU p95" hint={`${hints.cpu} ${hints.cpuP95}`} /></th>
                                <th className="p-3 text-right"><MetricHint label={capacity.model.memoryPercentile === 99 ? "Memory p99" : "Memory p95"} hint={`${hints.memory} ${hints.p95}`} /></th>
                                <th className="p-3 text-right">{typical ? <MetricHint label="Steal p50 · p95" hint={`${hints.stealP50} ${hints.stealP95}`} /> : <MetricHint label="Steal p95" hint={hints.stealP95} />}</th>
                                <th className="p-3 text-right"><MetricHint label="Servers at once (modelled)" hint={typical ? `${hints.modelled} ${hints.slots} ${hints.burst}` : `${hints.modelled} ${hints.slots}`} /></th>
                                <th className="p-3"><MetricHint label="Demand source" hint={hints.typeDemandSource} /></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 text-foreground">
                            {capacity.instanceTypes.map((entry) => (
                                <tr key={entry.key}>
                                    {/* The type in words, never its raw key with the provider id. */}
                                    <th scope="row" title={fleetCapacityTypeLabel(entry)} className="p-3 align-top font-medium">{vpsProviderLabel(entry.provider)}</th>
                                    <td className="p-3 text-right align-top font-mono">{entry.vCpu}<TypeEffectiveVcpu entry={entry} /></td>
                                    <td className="p-3 text-right align-top font-mono">{figure(entry.memoryBytes, formatGiB)}</td>
                                    <td className="max-w-56 p-3 align-top break-words">{entry.cpuModel ?? <NoData />}</td>
                                    <td className="p-3 text-right align-top font-mono">{figure(knownMhz(entry.cpuMhz), formatMhz)}</td>
                                    <td className="p-3 text-right align-top font-mono">{entry.hosts}</td>
                                    <td className="p-3 text-right align-top font-mono">{entry.servers}</td>
                                    <td className="p-3 text-right align-top font-mono">{figure(entry.demand.cpuCores?.p50, formatCores)}</td>
                                    <td className="p-3 text-right align-top font-mono">{figure(entry.demand.cpuCores?.p95, formatCores)}</td>
                                    <td className="p-3 text-right align-top font-mono">{figure(entry.demand.memoryBytes?.p99 ?? entry.demand.memoryBytes?.p95, formatGiB)}</td>
                                    <td className="p-3 text-right align-top font-mono">{typical && entry.steal !== null && entry.steal.p50 !== undefined
                                        ? `${formatPercent(entry.steal.p50)} · ${formatPercent(entry.steal.p95)}` : figure(entry.steal?.p95, formatPercent)}</td>
                                    <td className="p-3 align-top"><ModelledCue entry={entry} slots={staticSlots(entry.vCpu, capacity.model)} /></td>
                                    <td className="p-3 align-top">{demandSourceLabel(entry.demandSource)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </section>
    );
}

/** An instance type's effective vCPU under its vCPU, once the control plane reports it. */
function TypeEffectiveVcpu({ entry }: { entry: HostingFleetCapacityInstanceType }) {
    if (entry.effectiveVcpu === undefined || entry.effectiveVcpu === null) return null;
    return <span className="block text-foreground-muted">{effectiveVcpuLabel(entry.effectiveVcpu)}</span>;
}

function HostsPane({ capacity, hints }: { capacity: HostingAdminFleetCapacity; hints: FleetCapacityHints }) {
    const typical = fleetCapacityTypical(capacity);
    const groups = useMemo(() => fleetCapacityHostGroups(capacity.hosts), [capacity.hosts]);
    const days = useMemo(() => overlapDays(capacity.windowStartedAt), [capacity.windowStartedAt]);
    const hourLabels = useMemo(() => capacityHourLabels(capacity.windowStartedAt), [capacity.windowStartedAt]);
    return (
        <section aria-label="VPSs" className={paneClass}>
            <SectionHeading eyebrow="Modelled servers and hourly hotspots per VPS" title="VPSs" count={capacity.hosts.length} />
            <HourlyLegend />
            <div className="mt-4 overflow-x-auto border border-white/10">
                {groups.length === 0 ? <Empty>The control plane reports no VPSs.</Empty> : (
                    <table className="w-full text-left text-xs">
                        <thead className={tableHeadClass}>
                            <tr>
                                <th className="p-3">VPS</th>
                                <th className="p-3 text-right"><MetricHint label="Servers at once" hint={typical ? `${hints.modelled} ${hints.slots} ${hints.concurrent} ${hints.burst}` : `${hints.modelled} ${hints.slots}`} /></th>
                                <th className="p-3"><MetricHint label="Limited by" hint={hints.limitedBy} /></th>
                                <th className="p-3 text-right">{typical
                                    ? <MetricHint label="Steal p50 · p95 · max" hint={`${hints.steal} ${hints.stealP50} ${hints.stealP95}`} />
                                    : <MetricHint label="Steal mean · p95 · max" hint={`${hints.steal} ${hints.stealP95}`} />}</th>
                                <th className="p-3 text-right"><MetricHint label="Busy p95" hint={hints.busyCores} /></th>
                                <th className="p-3 text-right"><MetricHint label="Overhead" hint={hints.overhead} /></th>
                                <th className="p-3 text-right"><MetricHint label="Usable" hint={hints.usable} /></th>
                                <th className="p-3 text-right"><MetricHint label="Per server" hint={`${hints.perServer} ${hints.demandSource}`} /></th>
                                <th className="p-3"><MetricHint label="Steal and busy by hour (UTC)" hint={hints.hourly} /></th>
                            </tr>
                        </thead>
                        {groups.map((group) => (
                            <tbody key={group.label} className="divide-y divide-white/10 border-t border-white/10">
                                <tr>
                                    <th scope="rowgroup" colSpan={8} className="px-3 pt-4 pb-1 font-label text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-gold">{group.label}</th>
                                    <td className="px-3 pt-4 pb-1"><DayAxis days={days} /></td>
                                </tr>
                                {group.hosts.map((entry) => <HostRow key={entry.serviceName} host={entry} model={capacity.model} days={days} hourLabels={hourLabels} />)}
                            </tbody>
                        ))}
                    </table>
                )}
            </div>
        </section>
    );
}

function HourlyLegend() {
    return (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.65rem] text-foreground-muted">
            <span>One cell per UTC hour, oldest first. Steal:</span>
            <span>0%</span>
            <span aria-hidden="true" className="flex gap-px">{HEATMAP_CLASSES.map((className) => <span key={className} className={`size-2.5 ${className}`} />)}</span>
            <span>20% or more</span>
            <span className="ml-2">Busy:</span>
            <span>0%</span>
            <span aria-hidden="true" className="flex gap-px">{HEATMAP_CLASSES.map((className) => <span key={className} className={`size-2.5 ${className}`} />)}</span>
            <span>90% or more</span>
            <span aria-hidden="true" className="ml-2 size-2.5 border border-white/10" style={HEATMAP_NO_DATA} />
            <span>No data</span>
        </div>
    );
}

/** The window's UTC dates over their hours, after the strips' row labels. */
function DayAxis({ days }: { days: Days }) {
    return (
        <div aria-hidden="true" className="flex items-center gap-2">
            <span className="w-8 shrink-0" />
            <div className="flex gap-0.5">
                {days.map((day) => {
                    // Every date gets a label that fits its width; a sliver keeps the date in its title.
                    const label = overlapDayAxisLabel(day);
                    return (
                        <span key={day.label} title={label.title} className="overflow-hidden font-mono text-[0.55rem] font-normal whitespace-nowrap normal-case tracking-normal text-foreground-dim" style={{ width: `${day.hours.length * 0.25}rem` }}>
                            {label.text}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}

function TwoLine({ cores, bytes, exact = false }: { cores: number | null; bytes: number | null; exact?: boolean }) {
    return <>
        <span className="block">{figure(cores, exact ? formatCoresExact : formatCores)}</span>
        <span className="block text-foreground-muted">{figure(bytes, formatGiB)}</span>
    </>;
}

/** One VPS: memoized, so a refresh that keeps the read does not redraw 336 cells for each of 64 VPSs. */
const HostRow = memo(function HostRow({ host, model, days, hourLabels }: {
    host: HostingFleetCapacityHost;
    model: HostingAdminFleetCapacity["model"];
    days: Days;
    hourLabels: readonly string[];
}) {
    const steal = useMemo(() => decodeHourly(host.stealHourly), [host.stealHourly]);
    const busy = useMemo(() => decodeHourly(host.busyHourly), [host.busyHourly]);
    const verdict = capacityVerdict(host, host.slots);
    const limitedBy = limitedByLabel(host.limitedBy);
    const servers = host.occupants.length;
    return (
        <tr className="align-top text-foreground">
            <th scope="row" className={`border-l-2 p-3 text-left font-normal ${VERDICT_ROW_CLASSES[verdict.kind]}`}>
                {/* A fixed width, so long names and CPU models wrap rather than widen the column. */}
                <div className="w-56">
                    <p className="font-mono font-medium text-foreground" title={host.serviceName}>{shortServiceName(host.serviceName)}</p>
                    <p className="mt-1 text-foreground-muted">{capacitySizeLabel(host)}</p>
                    <p className="mt-0.5 text-foreground-muted">
                        <span className="block truncate" title={host.cpuModel ?? undefined}>{host.cpuModel ?? "CPU model unknown"}</span>
                        <span className="block font-mono">{figure(knownMhz(host.cpuMhz), formatMhz)}</span>
                    </p>
                    <p className="mt-1 text-foreground-muted">{servers} {servers === 1 ? "server" : "servers"} · {host.slots} {host.slots === 1 ? "slot" : "slots"}{host.samples === 0 && " · no data yet"}</p>
                    {/* Its steal, busy, overhead, usable and modelled figures are all — for this one reason. */}
                    {hostMetricsMissing(host) && <p className="mt-1 text-amber-300">{HOST_METRICS_MISSING}</p>}
                    {servers > 0 && (
                        <ul aria-label={`Servers on ${shortServiceName(host.serviceName)}`} className="mt-2 space-y-1">
                            {host.occupants.map((occupant) => (
                                <li key={occupant.serverId}>
                                    <span className="block break-words text-foreground">{occupant.displayName}</span>
                                    <span className="block font-mono text-[0.65rem] text-foreground-muted">{occupantDemandLabel(occupant.demand, model)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </th>
            <td className="p-3"><ModelledCue entry={host} slots={host.slots} /></td>
            <td className="p-3">{limitedBy ?? <NoData />}</td>
            <td className="p-3 text-right font-mono whitespace-nowrap">
                {host.steal === null ? <NoData /> : stealFigures(host.steal)}
            </td>
            <td className="p-3 text-right font-mono whitespace-nowrap">{figure(host.busyCores?.p95, formatCores)}<span className="block text-foreground-muted">of {host.vCpu} vCPU</span></td>
            <td className="p-3 text-right font-mono whitespace-nowrap"><TwoLine cores={host.overheadCores} bytes={host.overheadMemoryBytes} /></td>
            <td className="p-3 text-right font-mono whitespace-nowrap">
                <TwoLine cores={host.usableCores} bytes={host.usableMemoryBytes} />
                {host.effectiveVcpu !== undefined && host.effectiveVcpu !== null && <span className="block text-foreground-dim">{effectiveVcpuLabel(host.effectiveVcpu)}</span>}
            </td>
            <td className="p-3 text-right font-mono whitespace-nowrap">
                <TwoLine cores={host.demandCpuCores} bytes={host.demandMemoryBytes} exact />
                <span className="mt-0.5 block font-sans text-foreground-dim">{perServerSourceLabel(host, model)}</span>
            </td>
            <td className="p-3">
                <div className="space-y-1">
                    <StripLine label="Steal">
                        <HourlyStrip values={steal} summary={stealStripSummary(host.serviceName, steal, hourLabels)} days={days} band={stealBand} title={(hour, value) => stealCellLabel(hourLabels[hour]!, value)} />
                    </StripLine>
                    <StripLine label="Busy">
                        <HourlyStrip values={busy} summary={busyStripSummary(host.serviceName, busy, hourLabels)} days={days} band={busyBand} title={(hour, value) => busyCellLabel(hourLabels[hour]!, value)} />
                    </StripLine>
                </div>
            </td>
        </tr>
    );
});

function StripLine({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            <span aria-hidden="true" className="w-8 shrink-0 font-label text-[0.55rem] font-semibold uppercase tracking-[0.1em] text-foreground-dim">{label}</span>
            {children}
        </div>
    );
}

/** A week of hours shaded on the heatmap's ten bands; an hour without data is hatched, never the shade of zero. */
function HourlyStrip({ values, summary, days, band, title }: {
    values: readonly (number | null)[];
    summary: string;
    days: Days;
    band: (value: number) => number;
    title: (hour: number, value: number | null) => string;
}) {
    return (
        <div role="img" aria-label={summary} className="flex gap-0.5">
            {days.map((day) => (
                <span key={day.label} className="flex">{day.hours.map((hour) => {
                    const value = values[hour] ?? null;
                    return value === null
                        ? <span key={hour} title={title(hour, null)} className="h-3 w-1" style={HEATMAP_NO_DATA} />
                        : <span key={hour} title={title(hour, value)} className={`h-3 w-1 ${HEATMAP_CLASSES[band(value)]}`} />;
                })}</span>
            ))}
        </div>
    );
}
