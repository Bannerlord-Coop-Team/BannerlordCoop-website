import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { hostingRegionLabel } from "../../../../supabase/functions/_shared/hosting-regions";
import { ControlPlaneAdminError } from "./client";
import { shortServiceName } from "./placement-live-moves";
import type {
    HostingAdminPlacementOverlap,
    HostingPlacementOverlapBurstHost,
    HostingPlacementOverlapHost,
    HostingPlacementOverlapLegacyHost,
} from "./types";

/** The measured window: one week of whole UTC hours. */
export const PLACEMENT_OVERLAP_HOURS = 168;
/** What one server bursting needs: 2 vCPU and 3 GiB of RAM. */
export const BURST_VCPU = 2;
export const BURST_MEMORY_BYTES = 3 * 1024 ** 3;

const HOUR_MILLISECONDS = 3_600_000;
/** Allowance for figures the control plane rounds to two decimals. */
const ROUNDING = 0.01;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const HOUR_VERDICTS = /^[01-]{168}$/u;
const BURST_HOST_KEYS = ["serviceName", "regionKeys", "vCpu", "memoryBytes", "slots", "burstServers", "occupants", "online", "overBurst", "overBurstHours", "measuredPairHours", "coverage"];
// What a control plane that predates burst capacity (98d1f12a) reports, so a rollback to it still renders.
const LEGACY_HOST_KEYS = ["serviceName", "regionKeys", "vCpu", "slots", "occupants", "online", "allBusy", "allBusyHours", "measuredPairHours", "coverage"];
// "Mon 12 Oct", as the strip's day labels and hour titles read the window's real dates.
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function timestamp(value: unknown): value is string {
    return typeof value === "string" && TIMESTAMP.test(value) && new Date(value).toISOString() === value;
}

/** A time on a whole UTC hour, as the window's bounds always are. */
function hourBoundary(value: unknown): value is string {
    return timestamp(value) && Date.parse(value) % HOUR_MILLISECONDS === 0;
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

/** 168 hourly verdicts, and a count that is of the `1` hours they mark. */
function verdicts(value: unknown, hours: unknown): value is string {
    return typeof value === "string" && HOUR_VERDICTS.test(value)
        && count(hours, PLACEMENT_OVERLAP_HOURS) && hours === value.split("1").length - 1;
}

/** The fields both shapes share, each as the contract says. */
function measuredFields(value: Record<string, unknown>) {
    return text(value.serviceName)
        && Array.isArray(value.regionKeys) && value.regionKeys.every(text)
        && Number.isSafeInteger(value.vCpu) && (value.vCpu as number) >= 1
        && Number.isSafeInteger(value.slots) && (value.slots as number) >= 2
        && Array.isArray(value.occupants) && value.occupants.every((occupant) => isRecord(occupant)
            && hasExactKeys(occupant, ["serverId", "displayName", "hoursWithData"])
            && text(occupant.serverId) && text(occupant.displayName) && count(occupant.hoursWithData, PLACEMENT_OVERLAP_HOURS))
        && Array.isArray(value.online) && value.online.length === PLACEMENT_OVERLAP_HOURS && value.online.every((online) => online === null || amount(online))
        && amount(value.measuredPairHours)
        && amount(value.coverage, 1);
}

/** No more servers than slots, and never more online than servers; online counts are rounded, so that allows 0.01. */
function withinSlots(host: HostingPlacementOverlapHost) {
    const occupants = host.occupants.length;
    return occupants <= host.slots && host.online.every((online) => online === null || online <= occupants + ROUNDING);
}

function isBurstHost(value: unknown): value is HostingPlacementOverlapBurstHost {
    if (!isRecord(value) || !hasExactKeys(value, BURST_HOST_KEYS) || !measuredFields(value)) return false;
    const memory = value.memoryBytes;
    return (memory === null || (Number.isSafeInteger(memory) && (memory as number) > 0))
        // Each server bursting takes 2 vCPU and 3 GiB, so no more can at once than the VPS has room for.
        && count(value.burstServers, Math.floor((value.vCpu as number) / BURST_VCPU))
        && (memory === null || (value.burstServers as number) <= Math.floor((memory as number) / BURST_MEMORY_BYTES))
        && verdicts(value.overBurst, value.overBurstHours)
        && withinSlots(value as HostingPlacementOverlapBurstHost)
        && consistentBurstHours(value as HostingPlacementOverlapBurstHost);
}

/**
 * What the burst definitions allow hour by hour. A VPS with no more servers than can burst together is never
 * over, so it is all `0`. On any other VPS an hour without data is unknown (`-`), and a `1` needs more than
 * `burstServers` servers each online at least half the hour: at least half of one more than `burstServers` in
 * all, less the 0.01 rounding allowance.
 */
function consistentBurstHours(host: HostingPlacementOverlapBurstHost) {
    if (host.occupants.length <= host.burstServers) return !/[1-]/u.test(host.overBurst);
    for (let hour = 0; hour < PLACEMENT_OVERLAP_HOURS; hour += 1) {
        const verdict = host.overBurst[hour];
        if (verdict === "-") continue;
        const online = host.online[hour]!;
        if (online === null) return false;
        if (verdict === "1" && online < 0.5 * (host.burstServers + 1) - ROUNDING) return false;
    }
    return true;
}

function isLegacyHost(value: unknown): value is HostingPlacementOverlapLegacyHost {
    if (!isRecord(value) || !hasExactKeys(value, LEGACY_HOST_KEYS) || !measuredFields(value)) return false;
    return verdicts(value.allBusy, value.allBusyHours)
        && withinSlots(value as HostingPlacementOverlapLegacyHost)
        && consistentAllBusyHours(value as HostingPlacementOverlapLegacyHost);
}

/**
 * What the legacy definitions allow hour by hour: an all-busy verdict (`0` or `1`) only for a full VPS in an hour
 * with data, a `1` needing every server online at least half the hour, less the 0.01 rounding allowance.
 */
function consistentAllBusyHours(host: HostingPlacementOverlapLegacyHost) {
    const occupants = host.occupants.length;
    const full = occupants > 0 && occupants === host.slots;
    for (let hour = 0; hour < PLACEMENT_OVERLAP_HOURS; hour += 1) {
        const busy = host.allBusy[hour];
        if (busy === "-") continue;
        const online = host.online[hour]!;
        if (!full || online === null) return false;
        if (busy === "1" && online < 0.5 * occupants - ROUNDING) return false;
    }
    return true;
}

/**
 * The `placement-overlap` result, checked key by key; null when anything is not as the contract says. Its hosts
 * are all in the burst-capacity shape or all in the legacy one, never a mix.
 */
export function parsePlacementOverlap(value: unknown): HostingAdminPlacementOverlap | null {
    if (!isRecord(value) || !hasExactKeys(value, ["generatedAt", "windowStartedAt", "windowEndedAt", "hours", "hosts"])) return null;
    if (!timestamp(value.generatedAt) || !hourBoundary(value.windowStartedAt) || !hourBoundary(value.windowEndedAt)) return null;
    if (value.hours !== PLACEMENT_OVERLAP_HOURS) return null;
    if (Date.parse(value.windowEndedAt) - Date.parse(value.windowStartedAt) !== PLACEMENT_OVERLAP_HOURS * HOUR_MILLISECONDS) return null;
    if (!Array.isArray(value.hosts) || !(value.hosts.every(isBurstHost) || value.hosts.every(isLegacyHost))) return null;
    // A server occupies one slot, so it appears once in the whole read.
    const serverIds = value.hosts.flatMap((host: HostingPlacementOverlapHost) => host.occupants.map((occupant) => occupant.serverId));
    if (new Set(serverIds).size !== serverIds.length) return null;
    return value as HostingAdminPlacementOverlap;
}

/** Whether a VPS reports burst capacity, as every host does once the control plane does. */
export function overlapHasBurst(host: HostingPlacementOverlapHost): host is HostingPlacementOverlapBurstHost {
    return "burstServers" in host;
}

/** Whether the read comes from a control plane that predates burst capacity, so it has no red hours to show. */
export function overlapPredatesBurst(overlap: Pick<HostingAdminPlacementOverlap, "hosts">) {
    return overlap.hosts.some((host) => !overlapHasBurst(host));
}

/** Whether a VPS holds more servers than can each burst at once, the only kind that can have red hours. */
export function overlapCanExceedBurst(host: HostingPlacementOverlapHost) {
    return overlapHasBurst(host) && host.occupants.length > host.burstServers;
}

/** The hours of a VPS's red row, which only a VPS that can exceed its burst capacity has; null for any other. */
export function overlapBurstRow(host: HostingPlacementOverlapHost) {
    return overlapHasBurst(host) && host.occupants.length > host.burstServers ? host.overBurst : null;
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

/**
 * A date segment's axis label sized to its width: "Mon 12 Oct" from 14 hours, "12 Oct" from 8, the day of the
 * month from 3, and nothing visible for a one- or two-hour sliver; `title` always gives the full date.
 */
export function overlapDayAxisLabel(day: { label: string; hours: readonly number[] }) {
    const [, date = "", month = ""] = day.label.split(" ");
    const hours = day.hours.length;
    const text = hours >= 14 ? day.label : hours >= 8 ? `${date} ${month}` : hours >= 3 ? date : "";
    return { text, title: day.label };
}

function oneDecimal(value: number) {
    return (Math.round(value * 10 + 1e-9) / 10).toFixed(1);
}

function onlineCount(value: number) {
    // Two decimals at most; whole numbers read without them.
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/**
 * One hour's tooltip: its date and hour and how many were online; with burst capacity, also how many can burst
 * together and, on a VPS that can exceed that, whether more were online than that.
 */
export function overlapCellLabel(host: HostingPlacementOverlapHost, windowStartedAt: string, hour: number) {
    const when = overlapHourLabel(windowStartedAt, hour);
    const online = host.online[hour];
    if (online === null || online === undefined) return `${when} · no data`;
    const measured = `${when} · ${onlineCount(online)} online`;
    if (!overlapHasBurst(host)) return measured;
    const burst = `${measured}; ${host.burstServers} can burst together`;
    const verdict = overlapCanExceedBurst(host) ? host.overBurst[hour] : "0";
    return verdict === "1" ? `${burst}; over burst capacity` : verdict === "-" ? `${burst}; over burst unknown (a server has no data)` : burst;
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
    const clauses = [filled];
    if (overlapHasBurst(host)) {
        clauses.push(`${host.burstServers} can burst together`);
        const hours = host.overBurstHours;
        clauses.push(overlapCanExceedBurst(host) ? `over burst ${hours} ${hours === 1 ? "hour" : "hours"} in the week` : "bursts fit");
    }
    clauses.push(peak < 0 ? "no data" : `busiest ${overlapHourLabel(windowStartedAt, peak)}, ${onlineCount(host.online[peak]!)} online`);
    clauses.push(`${Math.round(host.coverage * 100)}% measured`);
    return clauses.join("; ");
}

/** "10 h over burst" for a VPS that can exceed its burst capacity, "Bursts fit" for one that cannot; null without burst capacity. */
export function overlapBurstLabel(host: HostingPlacementOverlapHost) {
    if (!overlapHasBurst(host)) return null;
    return overlapCanExceedBurst(host) ? `${host.overBurstHours} h over burst` : "Bursts fit";
}

/** "3 × 2 vCPU · 3 GiB at once", noting a VPS whose RAM could not be read; null without burst capacity. */
export function overlapBurstCapacityLabel(host: HostingPlacementOverlapHost) {
    if (!overlapHasBurst(host)) return null;
    return `${host.burstServers} × 2 vCPU · 3 GiB at once${host.memoryBytes === null ? " (RAM unknown)" : ""}`;
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
