import { formatPlacementHours, parsePlacementHeatmap, placementServerNames, PLACEMENT_WEEKDAYS, sortPlacementHosts, weekdayLabel } from "./placement";
import type { HostingAdminPlacementPlan, HostingPlacementHost } from "./types";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";

/** Hours in the planner's week, Monday 00:00 UTC first. */
export const PLACEMENT_WEEK_HOURS = 168;
/** An hour is marked when every slot is busy at least this often. */
export const ALL_BUSY_MARK_PROBABILITY = 0.5;

/** Which placement a view shows: the servers each VPS has now, or the ones the plan gives it. */
export type PlacementOverlapSide = "current" | "proposed";

/** How a VPS's slots fill over the week, hour by hour. */
export type HostOverlap = {
    /** Expected servers online in each of the 168 hours. */
    expected: number[];
    /** The chance every slot is busy in each hour; zero throughout while a slot is free. */
    allBusy: number[];
    /** Expected hours per week with every slot busy. */
    allBusyHoursPerWeek: number;
    /** Whether the VPS has a server in every slot. */
    full: boolean;
    /** The hour with the most servers expected online, the earliest on a tie. */
    peakHour: number;
};

export type PlacementOverlapRow = {
    host: HostingPlacementHost;
    occupants: Array<{ serverId: string; displayName: string }>;
    pairHoursPerWeek: number;
    freeSlots: number;
    /** Null while a server on it has no learned weekly activity. */
    overlap: HostOverlap | null;
};

export type PlacementOverlapGroup = { region: string; rows: PlacementOverlapRow[] };

/** The midpoint of the band a heatmap digit stands for: digit d is online with probability (d + 0.5) / 10. */
export function heatmapDigitProbability(digit: number) {
    return (digit + 0.5) / 10;
}

/** The chance that at least `count` of these independently online servers are online together. */
export function probabilityAtLeast(probabilities: readonly number[], count: number) {
    if (count <= 0) return 1;
    if (count > probabilities.length) return 0;
    // exactly[k] is the chance that exactly k of the servers seen so far are online.
    let exactly = [1];
    for (const probability of probabilities) {
        const next = new Array<number>(exactly.length + 1).fill(0);
        exactly.forEach((chance, online) => {
            next[online]! += chance * (1 - probability);
            next[online + 1]! += chance * probability;
        });
        exactly = next;
    }
    return exactly.slice(count).reduce((total, chance) => total + chance, 0);
}

/**
 * Each hour's expected servers online and chance that every slot is busy, from the occupants' heatmaps,
 * treating servers as independent as the planner does. Null when an occupant has no usable heatmap.
 */
export function hostOverlap(slots: number, heatmaps: readonly string[]): HostOverlap | null {
    const occupants = heatmaps.map((heatmap) => parsePlacementHeatmap(heatmap)?.flat().map(heatmapDigitProbability) ?? null);
    if (occupants.some((hours) => hours === null)) return null;
    const hours = occupants as number[][];
    const full = slots > 0 && hours.length >= slots;
    const expected: number[] = [];
    const allBusy: number[] = [];
    let peakHour = 0;
    for (let hour = 0; hour < PLACEMENT_WEEK_HOURS; hour += 1) {
        const probabilities = hours.map((occupant) => occupant[hour]!);
        expected.push(probabilities.reduce((total, probability) => total + probability, 0));
        allBusy.push(full ? probabilityAtLeast(probabilities, slots) : 0);
        if (expected[hour]! > expected[peakHour]!) peakHour = hour;
    }
    return { expected, allBusy, allBusyHoursPerWeek: allBusy.reduce((total, chance) => total + chance, 0), full, peakHour };
}

/** The 0–9 shading band for an hour: how much of the VPS's slot capacity is expected online. */
export function overlapBand(expected: number, slots: number) {
    if (!(slots > 0) || !Number.isFinite(expected)) return 0;
    // The small allowance keeps exact tenths, such as 0.9 of 3 slots, from rounding down a band.
    return Math.min(9, Math.max(0, Math.floor((expected / slots) * 10 + 1e-9)));
}

/** "Tue 20:00 UTC" for an hour of the week. */
export function weekHourLabel(hour: number) {
    const day = PLACEMENT_WEEKDAYS[Math.floor(hour / 24)]!;
    return `${weekdayLabel(day).slice(0, 3)} ${String(hour % 24).padStart(2, "0")}:00 UTC`;
}

/** One decimal, rounding half up: summed probabilities such as 0.95 × 3 land just below the half. */
function oneDecimal(value: number) {
    return (Math.round(value * 10 + 1e-9) / 10).toFixed(1);
}

/** One hour's tooltip, such as "Tue 20:00 UTC · ~2.9 of 3 online · all 3 busy 85%". */
export function hostOverlapCellLabel(overlap: HostOverlap, hour: number, slots: number) {
    const online = `${weekHourLabel(hour)} · ~${oneDecimal(overlap.expected[hour]!)} of ${slots} online`;
    return overlap.full ? `${online} · all ${slots} busy ${Math.round(overlap.allBusy[hour]! * 100)}%` : online;
}

export function slotsFreeLabel(freeSlots: number) {
    return `${freeSlots} ${freeSlots === 1 ? "slot" : "slots"} free`;
}

/** One sentence describing a VPS's week for assistive technology. */
export function hostOverlapSummary(serviceName: string, slots: number, occupants: number, overlap: HostOverlap) {
    const filled = `${serviceName}: ${occupants} of ${slots} slots`;
    if (occupants === 0) return `${filled}; ${slotsFreeLabel(slots)}; no servers`;
    const busiest = `busiest ${weekHourLabel(overlap.peakHour)}, about ${oneDecimal(overlap.expected[overlap.peakHour]!)} online`;
    return overlap.full
        ? `${filled}; all busy about ${Math.round(overlap.allBusyHoursPerWeek)} hours a week; ${busiest}`
        : `${filled}; ${slotsFreeLabel(Math.max(0, slots - occupants))}; ${busiest}`;
}

/** "~144 h/wk all 3 busy" from the week's expected all-busy hours. */
export function allBusyLabel(overlap: HostOverlap, slots: number) {
    return `~${Math.round(overlap.allBusyHoursPerWeek)} h/wk all ${slots} busy`;
}

/** `pairHoursPerWeek` as the overlap view writes it. */
export function pairHoursLabel(pairHoursPerWeek: number) {
    return `${formatPlacementHours(pairHoursPerWeek)} pair-h/wk`;
}

/**
 * The VPSs whose slots can overlap (more than one slot), grouped by region, with each one's servers on
 * the chosen side of the plan. Rows keep the hosts table's order, most contended now first, so switching
 * sides does not reorder them; groups are alphabetical with hosts without a region last.
 */
export function placementHostOverlapGroups(plan: Pick<HostingAdminPlacementPlan, "hosts" | "servers" | "moves">, side: PlacementOverlapSide): PlacementOverlapGroup[] {
    const names = placementServerNames(plan);
    const heatmaps = new Map(plan.servers.map((server) => [server.serverId, server.heatmap]));
    const groups = new Map<string, PlacementOverlapRow[]>();
    for (const host of sortPlacementHosts(plan.hosts)) {
        if (!(host.slots > 1)) continue;
        const placement = host[side];
        const serverIds = Array.isArray(placement.serverIds) ? placement.serverIds : [];
        const region = host.regionKeys.length === 0 ? "" : host.regionKeys.map(hostingRegionLabel).join(", ");
        const rows = groups.get(region) ?? [];
        rows.push({
            host,
            occupants: serverIds.map((serverId) => ({ serverId, displayName: names.get(serverId) ?? serverId })),
            pairHoursPerWeek: placement.pairHoursPerWeek,
            freeSlots: Math.max(0, host.slots - serverIds.length),
            overlap: hostOverlap(host.slots, serverIds.map((serverId) => heatmaps.get(serverId) ?? "")),
        });
        groups.set(region, rows);
    }
    return [...groups].sort(([left], [right]) => Number(left === "") - Number(right === "") || left.localeCompare(right))
        .map(([region, rows]) => ({ region: region === "" ? "No region" : region, rows }));
}
