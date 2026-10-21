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
/** What one server bursting needs: the fleet capacity model's burst targets, 1.6 vCPU and 2.5 GiB of RAM. */
export const BURST_VCPU = 1.6;
export const BURST_MEMORY_BYTES = 2.5 * 1024 ** 3;

const HOUR_MILLISECONDS = 3_600_000;
/** Allowance for figures the control plane rounds to two decimals. */
const ROUNDING = 0.01;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const HOUR_VERDICTS = /^[01-]{168}$/u;
const BURST_HOST_KEYS = ["serviceName", "regionKeys", "vCpu", "memoryBytes", "slots", "burstServers", "occupants", "online", "overBurst", "overBurstHours", "measuredPairHours", "coverage"];
// What a control plane that fits on typical demand (#550) reports: the burst fields, kept as information, and its at-once capacity.
const AT_ONCE_HOST_KEYS = [...BURST_HOST_KEYS, "atOnceServers", "overAtOnce", "overAtOnceHours"];
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
    return isRecord(value) && hasExactKeys(value, BURST_HOST_KEYS) && burstFields(value);
}

/**
 * A VPS from a control plane that fits on typical demand (#550): the burst fields as before, and its at-once capacity N,
 * null or a whole number, with 168 hourly verdicts and their count of `1` hours. Which hours are over is the control
 * plane's to work out from its own model, so they are not worked out again here.
 */
function isAtOnceHost(value: unknown): value is HostingPlacementOverlapBurstHost {
    if (!isRecord(value) || !hasExactKeys(value, AT_ONCE_HOST_KEYS) || !burstFields(value)) return false;
    return (value.atOnceServers === null || count(value.atOnceServers, Number.MAX_SAFE_INTEGER))
        && verdicts(value.overAtOnce, value.overAtOnceHours);
}

/** The burst-capacity fields, as both the burst and the at-once shapes report them. */
function burstFields(value: Record<string, unknown>) {
    if (!measuredFields(value)) return false;
    const memory = value.memoryBytes;
    return (memory === null || (Number.isSafeInteger(memory) && (memory as number) > 0))
        // Each server bursting takes 1.6 vCPU and 2.5 GiB, so no more can at once than the VPS has room for. Older
        // control planes counted 2 vCPU or 3 GiB per server, never more servers than this allows.
        && count(value.burstServers, Math.floor((value.vCpu as number) / BURST_VCPU))
        && (memory === null || (value.burstServers as number) <= Math.floor((memory as number) / BURST_MEMORY_BYTES))
        && verdicts(value.overBurst, value.overBurstHours)
        && withinSlots(value as HostingPlacementOverlapBurstHost)
        && consistentOverHours(value as HostingPlacementOverlapBurstHost, value.burstServers as number, value.overBurst as string);
}

/**
 * What the definitions allow hour by hour for a capacity of `limit` burst servers. A VPS with no more
 * servers than that is never over, so it is all `0`. On any other VPS an hour without data is unknown (`-`), and a
 * `1` needs more than `limit` servers each online at least half the hour: at least half of one more than `limit` in
 * all, less the 0.01 rounding allowance.
 */
function consistentOverHours(host: HostingPlacementOverlapBurstHost, limit: number, hours: string) {
    if (host.occupants.length <= limit) return !/[1-]/u.test(hours);
    for (let hour = 0; hour < PLACEMENT_OVERLAP_HOURS; hour += 1) {
        const verdict = hours[hour];
        if (verdict === "-") continue;
        const online = host.online[hour]!;
        if (online === null) return false;
        if (verdict === "1" && online < 0.5 * (limit + 1) - ROUNDING) return false;
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
 * are all in one shape, never a mix: at once, from a control plane that fits on typical demand (#550); burst capacity;
 * or legacy.
 */
export function parsePlacementOverlap(value: unknown): HostingAdminPlacementOverlap | null {
    if (!isRecord(value) || !hasExactKeys(value, ["generatedAt", "windowStartedAt", "windowEndedAt", "hours", "hosts"])) return null;
    if (!timestamp(value.generatedAt) || !hourBoundary(value.windowStartedAt) || !hourBoundary(value.windowEndedAt)) return null;
    if (value.hours !== PLACEMENT_OVERLAP_HOURS) return null;
    if (Date.parse(value.windowEndedAt) - Date.parse(value.windowStartedAt) !== PLACEMENT_OVERLAP_HOURS * HOUR_MILLISECONDS) return null;
    if (!Array.isArray(value.hosts) || !(value.hosts.every(isAtOnceHost) || value.hosts.every(isBurstHost) || value.hosts.every(isLegacyHost))) return null;
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

/** The legend's red key: over at-once capacity once the control plane reports it, over burst capacity before. */
export const OVERLAP_RED_AT_ONCE = "Red: more servers online than the VPS can run at once at what they usually need";
export const OVERLAP_RED_BURST = "Red: more servers online than can each burst to 1.6 vCPU and 2.5 GiB";

/** Whether a VPS reports its at-once capacity, as every host does once the control plane fits on typical demand. */
export function overlapHasAtOnce(host: HostingPlacementOverlapHost): host is HostingPlacementOverlapBurstHost & { atOnceServers: number | null; overAtOnce: string; overAtOnceHours: number } {
    return "atOnceServers" in host;
}

/** Whether the read reports at-once capacity, so its red hours come from it rather than from burst capacity. */
export function overlapReportsAtOnce(overlap: Pick<HostingAdminPlacementOverlap, "hosts">) {
    return overlap.hosts.length > 0 && overlap.hosts.every(overlapHasAtOnce);
}

/**
 * The hours of a VPS's red row. Once the control plane reports at-once capacity they are the hours more of its
 * servers were online than it can run at once (`overAtOnce`), for a VPS with more servers than that; before, the
 * hours over its burst capacity (`overlapBurstRow`). Null for a VPS that cannot exceed either, or whose N is unknown.
 */
export function overlapOverRow(host: HostingPlacementOverlapHost) {
    if (!overlapHasAtOnce(host)) return overlapBurstRow(host);
    return host.atOnceServers !== null && host.occupants.length > host.atOnceServers ? host.overAtOnce : null;
}

/**
 * "10 h over at once" for a VPS with more servers than it can run at once, "Fits at once" for one without, "At once not
 * modelled yet" while N is unknown; null without at-once capacity.
 */
export function overlapAtOnceLabel(host: HostingPlacementOverlapHost) {
    if (!overlapHasAtOnce(host)) return null;
    if (host.atOnceServers === null) return "At once not modelled yet";
    return host.occupants.length > host.atOnceServers ? `${host.overAtOnceHours} h over at once` : "Fits at once";
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

/** The 0–9 shading band for an hour: how much of the VPS's slot capacity was online, from none to all of it. */
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
    const burstVerdict = overlapCanExceedBurst(host) ? host.overBurst[hour] : "0";
    if (overlapHasAtOnce(host)) {
        // At once decides the hour; burst capacity is information.
        const burst = `${host.burstServers} can burst together${burstVerdict === "1" ? ", over burst capacity" : ""}`;
        if (host.atOnceServers === null) return `${measured}; at-once capacity not modelled yet; ${burst}`;
        const atOnce = `${measured}; can run ${host.atOnceServers} at once`;
        const verdict = host.occupants.length > host.atOnceServers ? host.overAtOnce[hour] : "0";
        const over = verdict === "1" ? "; over at-once capacity" : verdict === "-" ? "; over at once unknown (a server has no data)" : "";
        return `${atOnce}${over}; ${burst}`;
    }
    const burst = `${measured}; ${host.burstServers} can burst together`;
    return burstVerdict === "1" ? `${burst}; over burst capacity` : burstVerdict === "-" ? `${burst}; over burst unknown (a server has no data)` : burst;
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
    if (overlapHasAtOnce(host)) {
        if (host.atOnceServers === null) clauses.push("at-once capacity not modelled yet");
        else {
            clauses.push(`can run ${host.atOnceServers} at once`);
            const hours = host.overAtOnceHours;
            clauses.push(host.occupants.length > host.atOnceServers ? `over at once ${hours} ${hours === 1 ? "hour" : "hours"} in the week` : "fits at once");
        }
    }
    if (overlapHasBurst(host)) {
        clauses.push(`${host.burstServers} can burst together`);
        const hours = host.overBurstHours;
        clauses.push(overlapCanExceedBurst(host) ? `over burst ${hours} ${hours === 1 ? "hour" : "hours"} in the week` : "bursts fit");
    }
    clauses.push(peak < 0 ? "no data" : `busiest ${overlapHourLabel(windowStartedAt, peak)}, ${onlineCount(host.online[peak]!)} online`);
    clauses.push(`${Math.round(host.coverage * 100)}% measured`);
    return clauses.join("; ");
}

/**
 * "10 h over burst" for a VPS that can exceed its burst capacity, "Bursts fit" for one that cannot; null without burst
 * capacity. Once the control plane reports at-once capacity, burst capacity is information: "3 can burst together (1.6
 * vCPU, 2.5 GiB each)", in the overlap's own terms, the VPS's vCPUs and RAM at the burst targets. That is not the capacity
 * tab's burst headroom, which counts usable cores at each source's burst CPU, so it is not worded as it is.
 */
export function overlapBurstLabel(host: HostingPlacementOverlapHost) {
    if (!overlapHasBurst(host)) return null;
    if (overlapHasAtOnce(host)) return `${host.burstServers} can burst together (${BURST_VCPU} vCPU, ${BURST_MEMORY_BYTES / 1024 ** 3} GiB each)`;
    return overlapCanExceedBurst(host) ? `${host.overBurstHours} h over burst` : "Bursts fit";
}

/** What the coverage figure measures, in the control plane's terms: its reconcile checks and the states they count. */
export const OVERLAP_COVERAGE_HINT = "Share of the last 168 hours in which every server now on this VPS had at least one counted check, "
    + "wherever it ran then; a VPS with no servers shows 0%. The control plane checks each server about every 5 minutes: running counts as online; stopped, "
    + "awaiting save or failed as offline; drifted or degraded is not counted. A server's online share in an hour is its running "
    + "checks over its counted ones. A server with no counted check in an hour (it didn't exist yet, or its checks were skipped "
    + "while another job ran on it) is unknown there, not offline; an hour with no data from any of them is hatched.";

/** What pair-hours add up: per hour and pair of servers that both have data, the product of their online shares. */
export const OVERLAP_PAIR_HOURS_HINT = "Pair-hours add up, over every pair of servers on this VPS, how much they were online together: "
    + "each hour counts the product of the two servers' online shares, so both online all hour counts 1 and both online for half "
    + "of it counts 0.25. Only hours in which both have data count. Two servers online together for 10 hours make 10 pair-hours; "
    + "three servers all online for 1 hour make 3. Lower means their online times overlap less, so they compete less for the VPS.";

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
