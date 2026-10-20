"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Empty, SectionHeading } from "@/app/components/admin/ControlPlanePresentation";
import { LocalDateTime } from "@/app/components/admin/LocalDateTime";
import { requestControlPlaneAdmin } from "@/app/lib/control-plane/client";
import {
    OVERLAP_COVERAGE_HINT,
    OVERLAP_PAIR_HOURS_HINT,
    overlapBand,
    overlapBurstLabel,
    overlapBurstRow,
    overlapCellLabel,
    overlapCoverageLabel,
    overlapDayAxisLabel,
    overlapDays,
    overlapGroups,
    overlapPairHoursLabel,
    overlapPredatesBurst,
    overlapSummary,
    overlapWindowLabel,
    parsePlacementOverlap,
    placementOverlapErrorMessage,
} from "@/app/lib/control-plane/placement-measured-overlap";
import { shortServiceName } from "@/app/lib/control-plane/placement-live-moves";
import type { HostingAdminPlacementOverlap, HostingPlacementOverlapHost } from "@/app/lib/control-plane/types";
import { getSupabaseBrowserClient } from "@/app/lib/supabase/client";
import { MetricHint } from "./MetricHint";
import { HEATMAP_CLASSES, HEATMAP_NO_DATA as NO_DATA } from "./placement-heatmap-classes";

const buttonClass = "inline-flex min-h-9 items-center gap-1.5 border border-white/15 px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-foreground-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
// Name and servers, the week (168 quarter-rem hours with a hairline between UTC days), and the totals.
const ROW_GRID = "grid grid-cols-[13rem_43rem_11rem] items-start gap-x-5";

async function readOverlap(signal: AbortSignal): Promise<HostingAdminPlacementOverlap> {
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session?.access_token) throw new Error("Authentication is required.");
    const result = await requestControlPlaneAdmin<unknown>({
        accessToken: session.access_token,
        requestId: crypto.randomUUID(),
        operation: "placement-overlap",
        input: {},
        signal,
    });
    const overlap = parsePlacementOverlap(result);
    if (overlap === null) throw new Error("The control plane returned an unexpected host overlap.");
    return overlap;
}

type OverlapState =
    | { kind: "loading"; previous: HostingAdminPlacementOverlap | null }
    | { kind: "ready"; overlap: HostingAdminPlacementOverlap }
    | { kind: "error"; message: string; previous: HostingAdminPlacementOverlap | null };

/**
 * How the servers on each shared VPS were actually online together over the last week, hour by hour, from
 * the control plane's measured read. It is read once when the tab opens and on Refresh, not polled: the
 * control plane allows each administrator six reads every five minutes.
 */
export function PlacementMeasuredOverlap() {
    const [state, setState] = useState<OverlapState>({ kind: "loading", previous: null });
    const controller = useRef<AbortController | null>(null);

    const load = useCallback(async () => {
        // One read at a time: a Refresh while one is under way does nothing.
        if (controller.current !== null) return;
        const request = new AbortController();
        controller.current = request;
        setState((current) => ({ kind: "loading", previous: current.kind === "ready" ? current.overlap : current.previous }));
        try {
            const overlap = await readOverlap(request.signal);
            if (!request.signal.aborted) setState({ kind: "ready", overlap });
        } catch (cause) {
            if (!request.signal.aborted) {
                setState((current) => ({ kind: "error", message: placementOverlapErrorMessage(cause), previous: current.kind === "loading" ? current.previous : null }));
            }
        } finally {
            if (controller.current === request) controller.current = null;
        }
    }, []);

    useEffect(() => {
        // Deferred to its own task, like the other reads this tab starts on opening.
        const timer = window.setTimeout(() => void load(), 0);
        return () => {
            window.clearTimeout(timer);
            controller.current?.abort();
            controller.current = null;
        };
    }, [load]);

    const overlap = state.kind === "ready" ? state.overlap : state.previous;
    const groups = overlap === null ? [] : overlapGroups(overlap.hosts);
    // An older control plane's read has no red hours, so neither its legend nor its rows mention them.
    const predatesBurst = overlap !== null && overlapPredatesBurst(overlap);
    return (
        <section aria-label="Host overlap" className="border border-white/10 bg-surface p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <SectionHeading eyebrow="Measured over the last 7 days" title="Host overlap" count={overlap?.hosts.length ?? 0} />
                </div>
                <button type="button" onClick={() => void load()} disabled={state.kind === "loading"} className={buttonClass}>
                    {state.kind === "loading" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}
                    Refresh
                </button>
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-foreground-muted">
                How the servers on each VPS with more than one slot were online together in each of the last 168 hours.
            </p>
            {state.kind === "loading" && <p role="status" className="mt-4 text-xs text-foreground-muted">Loading measured overlap…</p>}
            {state.kind === "error" && (
                <p role="alert" className="mt-4 border-l-2 border-crimson bg-crimson/10 px-3 py-2 text-xs text-red-200">
                    {state.message} <button type="button" className="ml-2 underline" onClick={() => void load()}>Retry</button>
                </p>
            )}
            {overlap !== null && <>
                <OverlapLegend burst={!predatesBurst} />
                {predatesBurst && <p className="mt-2 text-[0.65rem] text-foreground-muted">This control plane predates burst capacity; red hours appear after it updates.</p>}
                <div className="mt-4 overflow-x-auto border border-white/10">
                    {groups.length === 0
                        ? <Empty>No VPS has more than one slot, so no two servers share one.</Empty>
                        : <div className="w-max min-w-full space-y-6 p-4">{groups.map((group) => (
                            <div key={group.region}>
                                <div className={ROW_GRID}>
                                    <h3 className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-gold">{group.region}</h3>
                                    <DayAxis windowStartedAt={overlap.windowStartedAt} />
                                </div>
                                <ul className="mt-1 divide-y divide-white/10">{group.hosts.map((host) => <OverlapRow key={host.serviceName} host={host} windowStartedAt={overlap.windowStartedAt} />)}</ul>
                            </div>
                        ))}</div>}
                </div>
                <p className="mt-3 text-[0.65rem] text-foreground-dim">Measured {overlapWindowLabel(overlap)} · generated <LocalDateTime value={overlap.generatedAt} /></p>
            </>}
        </section>
    );
}

function OverlapLegend({ burst }: { burst: boolean }) {
    return (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.65rem] text-foreground-muted">
            <span>One cell per UTC hour, oldest first. Online:</span>
            <span>0</span>
            <span aria-hidden="true" className="flex gap-px">{HEATMAP_CLASSES.map((className) => <span key={className} className={`size-2.5 ${className}`} />)}</span>
            <span>all slots</span>
            <span aria-hidden="true" className="ml-2 size-2.5 border border-white/10" style={NO_DATA} />
            <span>No data</span>
            {burst && <>
                <span aria-hidden="true" className="ml-2 h-1 w-4 bg-crimson" />
                <span>Red: more servers online than can each burst to 1.6 vCPU and 3 GiB</span>
            </>}
        </div>
    );
}

/** The window's UTC dates, each over its hours, so the strip reads as real days rather than a typical week. */
function DayAxis({ windowStartedAt }: { windowStartedAt: string }) {
    return (
        <div aria-hidden="true" className="flex gap-0.5">
            {overlapDays(windowStartedAt).map((day) => {
                // Every date gets a label that fits its width; a sliver keeps the date in its title.
                const label = overlapDayAxisLabel(day);
                return (
                    <span key={day.label} title={label.title} className="overflow-hidden font-mono text-[0.55rem] whitespace-nowrap text-foreground-dim" style={{ width: `${day.hours.length * 0.25}rem` }}>
                        {label.text}
                    </span>
                );
            })}
        </div>
    );
}

function OverlapRow({ host, windowStartedAt }: { host: HostingPlacementOverlapHost; windowStartedAt: string }) {
    // Null for a control plane that predates burst capacity.
    const burst = overlapBurstLabel(host);
    return (
        <li className={`${ROW_GRID} py-3`}>
            <div className="min-w-0 text-xs">
                <p className="font-mono text-foreground" title={host.serviceName}>{shortServiceName(host.serviceName)}</p>
                <p className="mt-1 text-foreground-muted">{host.slots} slots</p>
                <p className="mt-1 break-words text-foreground">{host.occupants.length === 0 ? "Empty" : host.occupants.map((occupant) => occupant.displayName).join(", ")}</p>
            </div>
            <OverlapStrip host={host} windowStartedAt={windowStartedAt} />
            <div className="space-y-1 text-right font-mono text-xs">
                {burst !== null && <p className="text-foreground">{burst}</p>}
                <p className="text-foreground-muted"><MetricHint label={overlapPairHoursLabel(host)} hint={OVERLAP_PAIR_HOURS_HINT} /></p>
                <p className="text-foreground-muted"><MetricHint label={overlapCoverageLabel(host)} hint={OVERLAP_COVERAGE_HINT} /></p>
            </div>
        </li>
    );
}

/**
 * The week's hours shaded by online servers over slots. A VPS with more servers than can each burst at once adds
 * a row marking the hours more of them were online than that; no other VPS can have one.
 */
function OverlapStrip({ host, windowStartedAt }: { host: HostingPlacementOverlapHost; windowStartedAt: string }) {
    const days = overlapDays(windowStartedAt);
    const overBurst = overlapBurstRow(host);
    return (
        <div role="img" aria-label={overlapSummary(host, windowStartedAt)} className="flex flex-col gap-0.5">
            <div className="flex gap-0.5">{days.map((day) => (
                <span key={day.label} className="flex">{day.hours.map((hour) => {
                    const online = host.online[hour];
                    return online === null || online === undefined
                        ? <span key={hour} title={overlapCellLabel(host, windowStartedAt, hour)} className="h-5 w-1" style={NO_DATA} />
                        : <span key={hour} title={overlapCellLabel(host, windowStartedAt, hour)} className={`h-5 w-1 ${HEATMAP_CLASSES[overlapBand(online, host.slots)]}`} />;
                })}</span>
            ))}</div>
            {/* An hour that servers without data could have put over is hatched, not blank. */}
            {overBurst !== null && <div className="flex gap-0.5">{days.map((day) => (
                <span key={day.label} className="flex">{day.hours.map((hour) => {
                    const verdict = overBurst[hour];
                    return verdict === "1" ? <span key={hour} className="h-1 w-1 bg-crimson" />
                        : verdict === "0" ? <span key={hour} className="h-1 w-1 bg-white/10" />
                            : <span key={hour} className="h-1 w-1" style={NO_DATA} />;
                })}</span>
            ))}</div>}
        </div>
    );
}
