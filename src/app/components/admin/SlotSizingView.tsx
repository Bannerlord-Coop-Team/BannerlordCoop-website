"use client";

import { ArrowDown, ArrowUp, Equal, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";
import { Empty, SectionHeading } from "@/app/components/admin/ControlPlanePresentation";
import { LocalDateTime } from "@/app/components/admin/LocalDateTime";
import { MetricHint } from "@/app/components/admin/MetricHint";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import { shortServiceName } from "@/app/lib/control-plane/placement-live-moves";
import {
    formatCoreHours,
    formatOverflowShare,
    parseSlotSizing,
    SLOT_SIZING_UNAVAILABLE,
    slotSizingBudgets,
    slotSizingCapacityFigures,
    slotSizingCapacityNote,
    slotSizingCapacitySources,
    slotSizingDifference,
    slotSizingErrorMessage,
    slotSizingHints,
    slotSizingHostGroups,
    slotSizingOverBudget,
    slotSizingReasonDescription,
    slotSizingReasonLabel,
    slotSizingTypicalServer,
    slotSizingUnavailable,
    type SlotSizingHints,
} from "@/app/lib/control-plane/slot-sizing";
import type { HostingAdminSlotSizing, HostingSlotSizingHost } from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";

const buttonClass = "inline-flex min-h-9 items-center gap-1.5 border border-white/15 px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-foreground-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
const paneClass = "border border-white/10 bg-surface p-5";
const tableHeadClass = "border-b border-white/10 font-label text-[0.62rem] uppercase tracking-[0.12em] text-foreground-muted";
const badgeClass = "inline-flex w-fit items-center gap-1 border px-2 py-0.5 font-label text-[0.58rem] font-semibold uppercase tracking-[0.1em]";
const DIFFERENCE_CLASSES = {
    more: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    fewer: "border-gold/40 bg-gold/10 text-gold",
    same: "border-white/15 text-foreground-muted",
} as const;

async function readSlotSizing(signal: AbortSignal): Promise<HostingAdminSlotSizing> {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session?.access_token) throw new Error("Authentication is required.");
    const result = await requestControlPlaneAdmin<unknown>({
        accessToken: session.access_token,
        requestId: crypto.randomUUID(),
        operation: "slot-sizing",
        input: {},
        signal,
    });
    const sizing = parseSlotSizing(result);
    if (sizing === null) throw new Error("The control plane returned an unexpected slot sizing.");
    return sizing;
}

type SizingState =
    | { kind: "loading"; previous: HostingAdminSlotSizing | null }
    | { kind: "ready"; sizing: HostingAdminSlotSizing }
    | { kind: "unavailable" }
    | { kind: "error"; message: string; previous: HostingAdminSlotSizing | null };

/**
 * The control plane's read-only slot sizing: how many slots each VPS could have, from its servers' weeks and its
 * usable capacity. It offers no way to apply them. Like the capacity read it is read once when the tab opens and on
 * Refresh, not polled: the control plane allows each administrator six reads every five minutes, in its own budget. A
 * control plane without the operation leaves a calm note, never an error, and the rest of the tab is unaffected.
 */
export function SlotSizingView() {
    const [state, setState] = useState<SizingState>({ kind: "loading", previous: null });
    const controller = useRef<AbortController | null>(null);

    const load = useCallback(async () => {
        // One read at a time: a Refresh while one is under way does nothing.
        if (controller.current !== null) return;
        const request = new AbortController();
        controller.current = request;
        setState((current) => ({ kind: "loading", previous: current.kind === "ready" ? current.sizing : current.kind === "unavailable" ? null : current.previous }));
        try {
            const sizing = await readSlotSizing(request.signal);
            if (!request.signal.aborted) setState({ kind: "ready", sizing });
        } catch (cause) {
            if (request.signal.aborted) return;
            if (slotSizingUnavailable(cause)) setState({ kind: "unavailable" });
            else setState((current) => ({ kind: "error", message: slotSizingErrorMessage(cause), previous: current.kind === "loading" ? current.previous : null }));
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

    const sizing = state.kind === "ready" ? state.sizing : state.kind === "unavailable" ? null : state.previous;
    const hints = useMemo(() => sizing === null ? null : slotSizingHints(sizing.model), [sizing]);
    const capacityNote = sizing === null ? null : slotSizingCapacityNote(sizing.model);
    return (
        <section aria-label="Slot sizing" className={paneClass}>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <SectionHeading eyebrow="Recommendations only · nothing is applied" title="Slot sizing" count={sizing?.hosts.length ?? 0} />
                </div>
                <button type="button" onClick={() => void load()} disabled={state.kind === "loading"} className={buttonClass}>
                    {state.kind === "loading" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}
                    Refresh
                </button>
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-foreground-muted">
                How many slots each VPS could have so that servers rarely online together share it, as the control plane would size them. These are recommendations to review: nothing applies them, and no slot count, server or placement changes until automatic sizing is turned on, which does not exist yet. Raising slots by hand in the VPS view stays separate.
            </p>
            {sizing !== null && <>
                <p className="mt-2 max-w-3xl text-xs leading-5 text-foreground-muted">{slotSizingBudgets(sizing.model)}</p>
                <p className="mt-2 max-w-3xl text-xs leading-5 text-foreground-muted">{slotSizingTypicalServer(sizing.model)}</p>
            </>}
            {state.kind === "loading" && <p role="status" className="mt-4 text-xs text-foreground-muted">Loading slot sizing…</p>}
            {state.kind === "unavailable" && <p className="mt-4 max-w-3xl border-l-2 border-white/20 px-3 py-2 text-xs leading-5 text-foreground-muted">{SLOT_SIZING_UNAVAILABLE}</p>}
            {state.kind === "error" && (
                <p role="alert" className="mt-4 border-l-2 border-crimson bg-crimson/10 px-3 py-2 text-xs text-red-200">
                    {state.message} <button type="button" className="ml-2 underline" onClick={() => void load()}>Retry</button>
                </p>
            )}
            {capacityNote !== null && <p className="mt-4 max-w-3xl border-l-2 border-gold/60 bg-gold/8 px-3 py-2 text-xs leading-5 text-foreground">{capacityNote}</p>}
            {sizing !== null && hints !== null && <>
                <p className="mt-3 text-[0.65rem] text-foreground-dim">
                    Generated <LocalDateTime value={sizing.generatedAt} />
                </p>
                <HostsTable sizing={sizing} hints={hints} />
                <RegionsTable sizing={sizing} hints={hints} />
            </>}
        </section>
    );
}

/** A figure that has no value: the VPS is unmeasured. */
function NoData() {
    return <span title="Unmeasured" className="text-foreground-dim"><span aria-hidden="true">—</span><span className="sr-only">Unmeasured</span></span>;
}

function HostsTable({ sizing, hints }: { sizing: HostingAdminSlotSizing; hints: SlotSizingHints }) {
    const groups = useMemo(() => slotSizingHostGroups(sizing.hosts), [sizing.hosts]);
    return (
        <div className="mt-4 overflow-x-auto border border-white/10">
            {groups.length === 0 ? <Empty>The control plane reports no VPSs.</Empty> : (
                <table aria-label="Recommended slots per VPS" className="w-full min-w-300 text-left text-xs">
                    <thead className={tableHeadClass}>
                        <tr>
                            <th className="p-3">VPS</th>
                            <th className="p-3 text-right"><MetricHint label="Slots" hint={hints.slots} /></th>
                            <th className="p-3 text-right"><MetricHint label="Servers" hint={hints.servers} /></th>
                            <th className="p-3 text-right"><MetricHint label="Recommended" hint={hints.recommended} /></th>
                            <th className="p-3"><MetricHint label="Reason" hint={hints.reason} /></th>
                            <th className="p-3 text-right"><MetricHint label="CPU shortage / week" hint={hints.shortage} /></th>
                            <th className="p-3 text-right"><MetricHint label="Memory over" hint={hints.overflow} /></th>
                            <th className="p-3 text-right"><MetricHint label="To move" hint={hints.toMove} /></th>
                            <th className="p-3 text-right"><MetricHint label="Free recommended" hint={hints.free} /></th>
                            <th className="p-3"><MetricHint label="Capacity" hint={hints.capacity} /></th>
                        </tr>
                    </thead>
                    {groups.map((group) => (
                        <tbody key={group.label} className="divide-y divide-white/10 border-t border-white/10">
                            <tr>
                                <th scope="rowgroup" colSpan={10} className="px-3 pt-4 pb-1 font-label text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-gold">{group.label}</th>
                            </tr>
                            {group.hosts.map((entry) => <HostRow key={entry.serviceName} host={entry} sizing={sizing} />)}
                        </tbody>
                    ))}
                </table>
            )}
        </div>
    );
}

/** The recommendation against today's slots, with a cue that does not rely on colour alone. */
function Recommendation({ host }: { host: HostingSlotSizingHost }) {
    if (host.recommendedSlots === null) return <NoData />;
    const difference = slotSizingDifference(host.recommendedSlots, host.slots);
    return (
        <div className="flex flex-col items-end gap-1">
            <span className="font-mono text-foreground">{host.recommendedSlots}</span>
            <span title={difference.description} className={`${badgeClass} ${DIFFERENCE_CLASSES[difference.kind]}`}>
                {difference.kind === "more" ? <ArrowUp aria-hidden="true" className="size-3" /> : difference.kind === "fewer" ? <ArrowDown aria-hidden="true" className="size-3" /> : <Equal aria-hidden="true" className="size-3" />}
                {difference.label}
            </span>
        </div>
    );
}

/** A figure at the recommendation, marked when the control plane says its exact value breaks the budget. */
function BudgetFigure({ value, over }: { value: ReactNode; over: boolean }) {
    return <>
        <span className="block">{value}</span>
        {over && <span className="mt-0.5 flex items-center justify-end gap-1 font-sans text-amber-300"><TriangleAlert aria-hidden="true" className="size-3" />Over budget</span>}
    </>;
}

function HostRow({ host, sizing }: { host: HostingSlotSizingHost; sizing: HostingAdminSlotSizing }) {
    const over = slotSizingOverBudget(host);
    const capacityFigures = slotSizingCapacityFigures(host);
    const name = shortServiceName(host.serviceName);
    return (
        <tr className="align-top text-foreground">
            <th scope="row" className="p-3 text-left font-normal">
                <p className="font-mono font-medium text-foreground" title={host.serviceName}>{name}</p>
                <p className="mt-1 text-foreground-muted">{host.vCpu} vCPU</p>
                {!host.acceptsRelocations && <p className="mt-1 text-foreground-muted">Takes no moved servers</p>}
            </th>
            <td className="p-3 text-right font-mono">{host.slots}</td>
            <td className="p-3 text-right font-mono">{host.occupants}</td>
            <td className="p-3"><Recommendation host={host} /></td>
            <td className="max-w-64 p-3">
                <span className="block font-medium">{slotSizingReasonLabel(host.reason)}</span>
                <span className="mt-0.5 block text-foreground-muted">{slotSizingReasonDescription(host, sizing.model)}</span>
            </td>
            <td className="p-3 text-right font-mono whitespace-nowrap">
                {host.expectedShortageCoreHoursPerWeek === null ? <NoData />
                    : <BudgetFigure value={formatCoreHours(host.expectedShortageCoreHoursPerWeek)} over={over.cpu} />}
            </td>
            <td className="p-3 text-right font-mono whitespace-nowrap">
                {host.memoryOverflowShare === null ? <NoData />
                    : <BudgetFigure value={formatOverflowShare(host.memoryOverflowShare)} over={over.memory} />}
            </td>
            <td className={`p-3 text-right font-mono ${host.serversToMove > 0 ? "text-amber-300" : ""}`}>{host.serversToMove}</td>
            <td className="p-3 text-right font-mono">{host.freeRecommendedSlots}</td>
            <td className="p-3">
                <span className="block">{slotSizingCapacitySources(host)}</span>
                {capacityFigures !== null && <span className="mt-0.5 block text-foreground-muted">{capacityFigures}</span>}
            </td>
        </tr>
    );
}

function RegionsTable({ sizing, hints }: { sizing: HostingAdminSlotSizing; hints: SlotSizingHints }) {
    return (
        <div className="mt-6">
            <h3 className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold">By region</h3>
            <div className="mt-2 overflow-x-auto border border-white/10">
                {sizing.regions.length === 0 ? <Empty>No region has a VPS or a server to move.</Empty> : (
                    <table aria-label="Moves and room per region" className="w-full min-w-150 text-left text-xs">
                        <thead className={tableHeadClass}>
                            <tr>
                                <th className="p-3">Region</th>
                                <th className="p-3 text-right"><MetricHint label="To move" hint={hints.regionToMove} /></th>
                                <th className="p-3 text-right"><MetricHint label="Free recommended" hint={hints.regionFree} /></th>
                                <th className="p-3 text-right"><MetricHint label="Shortfall" hint={hints.shortfall} /></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 text-foreground">
                            {sizing.regions.map((entry) => (
                                <tr key={entry.regionKey}>
                                    <th scope="row" className="p-3 font-medium">{hostingRegionLabel(entry.regionKey)}</th>
                                    <td className="p-3 text-right font-mono">{entry.serversToMove}</td>
                                    <td className="p-3 text-right font-mono">{entry.freeRecommendedSlots}</td>
                                    <td className="p-3 text-right font-mono">
                                        {entry.shortfallServers === 0 ? "0" : (
                                            <span className="inline-flex items-center gap-1 text-amber-300">
                                                <TriangleAlert aria-hidden="true" className="size-3" />
                                                {entry.shortfallServers} {entry.shortfallServers === 1 ? "server" : "servers"} without a slot
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
