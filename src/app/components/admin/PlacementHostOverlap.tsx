"use client";

import { useMemo, useState } from "react";
import { Empty, SectionHeading } from "@/app/components/admin/ControlPlanePresentation";
import { PLACEMENT_WEEKDAYS, weekdayLabel } from "@/app/lib/control-plane/placement";
import {
    ALL_BUSY_MARK_PROBABILITY,
    allBusyLabel,
    hostOverlapCellLabel,
    hostOverlapSummary,
    overlapBand,
    pairHoursLabel,
    placementHostOverlapGroups,
    slotsFreeLabel,
    type HostOverlap,
    type PlacementOverlapRow,
    type PlacementOverlapSide,
} from "@/app/lib/control-plane/placement-overlap";
import type { HostingAdminPlacementPlan } from "@/app/lib/control-plane/types";
import { HEATMAP_CLASSES } from "./placement-heatmap-classes";

const toggleClass = "inline-flex min-h-9 items-center border px-3 font-label text-[0.62rem] font-semibold uppercase tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-gold";
const SIDES: ReadonlyArray<{ value: PlacementOverlapSide; label: string }> = [
    { value: "current", label: "Now" },
    { value: "proposed", label: "After plan" },
];
// Name and servers, the week (168 quarter-rem hours with a hairline gap between days), and the totals.
const ROW_GRID = "grid grid-cols-[13rem_42.75rem_11rem] items-start gap-x-5";
const WEEK = PLACEMENT_WEEKDAYS.map((_, day) => Array.from({ length: 24 }, (__, hour) => day * 24 + hour));

/**
 * When a VPS's slots are busy at the same time, now or after the plan: one week-long strip per VPS
 * with more than one slot, shaded by how much of its capacity is expected online, with the hours in
 * which every slot is usually busy marked underneath.
 */
export function PlacementHostOverlap({ plan }: { plan: Pick<HostingAdminPlacementPlan, "hosts" | "servers" | "moves"> }) {
    const [side, setSide] = useState<PlacementOverlapSide>("current");
    const groups = useMemo(() => placementHostOverlapGroups(plan, side), [plan, side]);
    const count = groups.reduce((total, group) => total + group.rows.length, 0);
    return (
        <section aria-label="Host overlap">
            <SectionHeading eyebrow="When are a VPS's slots busy at the same time?" title="Host overlap" count={count} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div role="group" aria-label="Placement shown" className="flex">
                    {SIDES.map(({ value, label }) => (
                        <button key={value} type="button" aria-pressed={side === value} onClick={() => setSide(value)}
                            className={`${toggleClass} ${side === value ? "border-gold/50 bg-gold/15 text-gold" : "border-white/15 text-foreground-muted hover:text-foreground"}`}>
                            {label}
                        </button>
                    ))}
                </div>
                <OverlapLegend />
            </div>
            <div className="mt-4 overflow-x-auto border border-white/10 bg-surface">
                {count === 0
                    ? <Empty>No VPS in the plan has more than one slot, so no two servers share one.</Empty>
                    : <div className="w-max min-w-full space-y-6 p-4">{groups.map((group) => (
                        <div key={group.region}>
                            <div className={ROW_GRID}>
                                <h3 className="font-label text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-gold">{group.region}</h3>
                                <div aria-hidden="true" className="flex gap-0.5">
                                    {PLACEMENT_WEEKDAYS.map((day) => <span key={day} className="w-24 font-mono text-[0.55rem] text-foreground-dim">{weekdayLabel(day).slice(0, 3)}</span>)}
                                </div>
                            </div>
                            <ul className="mt-1 divide-y divide-white/10">{group.rows.map((row) => <OverlapRow key={row.host.serviceName} row={row} />)}</ul>
                        </div>
                    ))}</div>}
            </div>
        </section>
    );
}

function OverlapLegend() {
    return (
        <div className="flex flex-wrap items-center gap-2 text-[0.65rem] text-foreground-muted">
            <span>Each strip is one week from Monday, UTC, one cell per hour. Expected online:</span>
            <span>0</span>
            <span aria-hidden="true" className="flex gap-px">{HEATMAP_CLASSES.map((className) => <span key={className} className={`size-2.5 ${className}`} />)}</span>
            <span>all slots</span>
            <span aria-hidden="true" className="ml-2 h-1 w-4 bg-crimson" />
            <span>All slots busy (≥ 50%), on the thin row under a full VPS</span>
        </div>
    );
}

function OverlapRow({ row }: { row: PlacementOverlapRow }) {
    const { host, occupants, overlap, freeSlots } = row;
    return (
        <li className={`${ROW_GRID} py-3`}>
            <div className="min-w-0 text-xs">
                <p className="font-mono text-foreground">{host.serviceName}</p>
                <p className="mt-1 text-foreground-muted">{host.slots} slots</p>
                <p className="mt-1 break-words text-foreground">{occupants.length === 0 ? "Empty" : occupants.map((occupant) => occupant.displayName).join(", ")}</p>
            </div>
            {overlap === null
                ? <p className="self-center text-xs text-foreground-dim">Unavailable: a server on this VPS has no learned weekly activity yet.</p>
                : <OverlapStrip serviceName={host.serviceName} slots={host.slots} occupants={occupants.length} overlap={overlap} />}
            <div className="text-right font-mono text-xs">
                <p className="text-foreground">{pairHoursLabel(row.pairHoursPerWeek)}</p>
                <p className="mt-1 text-foreground-muted">{freeSlots > 0 ? slotsFreeLabel(freeSlots) : overlap === null ? "—" : allBusyLabel(overlap, host.slots)}</p>
            </div>
        </li>
    );
}

/** The week's 168 hours shaded by expected occupancy; a full VPS adds a row marking its usually all-busy hours. */
function OverlapStrip({ serviceName, slots, occupants, overlap }: { serviceName: string; slots: number; occupants: number; overlap: HostOverlap }) {
    return (
        <div role="img" aria-label={hostOverlapSummary(serviceName, slots, occupants, overlap)} className="flex flex-col gap-0.5">
            <div className="flex gap-0.5">{WEEK.map((hours, day) => (
                <span key={day} className="flex">{hours.map((hour) => (
                    <span key={hour} title={hostOverlapCellLabel(overlap, hour, slots)} className={`h-5 w-1 ${HEATMAP_CLASSES[overlapBand(overlap.expected[hour]!, slots)]}`} />
                ))}</span>
            ))}</div>
            {overlap.full && <div className="flex gap-0.5">{WEEK.map((hours, day) => (
                <span key={day} className="flex">{hours.map((hour) => (
                    <span key={hour} className={`h-1 w-1 ${overlap.allBusy[hour]! >= ALL_BUSY_MARK_PROBABILITY ? "bg-crimson" : ""}`} />
                ))}</span>
            ))}</div>}
        </div>
    );
}
