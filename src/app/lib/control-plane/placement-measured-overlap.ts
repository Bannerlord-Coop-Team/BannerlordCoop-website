import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";
import { ControlPlaneAdminError } from "./client";
import { shortServiceName } from "./placement-live-moves";
import type { HostingAdminPlacementOverlap, HostingPlacementOverlapHost } from "./types";

/** The measured window: one week of whole UTC hours. */
export const PLACEMENT_OVERLAP_HOURS = 168;

const HOUR_MILLISECONDS = 3_600_000;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ALL_BUSY = /^[01-]{168}$/u;
// "Mon 12 Oct", as the strip's day labels and hour titles read the window's real dates.
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function timestamp(value: unknown): value is string {
    return typeof value === "string" && TIMESTAMP.test(value) && new Date(value).toISOString() === value;
}

function count(value: unknown, maximum: number) {
    return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function amount(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function text(value: unknown) {
    return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function isOverlapHost(value: unknown): value is HostingPlacementOverlapHost {
    if (!isRecord(value) || !hasExactKeys(value, ["serviceName", "regionKeys", "vCpu", "slots", "occupants", "online", "allBusy", "allBusyHours", "measuredPairHours", "coverage"])) return false;
    return text(value.serviceName)
        && Array.isArray(value.regionKeys) && value.regionKeys.every(text)
        && Number.isSafeInteger(value.vCpu) && (value.vCpu as number) >= 1
        && Number.isSafeInteger(value.slots) && (value.slots as number) >= 2
        && Array.isArray(value.occupants) && value.occupants.every((occupant) => isRecord(occupant)
            && hasExactKeys(occupant, ["serverId", "displayName", "hoursWithData"])
            && text(occupant.serverId) && text(occupant.displayName) && count(occupant.hoursWithData, PLACEMENT_OVERLAP_HOURS))
        && Array.isArray(value.online) && value.online.length === PLACEMENT_OVERLAP_HOURS && value.online.every((online) => online === null || amount(online))
        && typeof value.allBusy === "string" && ALL_BUSY.test(value.allBusy)
        // The count is of the all-busy hours the string marks.
        && count(value.allBusyHours, PLACEMENT_OVERLAP_HOURS) && value.allBusyHours === value.allBusy.split("1").length - 1
        && amount(value.measuredPairHours)
        && amount(value.coverage, 1);
}

/** The `placement-overlap` result, checked key by key; null when anything is not as the contract says. */
export function parsePlacementOverlap(value: unknown): HostingAdminPlacementOverlap | null {
    if (!isRecord(value) || !hasExactKeys(value, ["generatedAt", "windowStartedAt", "windowEndedAt", "hours", "hosts"])) return null;
    if (!timestamp(value.generatedAt) || !timestamp(value.windowStartedAt) || !timestamp(value.windowEndedAt)) return null;
    if (value.hours !== PLACEMENT_OVERLAP_HOURS) return null;
    if (Date.parse(value.windowEndedAt) - Date.parse(value.windowStartedAt) !== PLACEMENT_OVERLAP_HOURS * HOUR_MILLISECONDS) return null;
    if (!Array.isArray(value.hosts) || !value.hosts.every(isOverlapHost)) return null;
    return value as HostingAdminPlacementOverlap;
}

/** Turns a failed overlap read into text, including the rate limit and a control plane that predates the read. */
export function placementOverlapErrorMessage(error: unknown) {
    if (error instanceof ControlPlaneAdminError) {
        if (error.code === "rate_limited") return "You can read the measured overlap six times every five minutes. Wait a few minutes, then refresh.";
        // An older control plane rejects the operation it does not know as an invalid request.
        if (error.code === "invalid_request" || error.code === "unsupported_operation") return "This control plane does not report measured overlap yet.";
        return error.message;
    }
    return error instanceof Error ? error.message : "The measured overlap could not be loaded.";
}

/** The 0–9 shading band for an hour: how much of the VPS's slot capacity was online. */
export function overlapBand(online: number, slots: number) {
    if (!(slots > 0) || !Number.isFinite(online)) return 0;
    // The small allowance keeps exact tenths, such as 0.9 of 3 slots, from rounding down a band.
    return Math.min(9, Math.max(0, Math.floor((online / slots) * 10 + 1e-9)));
}

/** The hour's start in UTC, hour `index` of the window. */
export function overlapHourStart(windowStartedAt: string, index: number) {
    return new Date(Date.parse(windowStartedAt) + index * HOUR_MILLISECONDS);
}

/** "Mon 12 Oct 20:00 UTC" for hour `index` of the window. */
export function overlapHourLabel(windowStartedAt: string, index: number) {
    const start = overlapHourStart(windowStartedAt, index);
    return `${DAY_FORMAT.format(start)} ${String(start.getUTCHours()).padStart(2, "0")}:00 UTC`;
}

/**
 * The window's hours grouped by UTC date, each with its "Mon 12 Oct" label. A window that does not start at
 * midnight begins and ends with part of a day.
 */
export function overlapDays(windowStartedAt: string) {
    const days: Array<{ label: string; hours: number[] }> = [];
    for (let hour = 0; hour < PLACEMENT_OVERLAP_HOURS; hour += 1) {
        const label = DAY_FORMAT.format(overlapHourStart(windowStartedAt, hour));
        const last = days.at(-1);
        if (last?.label === label) last.hours.push(hour);
        else days.push({ label, hours: [hour] });
    }
    return days;
}

function oneDecimal(value: number) {
    return (Math.round(value * 10 + 1e-9) / 10).toFixed(1);
}

function onlineCount(value: number) {
    // Two decimals at most; whole numbers read without them.
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/** Whether every slot is filled, so the all-busy row means something. */
export function overlapIsFull(host: Pick<HostingPlacementOverlapHost, "occupants" | "slots">) {
    return host.occupants.length >= host.slots;
}

/** One hour's tooltip: its date and hour, how many were online and whether every slot was busy. */
export function overlapCellLabel(host: Pick<HostingPlacementOverlapHost, "online" | "allBusy" | "occupants" | "slots">, windowStartedAt: string, hour: number) {
    const when = overlapHourLabel(windowStartedAt, hour);
    const online = host.online[hour];
    if (online === null || online === undefined) return `${when} · no data`;
    const measured = `${when} · ${onlineCount(online)} of ${host.slots} online`;
    if (!overlapIsFull(host)) return `${measured} · not full`;
    const busy = host.allBusy[hour];
    return `${measured} · ${busy === "1" ? "all busy" : busy === "0" ? "not all busy" : "all busy unknown (a server has no data)"}`;
}

/** One sentence describing a VPS's measured week for assistive technology. */
export function overlapSummary(host: HostingPlacementOverlapHost, windowStartedAt: string) {
    const filled = `${shortServiceName(host.serviceName)}: ${host.occupants.length} of ${host.slots} slots`;
    if (host.occupants.length === 0) return `${filled}; empty`;
    // The busiest measured hour, the earliest on a tie; -1 when no hour has data.
    let peak = -1;
    for (let hour = 0; hour < host.online.length; hour += 1) {
        const online = host.online[hour];
        if (online !== null && online !== undefined && (peak < 0 || online > host.online[peak]!)) peak = hour;
    }
    const busy = overlapIsFull(host) ? `all busy ${host.allBusyHours} ${host.allBusyHours === 1 ? "hour" : "hours"} in the week` : "not full";
    const measured = `${Math.round(host.coverage * 100)}% measured`;
    if (peak < 0) return `${filled}; ${busy}; no data; ${measured}`;
    return `${filled}; ${busy}; busiest ${overlapHourLabel(windowStartedAt, peak)}, ${onlineCount(host.online[peak]!)} online; ${measured}`;
}

/** "10 h all busy" for a full VPS; "Not full" while a slot is free. */
export function overlapAllBusyLabel(host: HostingPlacementOverlapHost) {
    return overlapIsFull(host) ? `${host.allBusyHours} h all busy` : "Not full";
}

export function overlapPairHoursLabel(host: Pick<HostingPlacementOverlapHost, "measuredPairHours">) {
    return `${oneDecimal(host.measuredPairHours)} pair-h measured`;
}

export function overlapCoverageLabel(host: Pick<HostingPlacementOverlapHost, "coverage">) {
    return `${Math.round(host.coverage * 100)}% measured`;
}

/** "12 Oct 00:00 – 19 Oct 00:00 UTC" for the window. */
export function overlapWindowLabel(overlap: Pick<HostingAdminPlacementOverlap, "windowStartedAt" | "windowEndedAt">) {
    const format = (value: string) => {
        const date = new Date(value);
        return `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date)} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
    };
    return `${format(overlap.windowStartedAt)} – ${format(overlap.windowEndedAt)} UTC`;
}

/** The VPSs grouped by region, alphabetical with hosts without a region last; each group keeps the read's order. */
export function overlapGroups(hosts: readonly HostingPlacementOverlapHost[]) {
    const groups = new Map<string, HostingPlacementOverlapHost[]>();
    for (const host of hosts) {
        const region = host.regionKeys.length === 0 ? "" : host.regionKeys.map(hostingRegionLabel).join(", ");
        groups.set(region, [...(groups.get(region) ?? []), host]);
    }
    return [...groups].sort(([left], [right]) => Number(left === "") - Number(right === "") || left.localeCompare(right))
        .map(([region, members]) => ({ region: region === "" ? "No region" : region, hosts: members }));
}
