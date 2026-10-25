import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { hostingRegionLabel, MAXIMUM_REGIONS } from "../../../../supabase/functions/_shared/hosting-regions";
import { ControlPlaneAdminError } from "./client";
import { shortServiceName } from "./placement-live-moves";
import { isVpsProviderId, vpsProviderLabel } from "./vps-providers";
import type {
    HostingAdminFleetCapacity,
    HostingFleetCapacityConcurrentSource,
    HostingFleetCapacityCpuCores,
    HostingFleetCapacityDemand,
    HostingFleetCapacityDemandSource,
    HostingFleetCapacityHost,
    HostingFleetCapacityInstanceType,
    HostingFleetCapacityMemoryBytes,
    HostingFleetCapacityStat,
    HostingFleetCapacityVerdict,
} from "./types";

/** The measured window: one week of hours. */
export const FLEET_CAPACITY_HOURS = 168;
/**
 * The most of each list a read may hold, so a malformed response cannot make the tab draw thousands of rows of
 * 336 cells. Each is well above the control plane's own bounds (64 VPSs and 512 placed servers today), which may
 * rise. Providers need no cap: each appears once and is one of `VPS_PROVIDERS`.
 */
export const FLEET_CAPACITY_LIMITS = { hosts: 256, occupantsPerHost: 64, instanceTypes: 256, regionsPerHost: MAXIMUM_REGIONS } as const;

const HOUR_MILLISECONDS = 3_600_000;
const GIB = 1024 ** 3;
/** Allowance for figures the control plane rounds to three decimals, and for floating-point noise in that sum. */
const ROUNDING = 0.001 + 1e-9;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
/** 168 hours of two lowercase hex digits, or `--` for an hour without data. */
const HOURLY = /^(?:[0-9a-f]{2}|--){168}$/u;
/** The steal hourly value is permille capped at 255, so `ff` reads "25.5% or more". */
const STEAL_CAP_PERMILLE = 255;
/** A VPS's sources; an instance type's demand is its own or a fallback, never a single VPS's. */
const HOST_DEMAND_SOURCES: readonly HostingFleetCapacityDemandSource[] = ["vps", "type", "fleet", "none"];
const TYPE_DEMAND_SOURCES: readonly HostingFleetCapacityDemandSource[] = ["type", "fleet", "none"];
/** The most a read's burst targets may claim: vCPUs, and bytes of memory. */
const MAXIMUM_BURST_VCPU = 256;
const MAXIMUM_BURST_MEMORY_BYTES = 64 * GIB;
const TOP_KEYS = ["generatedAt", "windowStartedAt", "windowEndedAt", "hours", "model", "fleet", "providers", "instanceTypes", "hosts"];
const MODEL_KEYS = [
    "cpuPercentile", "cpuBurstVcpu", "memoryBurstBytes", "memoryPercentile", "minimumRunningHours", "staticBurstVcpuPerServer",
    "staticBurstMemoryBytesPerServer",
];
/**
 * The model and VPS of a control plane from before the memory burst target: it planned memory at its percentile, with
 * no `memoryBurstBytes` or `peakMemoryBytes`. The read accepts either shape, the whole read in one, so the website can
 * deploy first.
 */
const PERCENTILE_MEMORY_MODEL_KEYS = MODEL_KEYS.filter((key) => key !== "memoryBurstBytes");
const DEMAND_KEYS = ["runningServerHours", "samples", "cpuCores", "memoryBytes", "throttledShare", "cpuPressureShare"];
const PROVIDER_KEYS = ["provider", "hosts", "servers", "demand", "steal", "busyCores"];
const INSTANCE_TYPE_KEYS = ["key", "provider", "vCpu", "memoryBytes", "cpuModel", "cpuMhz", "hosts", "servers", "demand", "steal", "modelledServers", "demandSource"];
const HOST_KEYS = [
    "serviceName", "provider", "regionKeys", "vCpu", "memoryBytes", "cpuModel", "cpuMhz", "instanceTypeKey", "slots", "occupants",
    "steal", "busyCores", "cpuPressureShare", "overheadCores", "overheadMemoryBytes", "usableCores", "usableMemoryBytes",
    "stableCpuCores", "peakCpuCores", "peakMemoryBytes", "demandCpuCores", "demandMemoryBytes", "demandSource", "modelledServers",
    "limitedBy", "samples", "stealHourly", "busyHourly",
];
const PERCENTILE_MEMORY_HOST_KEYS = HOST_KEYS.filter((key) => key !== "peakMemoryBytes");
/**
 * A control plane that fits on typical demand (#550) adds these keys, and only these, to the model, every measure,
 * each instance type and each VPS. The read accepts its shape or an earlier one, the whole read in one, so the website
 * can deploy first and the control plane roll back.
 */
const TYPICAL_MODEL_KEYS = [...MODEL_KEYS, "cpuTypicalPercentile", "stealPercentile", "stealFloorThresholdPercent", "concurrentBusyFraction", "concurrentHourShare"];
const STAT_KEYS = ["samples", "mean", "p95", "max"];
const TYPICAL_STAT_KEYS = ["samples", "mean", "p50", "p95", "max"];
const TYPICAL_INSTANCE_TYPE_KEYS = [...INSTANCE_TYPE_KEYS, "effectiveVcpu", "typicalCpuCores", "burstServers", "verdict"];
const TYPICAL_HOST_KEYS = [
    ...HOST_KEYS, "effectiveVcpu", "typicalCpuCores", "burstCpuCores", "burstServers", "concurrentServers", "concurrentSource",
    "concurrentCoverage", "verdict",
];
const VERDICT_KEYS = ["kind", "servers"];
const CONCURRENT_SOURCES: readonly HostingFleetCapacityConcurrentSource[] = ["measured", "worst-case-occupants", "slots"];
// "Mon 12 Oct", as the strips' day labels and hour titles read the window's real dates.
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** Steal shading bands, in permille: below 0.5% is the faintest, 20% or more the full shade. */
const STEAL_BANDS_PERMILLE = [5, 10, 20, 30, 50, 75, 100, 150, 200] as const;

function timestamp(value: unknown): value is string {
    return typeof value === "string" && TIMESTAMP.test(value) && new Date(value).toISOString() === value;
}

function count(value: unknown, minimum = 0) {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}

/** A finite number from 0 to `maximum`. */
function amount(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function text(value: unknown, maximum = 256) {
    return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

/** An instance type's key, `provider|vCpu|GiB|cpu model|MHz`, holds a whole CPU model, so it may be longer. */
function typeKey(value: unknown) {
    return text(value, 512);
}

function nullable(value: unknown, check: (value: unknown) => boolean) {
    return value === null || check(value);
}

/** Each figure no more than the next, allowing for the control plane's rounding. */
function ordered(values: readonly number[]) {
    return values.every((value, index) => index === 0 || values[index - 1]! <= value + ROUNDING);
}

function cpuCores(value: unknown) {
    if (!isRecord(value) || !hasExactKeys(value, ["p50", "p90", "p95", "p99", "max"])) return false;
    const figures = [value.p50, value.p90, value.p95, value.p99, value.max];
    return figures.every((figure) => amount(figure)) && ordered(figures as number[]);
}

function memoryBytes(value: unknown) {
    if (!isRecord(value)) return false;
    const keys = "p99" in value ? ["p50", "p95", "p99", "max"] : ["p50", "p95", "max"];
    if (!hasExactKeys(value, keys)) return false;
    const figures = keys.map((key) => value[key]);
    return figures.every((figure) => count(figure)) && ordered(figures as number[]);
}

function share(value: unknown) {
    return amount(value, 1);
}

function demand(value: unknown) {
    return isRecord(value) && hasExactKeys(value, DEMAND_KEYS)
        && amount(value.runningServerHours) && count(value.samples)
        && nullable(value.cpuCores, cpuCores) && nullable(value.memoryBytes, memoryBytes)
        && nullable(value.throttledShare, share) && nullable(value.cpuPressureShare, share);
}

/**
 * A week's measure: its mean and p95 no more than its max, each from 0 to `maximum`; in the `typical` shape its p50
 * too, no more than its p95.
 */
function stat(maximum: number, typical: boolean) {
    return (value: unknown) => isRecord(value) && hasExactKeys(value, typical ? TYPICAL_STAT_KEYS : STAT_KEYS)
        && count(value.samples) && amount(value.mean, maximum) && amount(value.p95, maximum) && amount(value.max, maximum)
        && ordered([value.mean as number, value.max as number]) && ordered([value.p95 as number, value.max as number])
        && (!typical || (amount(value.p50, maximum) && ordered([value.p50 as number, value.p95 as number])));
}

const percentStat = (typical: boolean) => stat(100, typical);
const coresStat = (typical: boolean) => stat(Number.MAX_SAFE_INTEGER, typical);

function demandSource(sources: readonly HostingFleetCapacityDemandSource[]) {
    return (value: unknown) => sources.includes(value as HostingFleetCapacityDemandSource);
}

function positiveBytes(value: unknown) {
    return count(value, 1);
}

/** A VPS may report a clock of 0 MHz, and an instance type rounds anything under 50 MHz to 0; both read as unknown. */
function mhz(value: unknown) {
    return amount(value);
}

function percentile(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100;
}

/**
 * The read's shape, from its model's keys: `typical` once the control plane fits on typical demand (#550), `burst`
 * with a memory burst target, `percentile` from before it. Every part of a read is in its model's shape.
 */
type Shape = "percentile" | "burst" | "typical";

function shapeOf(model: unknown): Shape {
    if (!isRecord(model)) return "percentile";
    return "cpuTypicalPercentile" in model ? "typical" : "memoryBurstBytes" in model ? "burst" : "percentile";
}

/** The model, in its shape: with typical demand and a memory burst target, with a memory burst target only, or neither. */
function model(value: unknown, shape: Shape) {
    const memoryBurst = shape !== "percentile";
    return isRecord(value) && hasExactKeys(value, shape === "typical" ? TYPICAL_MODEL_KEYS : memoryBurst ? MODEL_KEYS : PERCENTILE_MEMORY_MODEL_KEYS)
        && amount(value.cpuBurstVcpu, MAXIMUM_BURST_VCPU) && (value.cpuBurstVcpu as number) > 0
        && (!memoryBurst || (count(value.memoryBurstBytes, 1) && (value.memoryBurstBytes as number) <= MAXIMUM_BURST_MEMORY_BYTES))
        && percentile(value.cpuPercentile) && percentile(value.memoryPercentile)
        && amount(value.minimumRunningHours)
        && typeof value.staticBurstVcpuPerServer === "number" && Number.isFinite(value.staticBurstVcpuPerServer) && value.staticBurstVcpuPerServer > 0
        && positiveBytes(value.staticBurstMemoryBytesPerServer)
        && (shape !== "typical" || (percentile(value.cpuTypicalPercentile) && percentile(value.stealPercentile)
            && amount(value.stealFloorThresholdPercent, 100) && share(value.concurrentBusyFraction) && share(value.concurrentHourShare)));
}

function provider(value: unknown, typical: boolean) {
    return isRecord(value) && hasExactKeys(value, PROVIDER_KEYS)
        && isVpsProviderId(value.provider) && count(value.hosts) && count(value.servers) && demand(value.demand)
        && nullable(value.steal, percentStat(typical)) && nullable(value.busyCores, coresStat(typical));
}

/**
 * A verdict as the control plane computes it from N (`modelled`), M (`concurrent`) and S (`slots`): `unknown` while N is
 * null, `at-risk` by M − N when N < M, `headroom` by N − S when N > S, else `matches`; `servers` is 0 for the last two.
 */
function verdictOf(value: unknown, modelled: number | null, concurrent: number, slots: number) {
    if (!isRecord(value) || !hasExactKeys(value, VERDICT_KEYS)) return false;
    const expected = modelled === null ? { kind: "unknown", servers: 0 }
        : modelled < concurrent ? { kind: "at-risk", servers: concurrent - modelled }
            : modelled > slots ? { kind: "headroom", servers: modelled - slots }
                : { kind: "matches", servers: 0 };
    return value.kind === expected.kind && value.servers === expected.servers;
}

/**
 * Effective vCPUs, null or no more than the vCPUs allowing for the control plane's rounding. The website does not work
 * them out from the steal: a control plane that changes how it rounds or takes off steal must not break the tab.
 */
function effectiveVcpu(value: unknown, vCpu: number) {
    return nullable(value, (cores) => amount(cores, vCpu + ROUNDING));
}

/** Servers that could burst at once: information only, null or a whole number, not worked out again here. */
function burstServers(value: unknown) {
    return nullable(value, (servers) => count(servers));
}

/** CPU in cores no more than `cap` (the static rule's vCPU per server), allowing for the control plane's rounding. */
function capped(value: unknown, cap: number) {
    return nullable(value, (cores) => amount(cores, cap + ROUNDING));
}

function instanceType(value: unknown, typical: boolean, rule: HostingAdminFleetCapacity["model"]) {
    if (!isRecord(value) || !hasExactKeys(value, typical ? TYPICAL_INSTANCE_TYPE_KEYS : INSTANCE_TYPE_KEYS)) return false;
    const valid = typeKey(value.key) && isVpsProviderId(value.provider) && count(value.vCpu, 1)
        && nullable(value.memoryBytes, positiveBytes) && nullable(value.cpuModel, text) && nullable(value.cpuMhz, mhz)
        && count(value.hosts) && count(value.servers) && demand(value.demand)
        && nullable(value.steal, percentStat(typical))
        && nullable(value.modelledServers, (servers) => count(servers)) && demandSource(TYPE_DEMAND_SOURCES)(value.demandSource);
    if (!valid || !typical) return valid;
    // An instance type answers whether a typical VPS of it runs its static slots at once: they are its S and its M.
    const slots = staticSlots(value.vCpu as number, rule);
    return effectiveVcpu(value.effectiveVcpu, value.vCpu as number)
        && nullable(value.typicalCpuCores, (cores) => amount(cores))
        && burstServers(value.burstServers)
        && verdictOf(value.verdict, value.modelledServers as number | null, slots, slots);
}

function occupant(value: unknown) {
    return isRecord(value) && hasExactKeys(value, ["serverId", "displayName", "demand"])
        && text(value.serverId) && text(value.displayName) && demand(value.demand);
}

/** 168 hourly hex pairs; busy is a percent, so no hour is above `64` (100). */
function hourly(value: unknown, maximum: number) {
    return typeof value === "string" && HOURLY.test(value) && decodeHourly(value).every((hour) => hour === null || hour <= maximum);
}

/**
 * A VPS in the read's shape: with typical demand, with its peak memory (`burst`), or an earlier control plane's without.
 * In the typical shape its added figures are checked for their ranges and the static rule's caps, never worked out again
 * from the control plane's formulas (`rule`'s caps: planned CPU and burst CPU at most its vCPU per server, planned
 * memory at most its memory per server), and its verdict against N, M and S.
 */
function host(value: unknown, shape: Shape, rule: HostingAdminFleetCapacity["model"]) {
    const memoryBurst = shape !== "percentile";
    const typical = shape === "typical";
    if (!isRecord(value) || !hasExactKeys(value, typical ? TYPICAL_HOST_KEYS : memoryBurst ? HOST_KEYS : PERCENTILE_MEMORY_HOST_KEYS)) return false;
    const valid = (!memoryBurst || nullable(value.peakMemoryBytes, (bytes) => count(bytes)))
        && text(value.serviceName) && isVpsProviderId(value.provider)
        && within(value.regionKeys, FLEET_CAPACITY_LIMITS.regionsPerHost) && value.regionKeys.every((key) => text(key))
        && count(value.vCpu, 1) && nullable(value.memoryBytes, positiveBytes)
        && nullable(value.cpuModel, text) && nullable(value.cpuMhz, mhz) && nullable(value.instanceTypeKey, typeKey)
        && count(value.slots)
        && within(value.occupants, FLEET_CAPACITY_LIMITS.occupantsPerHost) && value.occupants.every(occupant)
        && nullable(value.steal, percentStat(typical)) && nullable(value.busyCores, coresStat(typical))
        && nullable(value.cpuPressureShare, share)
        && nullable(value.overheadCores, (cores) => amount(cores)) && nullable(value.overheadMemoryBytes, (bytes) => count(bytes))
        // The control plane clamps what is left after steal and overhead at zero.
        && nullable(value.usableCores, (cores) => amount(cores)) && nullable(value.usableMemoryBytes, (bytes) => count(bytes))
        && nullable(value.stableCpuCores, (cores) => amount(cores)) && nullable(value.peakCpuCores, (cores) => amount(cores))
        && nullable(value.demandCpuCores, (cores) => amount(cores)) && nullable(value.demandMemoryBytes, (bytes) => count(bytes))
        && demandSource(HOST_DEMAND_SOURCES)(value.demandSource)
        && plannedDemand(value, shape)
        && nullable(value.modelledServers, (servers) => count(servers))
        && (value.limitedBy === null || value.limitedBy === "cpu" || value.limitedBy === "memory")
        && count(value.samples)
        && hourly(value.stealHourly, STEAL_CAP_PERMILLE) && hourly(value.busyHourly, 100);
    if (!valid || !typical) return valid;
    const slots = value.slots as number;
    const concurrent = value.concurrentServers;
    return effectiveVcpu(value.effectiveVcpu, value.vCpu as number)
        && nullable(value.typicalCpuCores, (cores) => amount(cores))
        && capped(value.demandCpuCores, 64) && capped(value.burstCpuCores, 64)
        && nullable(value.demandMemoryBytes, (bytes) => count(bytes) && (bytes as number) <= MAXIMUM_BURST_MEMORY_BYTES)
        && burstServers(value.burstServers)
        // M is never more than S; without servers it is S, every slot counted.
        && count(concurrent) && (concurrent as number) <= slots
        && CONCURRENT_SOURCES.includes(value.concurrentSource as HostingFleetCapacityConcurrentSource)
        && (value.concurrentSource !== "slots" || concurrent === slots)
        && share(value.concurrentCoverage)
        && verdictOf(value.verdict, value.modelledServers as number | null, concurrent as number, slots);
}

/**
 * A VPS's per-server figures agree with their source, as the control plane chooses them: none has no figures, and
 * any other source has a positive stable CPU, a peak no lower, and CPU and memory to plan with, and with a memory burst
 * target its peak memory too. Before typical demand the read's model checks the planned figures against the peaks once
 * the whole read is parsed (`burstConsistent`).
 */
function plannedDemand(value: Record<string, unknown>, shape: Shape) {
    const figures = [value.stableCpuCores, value.peakCpuCores, value.demandCpuCores, value.demandMemoryBytes,
        ...(shape !== "percentile" ? [value.peakMemoryBytes] : [])];
    if (value.demandSource === "none") return figures.every((figure) => figure === null);
    return figures.every((figure) => figure !== null)
        && (value.stableCpuCores as number) > 0 && (value.peakCpuCores as number) >= (value.stableCpuCores as number);
}

/**
 * Each planned CPU is the model's burst target, or the peak where higher, to the control plane's three decimals, and
 * with a memory burst target each planned memory is that target, or the peak where higher, to the byte. This is the
 * current control plane's check, kept as it was; a read that fits on typical demand is not worked out again here.
 */
function burstConsistent(capacity: Pick<HostingAdminFleetCapacity, "model" | "hosts">) {
    const { cpuBurstVcpu, memoryBurstBytes } = capacity.model;
    return capacity.hosts.every((entry) => (entry.peakCpuCores === null || entry.demandCpuCores === null
        || Math.abs(entry.demandCpuCores - burstCores(entry.peakCpuCores, cpuBurstVcpu)) <= ROUNDING)
        && (memoryBurstBytes === null || entry.peakMemoryBytes === null
            || entry.demandMemoryBytes === burstBytes(entry.peakMemoryBytes, memoryBurstBytes)));
}

/** A list of at most `maximum` entries. */
function within(value: unknown, maximum: number): value is unknown[] {
    return Array.isArray(value) && value.length <= maximum;
}

function unique(values: readonly string[]) {
    return new Set(values).size === values.length;
}

/**
 * The `fleet-capacity` result, checked key by key; null when anything is not as the contract says. Beyond each
 * field's range, its enums (providers included) and its percentiles' order it checks only what the view keys on,
 * that each provider, instance type and VPS appears once, that each verdict follows from N, M and S, and that no list is
 * longer than `FLEET_CAPACITY_LIMITS`. Before typical demand it also checks that each planned figure follows from its
 * burst target and peak, as it always has; with it, the planned, effective and burst figures are checked only for their
 * ranges and the static rule's caps, so a control plane that adjusts a formula or its rounding does not break the tab.
 *
 * A read is in one of three shapes, keyed by its model and every part of it in the same one: `typical`, from a control
 * plane that fits on typical demand (#550), with its added keys exactly; `burst`, the current control plane's; or
 * `percentile`, from before the memory burst target, which comes back with `memoryBurstBytes` and every
 * `peakMemoryBytes` null. The first two come back exactly as they are. One from before the CPU burst target, without
 * `cpuBurstVcpu`, no longer occurs and is unexpected.
 */
export function parseFleetCapacity(value: unknown): HostingAdminFleetCapacity | null {
    if (!isRecord(value) || !hasExactKeys(value, TOP_KEYS)) return null;
    const shape = shapeOf(value.model);
    const typical = shape === "typical";
    if (!timestamp(value.generatedAt) || !timestamp(value.windowStartedAt) || !timestamp(value.windowEndedAt)) return null;
    if (value.hours !== FLEET_CAPACITY_HOURS) return null;
    if (Date.parse(value.windowEndedAt) - Date.parse(value.windowStartedAt) !== FLEET_CAPACITY_HOURS * HOUR_MILLISECONDS) return null;
    if (!model(value.model, shape)) return null;
    const rule = value.model as HostingAdminFleetCapacity["model"];
    const fleet = value.fleet;
    if (!isRecord(fleet) || !hasExactKeys(fleet, ["hosts", "servers", "demand"]) || !count(fleet.hosts) || !count(fleet.servers) || !demand(fleet.demand)) return null;
    if (!Array.isArray(value.providers) || !value.providers.every((entry) => provider(entry, typical))) return null;
    if (!within(value.instanceTypes, FLEET_CAPACITY_LIMITS.instanceTypes) || !value.instanceTypes.every((entry) => instanceType(entry, typical, rule))) return null;
    if (!within(value.hosts, FLEET_CAPACITY_LIMITS.hosts) || !value.hosts.every((entry) => host(entry, shape, rule))) return null;
    const read = value as HostingAdminFleetCapacity;
    if (!unique(read.providers.map((entry) => entry.provider)) || !unique(read.instanceTypes.map((entry) => entry.key))
        || !unique(read.hosts.map((entry) => entry.serviceName))) return null;
    const capacity = shape !== "percentile" ? read : {
        ...read,
        model: { ...read.model, memoryBurstBytes: null },
        hosts: read.hosts.map((entry) => ({ ...entry, peakMemoryBytes: null })),
    };
    return typical || burstConsistent(capacity) ? capacity : null;
}

/** Whether a parsed read comes from a control plane that fits on typical demand (#550): its model says so. */
export function fleetCapacityTypical(capacity: { model: Pick<HostingAdminFleetCapacity["model"], "cpuTypicalPercentile"> }) {
    return capacity.model.cpuTypicalPercentile !== undefined;
}

/** Turns a failed capacity read into text, including the rate limit and a control plane that predates the read. */
export function fleetCapacityErrorMessage(error: unknown) {
    if (error instanceof ControlPlaneAdminError) {
        if (error.code === "rate_limited") return "You can read fleet capacity six times every five minutes. Wait a few minutes, then refresh.";
        // An older control plane rejects the operation it does not know as an invalid request.
        if (error.code === "invalid_request" || error.code === "unsupported_operation") return "This control plane does not report fleet capacity yet.";
        return error.message;
    }
    return error instanceof Error ? error.message : "Fleet capacity could not be loaded.";
}

/** The 168 hourly values of a hex string, oldest first; null for an hour without data. */
export function decodeHourly(hex: string): Array<number | null> {
    return Array.from({ length: FLEET_CAPACITY_HOURS }, (_, hour) => {
        const pair = hex.slice(hour * 2, hour * 2 + 2);
        return pair === "--" ? null : Number.parseInt(pair, 16);
    });
}

/**
 * The 0–9 shading band of an hour's steal in permille, from least to most steal: under 0.5%, 0.5%, 1%, 2%, 3%, 5%,
 * 7.5%, 10%, 15%, then 20% or more.
 */
export function stealBand(permille: number) {
    return STEAL_BANDS_PERMILLE.filter((threshold) => permille >= threshold).length;
}

/** The 0–9 shading band of an hour's busy percent, from least to most busy: a band per 10%, 90% and over the full shade. */
export function busyBand(percent: number) {
    return Math.min(9, Math.max(0, Math.floor(percent / 10)));
}

function twoDigits(value: number) {
    return String(value).padStart(2, "0");
}

/** "Mon 12 Oct 20:00 UTC" for hour `index` of the window. */
export function capacityHourLabel(windowStartedAt: string, index: number) {
    const start = new Date(Date.parse(windowStartedAt) + index * HOUR_MILLISECONDS);
    return `${DAY_FORMAT.format(start)} ${twoDigits(start.getUTCHours())}:${twoDigits(start.getUTCMinutes())} UTC`;
}

/** Every hour's label, computed once per window rather than once per cell. */
export function capacityHourLabels(windowStartedAt: string) {
    return Array.from({ length: FLEET_CAPACITY_HOURS }, (_, hour) => capacityHourLabel(windowStartedAt, hour));
}

/** "12 Oct 00:00 – 19 Oct 00:00 UTC" for the window. */
export function capacityWindowLabel(capacity: Pick<HostingAdminFleetCapacity, "windowStartedAt" | "windowEndedAt">) {
    const format = (value: string) => {
        const date = new Date(value);
        return `${DATE_FORMAT.format(date)} ${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())}`;
    };
    return `${format(capacity.windowStartedAt)} – ${format(capacity.windowEndedAt)} UTC`;
}

/** "1.23 cores". */
export function formatCores(value: number) {
    return `${value.toFixed(2)} ${value === 1 ? "core" : "cores"}`;
}

/** "1.942 cores": the control plane's own three decimals, where two would hide how a figure was made. */
export function formatCoresExact(value: number) {
    return `${value.toFixed(3)} ${value === 1 ? "core" : "cores"}`;
}

/** "1.80 GiB". */
export function formatGiB(bytes: number) {
    return `${(bytes / GIB).toFixed(2)} GiB`;
}

/**
 * Whether a memory peak reads as above its burst target. Memory is planned to the byte but shown to two decimals, so
 * a peak a few MiB over the target counts as at it, as a CPU peak is compared at the three decimals it is shown with.
 */
function memoryPeakAbove(peakBytes: number, targetBytes: number) {
    return peakBytes > targetBytes && formatGiB(peakBytes) !== formatGiB(targetBytes);
}

/** A percent (0–100) with one decimal, "<0.1%" for a sliver above zero. */
export function formatPercent(value: number) {
    if (value > 0 && value < 0.05) return "<0.1%";
    return `${value.toFixed(1)}%`;
}

/** A share (0–1) as a percent. */
export function formatShare(value: number) {
    return formatPercent(value * 100);
}

/** "1,234.5 server-h". */
export function formatServerHours(value: number) {
    return `${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} server-h`;
}

/** "2,400 MHz". */
export function formatMhz(value: number) {
    return `${Math.round(value).toLocaleString("en-US")} MHz`;
}

/** A clock to show, or null when it is unknown: not reported, or reported (or rounded) as 0 MHz. */
export function knownMhz(value: number | null) {
    return value === null || value <= 0 ? null : value;
}

/** "3 GiB" or "2.5 GiB", as the static rule and the memory burst target read: two decimals at most. */
function ruleGiB(bytes: number) {
    return `${Number((bytes / GIB).toFixed(2))} GiB`;
}

/** "6 vCPU · 11.4 GiB RAM", or "RAM unknown" when the VPS's RAM could not be read. */
export function capacitySizeLabel(entry: { vCpu: number; memoryBytes: number | null }) {
    return `${entry.vCpu} vCPU · ${entry.memoryBytes === null ? "RAM unknown" : `${(entry.memoryBytes / GIB).toFixed(1)} GiB RAM`}`;
}

/** Today's static slots for a VPS of `vCpu`: floor(vCPU ÷ the static rule's vCPU per server). */
export function staticSlots(vCpu: number, model: Pick<HostingAdminFleetCapacity["model"], "staticBurstVcpuPerServer">) {
    return Math.floor(vCpu / model.staticBurstVcpuPerServer + 1e-9);
}

/** The static rule, "2 vCPU · 3 GiB per server". */
export function staticRuleLabel(model: HostingAdminFleetCapacity["model"]) {
    return `${model.staticBurstVcpuPerServer} vCPU · ${ruleGiB(model.staticBurstMemoryBytesPerServer)} per server`;
}

const CPU_PERCENTILES: Record<number, keyof HostingFleetCapacityCpuCores> = { 50: "p50", 90: "p90", 95: "p95", 99: "p99", 100: "max" };
const MEMORY_PERCENTILES: Record<number, keyof HostingFleetCapacityMemoryBytes> = { 50: "p50", 95: "p95", 99: "p99", 100: "max" };

/** The figure at the model's percentile, falling back to p95 for a percentile the demand does not report. */
export function modelCpu(cores: HostingFleetCapacityCpuCores, percentileValue: number) {
    const key = CPU_PERCENTILES[percentileValue] ?? "p95";
    return { key, value: cores[key] };
}

export function modelMemory(bytes: HostingFleetCapacityMemoryBytes, percentileValue: number) {
    const key = MEMORY_PERCENTILES[percentileValue] ?? "p95";
    return { key: key === 'p99' && bytes.p99 === undefined ? 'p95' : key, value: bytes[key] ?? bytes.p95 };
}

/** What one server is planned to need when every one bursts at once: the model's burst target, or its peak where higher. */
export function burstCores(peakCores: number, burstVcpu: number) {
    return Math.max(burstVcpu, peakCores);
}

/** The memory one server is planned to need when every one bursts at once: the target, or its peak where higher. */
export function burstBytes(peakBytes: number, burstMemoryBytes: number) {
    return Math.max(burstMemoryBytes, peakBytes);
}

/**
 * The CPU one server is fitted at once the control plane fits on typical demand: what it usually needs, at least the
 * `floorVcpu` target, its typical CPU where that is higher, and at most `capVcpu`.
 */
export function fitCores(typicalCores: number, floorVcpu: number, capVcpu: number) {
    return Math.min(capVcpu, Math.max(floorVcpu, typicalCores));
}

/**
 * One sentence comparing what a running server uses at the model's percentiles with today's static rule, and what the
 * model plans for each server instead. Each VPS plans each burst target or the peak of its own demand source, and no
 * source peaks above the fleet, so the fleet's peak bounds every plan: at or under a target every VPS plans the target,
 * and above it the plans range from the target to that peak. CPU is bounded so, and memory too with a memory burst
 * target. No source has run long enough while the fleet itself has not, so until then nothing is planned and the
 * sentence stops at what servers use. A read that fits on typical demand (#550) says so instead (`typicalPlan`).
 */
export function staticRuleComparison(capacity: Pick<HostingAdminFleetCapacity, "model" | "fleet">) {
    const { model: rule, fleet } = capacity;
    const reserves = `Today's static rule reserves ${staticRuleLabel(rule)}.`;
    const { cpuCores: cores, memoryBytes: bytes } = fleet.demand;
    if (cores === null || bytes === null) return `${reserves} There is not enough data yet to compare it with what servers use.`;
    const cpu = modelCpu(cores, rule.cpuPercentile);
    const memory = modelMemory(bytes, rule.memoryPercentile);
    const cpuShare = Math.round((cpu.value / rule.staticBurstVcpuPerServer) * 100);
    const memoryShare = Math.round((memory.value / rule.staticBurstMemoryBytesPerServer) * 100);
    const uses = `${reserves} A running server uses ${formatCores(cpu.value)} at ${cpu.key} (${cpuShare}% of ${rule.staticBurstVcpuPerServer} vCPU) and ${formatGiB(memory.value)} at ${memory.key} (${memoryShare}% of ${ruleGiB(rule.staticBurstMemoryBytesPerServer)}).`;
    if (fleet.demand.runningServerHours < rule.minimumRunningHours) return uses;
    if (rule.cpuTypicalPercentile !== undefined && rule.memoryBurstBytes !== null) {
        return `${uses} ${typicalPlan({ ...rule, cpuTypicalPercentile: rule.cpuTypicalPercentile, memoryBurstBytes: rule.memoryBurstBytes }, cores, bytes)}`;
    }
    // Rounded to three decimals as the control plane rounds each VPS's planned CPU, and shown with them.
    const highest = Math.round(burstCores(cores.max, rule.cpuBurstVcpu) * 1_000) / 1_000;
    const share = (value: number) => `${Math.round((value / rule.staticBurstVcpuPerServer) * 100)}% of ${rule.staticBurstVcpuPerServer} vCPU`;
    if (rule.memoryBurstBytes === null) {
        const burst = `${uses} Every online server is planned to burst to ${rule.cpuBurstVcpu} vCPU at once, or to its VPS's measured peak where higher.`;
        if (highest === rule.cpuBurstVcpu) {
            return `${burst} No peak is above the target (the fleet's highest is ${formatCoresExact(cores.max)}), so every VPS plans ${formatCoresExact(highest)} per server (${share(highest)}).`;
        }
        return `${burst} The fleet's highest peak is ${formatCoresExact(cores.max)}, so VPSs plan from ${formatCoresExact(rule.cpuBurstVcpu)} to ${formatCoresExact(highest)} per server (${share(highest)} at most); each VPS's own is in its per-server column.`;
    }
    // Memory is planned to the byte, so its bound needs no rounding.
    const highestBytes = burstBytes(bytes.max, rule.memoryBurstBytes);
    const memoryShareOf = (value: number) => `${Math.round((value / rule.staticBurstMemoryBytesPerServer) * 100)}% of ${ruleGiB(rule.staticBurstMemoryBytesPerServer)}`;
    const cpuPlan = highest === rule.cpuBurstVcpu
        ? `no CPU peak is above its target (the fleet's highest is ${formatCoresExact(cores.max)}), so every VPS plans ${formatCoresExact(highest)} per server (${share(highest)})`
        : `the fleet's highest CPU peak is ${formatCoresExact(cores.max)}, so VPSs plan from ${formatCoresExact(rule.cpuBurstVcpu)} to ${formatCoresExact(highest)} per server (${share(highest)} at most)`;
    const memoryAbove = memoryPeakAbove(highestBytes, rule.memoryBurstBytes);
    const memoryPlan = !memoryAbove
        ? `no memory peak is above its target (the fleet's highest is ${formatGiB(bytes.max)}), so every VPS plans ${formatGiB(highestBytes)} per server (${memoryShareOf(highestBytes)})`
        : `the fleet's highest memory peak is ${formatGiB(bytes.max)}, so VPSs plan from ${formatGiB(rule.memoryBurstBytes)} to ${formatGiB(highestBytes)} per server (${memoryShareOf(highestBytes)} at most)`;
    const own = highest === rule.cpuBurstVcpu && !memoryAbove ? "" : "; each VPS's own is in its per-server column";
    return `${uses} Every online server is planned to burst to ${rule.cpuBurstVcpu} vCPU and ${ruleGiB(rule.memoryBurstBytes)} at once, or to its VPS's measured peaks where higher; ${cpuPlan}, and ${memoryPlan}${own}.`;
}

/**
 * What a model that fits on typical demand plans, for the summary. Each VPS fits CPU at the burst target, or its demand
 * source's typical percentile where higher, at most the static rule's vCPU per server: the read checks every VPS's plan
 * so, and the fleet's own figure shows the level. Memory is the target, or the peak where higher, at most the static rule's memory per server, and no
 * source peaks above the fleet, so the fleet's peak bounds every memory plan. Bursting is described only as headroom.
 */
function typicalPlan(rule: HostingAdminFleetCapacity["model"] & { cpuTypicalPercentile: number; memoryBurstBytes: number },
    cores: HostingFleetCapacityCpuCores, bytes: HostingFleetCapacityMemoryBytes) {
    if (rule.memoryPercentile === 99) return `Each server plans its measured CPU p95 and working-set p99 over the rolling week. New servers use the measured fleet demand after six running hours of history. CPU is normalized for the evaluated hardware. Peaks are informational. The policy slot floors remain in effect.`;
    const cap = rule.staticBurstVcpuPerServer;
    const typical = modelCpu(cores, rule.cpuTypicalPercentile);
    // Rounded to three decimals as the control plane rounds each VPS's planned CPU, and shown with them.
    const fit = Math.round(fitCores(typical.value, rule.cpuBurstVcpu, cap) * 1_000) / 1_000;
    const fleetFit = `the fleet's ${typical.key} is ${formatCoresExact(typical.value)}, which fits at ${formatCoresExact(fit)} per server, ${Math.round((fit / cap) * 100)}% of ${cap} vCPU`;
    // Memory is planned to the byte, so its bound needs no rounding.
    const highestBytes = Math.min(rule.staticBurstMemoryBytesPerServer, burstBytes(bytes.max, rule.memoryBurstBytes));
    const memoryShareOf = (value: number) => `${Math.round((value / rule.staticBurstMemoryBytesPerServer) * 100)}% of ${ruleGiB(rule.staticBurstMemoryBytesPerServer)}`;
    const memoryPlan = !memoryPeakAbove(highestBytes, rule.memoryBurstBytes)
        ? `no memory peak is above its target (the fleet's highest is ${formatGiB(bytes.max)}), so every VPS plans ${formatGiB(highestBytes)} per server (${memoryShareOf(highestBytes)})`
        : `the fleet's highest memory peak is ${formatGiB(bytes.max)}, so VPSs plan from ${formatGiB(rule.memoryBurstBytes)} to ${formatGiB(highestBytes)} per server (${memoryShareOf(highestBytes)} at most)`;
    return `Each VPS is fitted at what its servers usually need, not at their peaks: CPU at the ${rule.cpuBurstVcpu} vCPU target, or the ${typical.key} of its demand source where higher, at most ${cap} vCPU (${fleetFit}), and memory at ${ruleGiB(rule.memoryBurstBytes)} or the peak where higher, at most ${ruleGiB(rule.staticBurstMemoryBytesPerServer)}; ${memoryPlan}. Bursting to ${rule.cpuBurstVcpu} vCPU, or the peak where higher, at most ${cap} vCPU, is shown as burst headroom and never decides a verdict. Each VPS's own figures are in its per-server column.`;
}

export type FleetCapacityDataState = "empty" | "sparse" | "ready";

/**
 * How much the read can say yet: `empty` before the first samples, `sparse` while the fleet has less than an
 * instance type needs or no demand figures, `ready` otherwise.
 */
export function fleetCapacityDataState(capacity: Pick<HostingAdminFleetCapacity, "model" | "fleet" | "hosts">): FleetCapacityDataState {
    const demandFigures = capacity.fleet.demand;
    if (demandFigures.samples === 0 && capacity.hosts.every((entry) => entry.samples === 0)) return "empty";
    if (demandFigures.cpuCores === null || demandFigures.memoryBytes === null || demandFigures.runningServerHours < capacity.model.minimumRunningHours) return "sparse";
    return "ready";
}

/** The note shown while there is little or no data, or null once there is enough. */
export function fleetCapacityDataNote(capacity: Pick<HostingAdminFleetCapacity, "model" | "fleet" | "hosts">) {
    const state = fleetCapacityDataState(capacity);
    if (state === "empty") {
        return "Not enough data yet: no resource samples have arrived. They start once the runners report resource counters, and figures fill in from the first 5-minute samples. Until then every figure shows —.";
    }
    if (state === "sparse") {
        const hours = capacity.fleet.demand.runningServerHours;
        return `Not enough data yet: the fleet has ${formatServerHours(hours)} of running data, and the model plans with a VPS's own servers', an instance type's or the whole fleet's figures only once it has ${formatServerHours(capacity.model.minimumRunningHours)}. Until then no VPS is modelled, and figures without data show —.`;
    }
    return null;
}

/**
 * Whether a VPS lacks host metrics: its steal and busy cores come from host counters, which a VPS can lack while
 * its servers report their own. Without them its overhead, usable capacity and servers at once are unknown too.
 */
export function hostMetricsMissing(host: Pick<HostingFleetCapacityHost, "steal" | "busyCores">) {
    return host.steal === null || host.busyCores === null;
}

/** What a VPS without host metrics says in place of them. */
export const HOST_METRICS_MISSING = "Host metrics not measured yet";

/**
 * The note shown when some VPSs lack host metrics while there is other data, or null. Before any sample arrives
 * the empty-state note already says so for every VPS.
 */
export function fleetCapacityHostNote(capacity: Pick<HostingAdminFleetCapacity, "model" | "fleet" | "hosts">) {
    if (fleetCapacityDataState(capacity) === "empty") return null;
    const missing = capacity.hosts.filter(hostMetricsMissing).length;
    if (missing === 0) return null;
    const of = `${missing} of ${capacity.hosts.length} ${capacity.hosts.length === 1 ? "VPS" : "VPSs"}`;
    return `${HOST_METRICS_MISSING} on ${of}: their runners have not reported host counters in the window, so their steal, busy cores, overhead, usable capacity and servers at once show — even where their servers' own needs are measured.`;
}

export type ModelledVerdict = { kind: "risk" | "headroom" | "match" | "unknown"; label: string; description: string };

/**
 * Modelled servers against a VPS's slots: fewer is at risk when they all run at once, more is headroom. `label`
 * is the short cue ("At risk −1"), `description` the sentence behind it.
 */
export function modelledVerdict(modelled: number | null, slots: number): ModelledVerdict {
    const of = `${slots} ${slots === 1 ? "slot" : "slots"}`;
    if (modelled === null) return { kind: "unknown", label: "Not modelled yet", description: "Not enough data yet to model this." };
    if (modelled < slots) {
        return { kind: "risk", label: `At risk −${slots - modelled}`, description: `${slots - modelled} fewer than its ${of}: at risk when every slot's server runs at once.` };
    }
    if (modelled > slots) return { kind: "headroom", label: `Headroom +${modelled - slots}`, description: `${modelled - slots} more than its ${of}: room for more servers.` };
    return { kind: "match", label: "Matches", description: `As many as its ${of}.` };
}

function serverCount(count: number) {
    return `${count} ${count === 1 ? "server" : "servers"}`;
}

/**
 * The verdict a VPS or an instance type shows. From a control plane that fits on typical demand (#550) it is the read's
 * own `verdict`, of N (`modelledServers`) against M (`concurrentServers`, or for an instance type its static slots) and
 * S (`slots`); from an earlier one, N against S (`modelledVerdict`). Burst headroom never enters it.
 */
export function capacityVerdict(entry: { modelledServers: number | null; verdict?: HostingFleetCapacityVerdict; concurrentServers?: number }, slots: number): ModelledVerdict {
    const verdict = entry.verdict;
    if (verdict === undefined) return modelledVerdict(entry.modelledServers, slots);
    const of = `${slots} ${slots === 1 ? "slot" : "slots"}`;
    const concurrent = entry.concurrentServers ?? slots;
    switch (verdict.kind) {
    case "unknown": return { kind: "unknown", label: "Not modelled yet", description: "Not enough data yet to model this." };
    case "at-risk":
        return { kind: "risk", label: `At risk −${verdict.servers}`, description: `${serverCount(verdict.servers)} more online together than it can run at once: up to ${concurrent} co-online, ${entry.modelledServers} at once.` };
    case "headroom":
        return { kind: "headroom", label: `Headroom +${verdict.servers}`, description: `${verdict.servers} more than its ${of}: room for more servers even with every slot's server online at once.` };
    case "matches":
        return { kind: "match", label: "Matches", description: `It can run ${entry.modelledServers} at once: enough for its ${concurrent} co-online, and no more than its ${of}.` };
    }
}

/** "Can run 4 at once", or "Not modelled yet" while N is unknown. */
export function atOnceLabel(modelled: number | null) {
    return modelled === null ? "Not modelled yet" : `Can run ${modelled} at once`;
}

/**
 * A VPS's co-online servers as its source allows: "co-online 3" measured, with the worst case named where a server
 * without enough samples counts as always online, and "co-online unmeasured, using slots" where every slot counts: a VPS
 * without servers, or every VPS while the control plane cannot read the servers' online history.
 */
export function concurrentLabel(host: { concurrentServers: number; concurrentSource: HostingFleetCapacityConcurrentSource }) {
    if (host.concurrentSource === "slots") return "co-online unmeasured, using slots";
    if (host.concurrentSource === "worst-case-occupants") return `co-online ${host.concurrentServers} (some servers counted as always online)`;
    return `co-online ${host.concurrentServers}`;
}

/**
 * A VPS's at-once figures in one line: "Can run 4 at once · co-online 3 · slots 3" from a control plane that fits on
 * typical demand, and today's "4 / 3 slots" from an earlier one.
 */
export function capacityAtOnceSummary(host: Pick<HostingFleetCapacityHost, "modelledServers" | "slots" | "concurrentServers" | "concurrentSource">) {
    if (host.concurrentServers === undefined || host.concurrentSource === undefined) {
        return `${host.modelledServers ?? "—"} / ${host.slots} ${host.slots === 1 ? "slot" : "slots"}`;
    }
    return `${atOnceLabel(host.modelledServers)} · ${concurrentLabel({ concurrentServers: host.concurrentServers, concurrentSource: host.concurrentSource })} · slots ${host.slots}`;
}

/**
 * How many could burst at once, information only: "Burst headroom: 2 could burst at once (2.000 cores each)", without
 * the burst CPU for an instance type, which reports none; null without the figure.
 */
export function burstHeadroomLabel(entry: { burstServers?: number | null; burstCpuCores?: number | null }) {
    if (entry.burstServers === undefined || entry.burstServers === null) return null;
    const each = entry.burstCpuCores === undefined || entry.burstCpuCores === null ? "" : ` (${formatCoresExact(entry.burstCpuCores)} each)`;
    return `Burst headroom: ${entry.burstServers} could burst at once${each}`;
}

/** "5.963 effective vCPU": vCPU less the steal the model takes off, to the control plane's three decimals. */
export function effectiveVcpuLabel(value: number) {
    return `${value.toFixed(3)} effective vCPU`;
}

/**
 * Steal as a VPS's row reads it: "0.4% · 1.2% · 6.5%", its mean, p95 and max, or its p50, p95 and max once the
 * control plane fits on typical demand and takes the p50 off the vCPUs.
 */
export function stealFigures(steal: HostingFleetCapacityStat) {
    return `${formatPercent(steal.p50 ?? steal.mean)} · ${formatPercent(steal.p95)} · ${formatPercent(steal.max)}`;
}

export function demandSourceLabel(source: HostingFleetCapacityDemandSource) {
    return source === "vps" ? "This VPS" : source === "type" ? "Type" : source === "fleet" ? "Fleet" : "None yet";
}

/**
 * Where a VPS's per-server figures come from and how they are made, under them: its source, the burst targets it plans
 * and its source's peaks. "This VPS · 1.6 vCPU, 2.5 GiB burst · peaks 1.372 cores, 2.26 GiB" while both peaks are
 * within their targets; a target is left out once its peak is above it, as in "This VPS · 2.5 GiB burst · peaks
 * 1.950 cores, 2.26 GiB" or "This VPS · peaks 1.950 cores, 2.60 GiB". Without a memory burst target, memory is planned
 * at its percentile and only the CPU is described: "This VPS · 1.6 vCPU burst · peak 1.445", or "This VPS · peak
 * 1.900" above the target. "None yet" without a source. The CPU peak has three decimals, as the planned figure above
 * it does (`formatCoresExact`).
 *
 * Once the control plane fits on typical demand (#550), CPU is fitted at the burst target, or its source's typical
 * percentile where higher, at most the static rule's vCPU per server, and memory at its target, or the peak where
 * higher, at most the static rule's memory: "This VPS · 1.6 vCPU target (p95 1.418) · 2.5 GiB memory target · peaks
 * 2.720 cores, 1.43 GiB", "Type · p95 1.800 · peaks 2.720 cores, 2.60 GiB", or "This VPS · p95 2.150 capped at 2 vCPU ·
 * 3 GiB memory cap · peaks 2.720 cores, 3.25 GiB".
 */
export function perServerSourceLabel(host: Pick<HostingFleetCapacityHost, "demandSource" | "peakCpuCores" | "peakMemoryBytes" | "typicalCpuCores">,
    capacityModel: Pick<HostingAdminFleetCapacity["model"], "cpuBurstVcpu" | "memoryBurstBytes" | "cpuTypicalPercentile" | "staticBurstVcpuPerServer" | "staticBurstMemoryBytesPerServer"> & { memoryPercentile?: number }) {
    const source = demandSourceLabel(host.demandSource);
    if (capacityModel.memoryPercentile === 99) return `${source} · measured CPU p95 / memory p99 · peaks ${host.peakCpuCores === null ? "—" : formatCoresExact(host.peakCpuCores)}, ${host.peakMemoryBytes === null ? "—" : formatGiB(host.peakMemoryBytes)}`;
    if (host.demandSource === "none" || host.peakCpuCores === null) return source;
    if (capacityModel.cpuTypicalPercentile !== undefined && host.typicalCpuCores !== undefined && host.typicalCpuCores !== null
        && capacityModel.memoryBurstBytes !== null && host.peakMemoryBytes !== null) {
        const cap = capacityModel.staticBurstVcpuPerServer;
        const memoryCap = capacityModel.staticBurstMemoryBytesPerServer;
        const percentileKey = `p${capacityModel.cpuTypicalPercentile}`;
        const typical = `${percentileKey} ${formatCoresExact(host.typicalCpuCores).replace(/ cores$/u, "")}`;
        const cpu = host.typicalCpuCores > cap ? `${typical} capped at ${cap} vCPU`
            : host.typicalCpuCores > capacityModel.cpuBurstVcpu ? typical : `${capacityModel.cpuBurstVcpu} vCPU target (${typical})`;
        const memory = !memoryPeakAbove(host.peakMemoryBytes, capacityModel.memoryBurstBytes) ? `${ruleGiB(capacityModel.memoryBurstBytes)} memory target`
            : memoryPeakAbove(host.peakMemoryBytes, memoryCap) ? `${ruleGiB(memoryCap)} memory cap` : null;
        return [source, cpu, memory, `peaks ${formatCoresExact(host.peakCpuCores)}, ${formatGiB(host.peakMemoryBytes)}`].filter((part) => part !== null).join(" · ");
    }
    const cpuTarget = host.peakCpuCores > capacityModel.cpuBurstVcpu ? null : `${capacityModel.cpuBurstVcpu} vCPU`;
    if (capacityModel.memoryBurstBytes === null || host.peakMemoryBytes === null) {
        const peak = `peak ${formatCoresExact(host.peakCpuCores).replace(/ cores$/u, "")}`;
        return cpuTarget === null ? `${source} · ${peak}` : `${source} · ${cpuTarget} burst · ${peak}`;
    }
    const memoryTarget = memoryPeakAbove(host.peakMemoryBytes, capacityModel.memoryBurstBytes) ? null : ruleGiB(capacityModel.memoryBurstBytes);
    const targets = [cpuTarget, memoryTarget].filter((target) => target !== null);
    const peaks = `peaks ${formatCoresExact(host.peakCpuCores)}, ${formatGiB(host.peakMemoryBytes)}`;
    return targets.length === 0 ? `${source} · ${peaks}` : `${source} · ${targets.join(", ")} burst · ${peaks}`;
}

export function limitedByLabel(limitedBy: HostingFleetCapacityHost["limitedBy"]) {
    return limitedBy === "cpu" ? "CPU" : limitedBy === "memory" ? "Memory" : null;
}

/**
 * One occupant's needs, each figure with its own percentile: "1.10 cores stable (p50), peak 1.40 · 1.65 GiB at p95",
 * its CPU at the model's stable percentile and its highest interval, and its memory at p95; with a memory burst
 * target its memory's highest interval too, "· 1.65 GiB at p95, peak 1.90"; or that it has no data yet. Once the
 * control plane fits on typical demand, its CPU at the typical percentile is shown too: "1.10 cores stable (p50),
 * p95 1.32, peak 1.40".
 */
export function occupantDemandLabel(occupantDemand: HostingFleetCapacityDemand,
    capacityModel: Pick<HostingAdminFleetCapacity["model"], "cpuPercentile" | "memoryBurstBytes" | "cpuTypicalPercentile">) {
    if (occupantDemand.cpuCores === null && occupantDemand.memoryBytes === null) return "no data yet";
    const stable = occupantDemand.cpuCores === null ? null : modelCpu(occupantDemand.cpuCores, capacityModel.cpuPercentile);
    const typical = occupantDemand.cpuCores === null || capacityModel.cpuTypicalPercentile === undefined ? null
        : modelCpu(occupantDemand.cpuCores, capacityModel.cpuTypicalPercentile);
    const cpu = stable === null || occupantDemand.cpuCores === null ? "CPU —"
        : `${formatCores(stable.value)} stable (${stable.key}), ${typical === null ? "" : `${typical.key} ${formatCores(typical.value).replace(/ cores$/u, "")}, `}peak ${formatCores(occupantDemand.cpuCores.max).replace(/ cores$/u, "")}`;
    const bytes = occupantDemand.memoryBytes;
    const memory = bytes?.p99 !== undefined ? `${formatGiB(bytes.p99)} at p99, peak ${formatGiB(bytes.max).replace(/ GiB$/u, "")}` : bytes === null ? "memory —" : capacityModel.memoryBurstBytes === null ? `${formatGiB(bytes.p95)} at p95`
        : `${formatGiB(bytes.p95)} at p95, peak ${formatGiB(bytes.max).replace(/ GiB$/u, "")}`;
    return `${cpu} · ${memory}`;
}

/** An hour of steal as its title reads it: one decimal, and "25.5% or more" at the cap. */
export function stealHourValue(permille: number) {
    return permille >= STEAL_CAP_PERMILLE ? "25.5% or more" : `${(permille / 10).toFixed(1)}%`;
}

export function stealCellLabel(hourLabel: string, permille: number | null) {
    return permille === null ? `${hourLabel} · no data` : `${hourLabel} · steal ${stealHourValue(permille)}`;
}

export function busyCellLabel(hourLabel: string, percent: number | null) {
    return percent === null ? `${hourLabel} · no data` : `${hourLabel} · busy ${percent}%`;
}

/** The busiest measured hour, the earliest on a tie, the mean of measured hours and how many were measured. */
function hourlySummary(values: readonly (number | null)[]) {
    let peak = -1, total = 0, measured = 0;
    values.forEach((value, hour) => {
        if (value === null) return;
        measured += 1;
        total += value;
        if (peak < 0 || value > values[peak]!) peak = hour;
    });
    return { peak, mean: measured === 0 ? 0 : total / measured, measured };
}

/** One sentence describing a VPS's hourly steal for assistive technology. */
export function stealStripSummary(serviceName: string, values: readonly (number | null)[], hourLabels: readonly string[]) {
    const name = `${shortServiceName(serviceName)} steal by hour`;
    const { peak, mean, measured } = hourlySummary(values);
    if (peak < 0) return `${name}: no data yet`;
    return `${name}: highest ${stealHourValue(values[peak]!)} at ${hourLabels[peak]}; mean ${formatPercent(mean / 10)} over ${measured} of ${FLEET_CAPACITY_HOURS} hours measured`;
}

/** One sentence describing a VPS's hourly busy percent for assistive technology. */
export function busyStripSummary(serviceName: string, values: readonly (number | null)[], hourLabels: readonly string[]) {
    const name = `${shortServiceName(serviceName)} busy by hour`;
    const { peak, mean, measured } = hourlySummary(values);
    if (peak < 0) return `${name}: no data yet`;
    return `${name}: highest ${values[peak]}% at ${hourLabels[peak]}; mean ${Math.round(mean)}% over ${measured} of ${FLEET_CAPACITY_HOURS} hours measured`;
}

/**
 * An instance type as people read it, "OVHcloud · 6 vCPU · 11.68 GiB · Intel Core Processor (Haswell, no TSX) ·
 * 2,400 MHz": the parts of its key without the raw provider id. RAM uses `formatGiB`, as the row's RAM cell does,
 * so the two always agree; MemTotal is never a whole GiB, unlike the key's rounded figure.
 */
export function fleetCapacityTypeLabel(entry: Pick<HostingFleetCapacityInstanceType, "provider" | "vCpu" | "memoryBytes" | "cpuModel" | "cpuMhz">) {
    const mhzKnown = knownMhz(entry.cpuMhz);
    return [
        vpsProviderLabel(entry.provider),
        `${entry.vCpu} vCPU`,
        entry.memoryBytes === null ? "RAM unknown" : formatGiB(entry.memoryBytes),
        entry.cpuModel ?? "CPU model unknown",
        mhzKnown === null ? "MHz unknown" : formatMhz(mhzKnown),
    ].join(" · ");
}

export type FleetCapacityHostGroup = { label: string; hosts: HostingFleetCapacityHost[] };

/**
 * The VPSs grouped by provider, then region: alphabetical, hosts without a region last in their provider. Within
 * a group VPSs with samples keep the read's order, and those without any come last.
 */
export function fleetCapacityHostGroups(hosts: readonly HostingFleetCapacityHost[]): FleetCapacityHostGroup[] {
    const groups = new Map<string, { provider: string; region: string; hosts: HostingFleetCapacityHost[] }>();
    for (const entry of hosts) {
        const provider = vpsProviderLabel(entry.provider);
        const region = entry.regionKeys.length === 0 ? "" : entry.regionKeys.map(hostingRegionLabel).join(", ");
        const key = `${provider}\u0000${region}`;
        const group = groups.get(key) ?? { provider, region, hosts: [] };
        group.hosts.push(entry);
        groups.set(key, group);
    }
    return [...groups.values()]
        .sort((left, right) => left.provider.localeCompare(right.provider) || Number(left.region === "") - Number(right.region === "") || left.region.localeCompare(right.region))
        .map((group) => ({
            label: `${group.provider} · ${group.region === "" ? "No region" : group.region}`,
            hosts: [...group.hosts.filter((entry) => entry.samples > 0), ...group.hosts.filter((entry) => entry.samples === 0)],
        }));
}

/**
 * The explanations behind each figure's tooltip, with the model's own thresholds and burst targets. A read that fits on
 * typical demand (#550) explains its fit, steal p50, co-online count, verdict and burst headroom; an earlier one keeps
 * the tooltips it had (`earlierHints`), with no text for the figures it lacks. `memory`, `p50`,
 * `p95` and `max` describe memory figures; with a memory burst target they say that the model plans the target or the
 * peak and shows the p95 for comparison, and without one that it plans the p95.
 */
export function fleetCapacityHints(capacityModel: HostingAdminFleetCapacity["model"]) {
    const earlier = earlierHints(capacityModel);
    const { cpuTypicalPercentile, stealPercentile, stealFloorThresholdPercent, concurrentBusyFraction, concurrentHourShare, memoryBurstBytes } = capacityModel;
    if (cpuTypicalPercentile === undefined || stealPercentile === undefined || stealFloorThresholdPercent === undefined
        || concurrentBusyFraction === undefined || concurrentHourShare === undefined || memoryBurstBytes === null) return earlier;
    const cap = `${capacityModel.staticBurstVcpuPerServer} vCPU`;
    const memoryCap = ruleGiB(capacityModel.staticBurstMemoryBytesPerServer);
    const memoryBurst = ruleGiB(memoryBurstBytes);
    const cpuBurst = `${capacityModel.cpuBurstVcpu} vCPU`;
    const typical = `p${cpuTypicalPercentile}`;
    const steal = `p${stealPercentile}`;
    const busy = concurrentBusyFraction === 0.5 ? "half" : `${Number((concurrentBusyFraction * 100).toFixed(2))}%`;
    const hourShare = `${Number((concurrentHourShare * 100).toFixed(2))}%`;
    const workingSet = "Memory one server used (its working set) at the end of each running interval of about 5 minutes, in GiB.";
    const hints = {
        ...earlier,
        memory: `${workingSet} The model plans memory at ${memoryBurst}, or the peak where higher, at most ${memoryCap}.`,
        max: `The highest interval in the week. Each VPS plans the peak of its own demand source (its own servers, its instance type or the fleet) where that is above the ${memoryBurst} target, at most ${memoryCap}, as its per-server column shows; no source peaks above this.`,
        cpuP50: `p50: the median. Half of the intervals were at or below this: a server's stable CPU use, shown for comparison. The model fits CPU at the ${cpuBurst} target or the ${typical} where higher, not at this.`,
        cpuP95: `p95: 95% of the intervals were at or below this: what a server usually needs. The model fits each VPS's servers at the ${cpuBurst} target, or the ${typical} CPU of its demand source where higher, at most ${cap}, so a rare burst above it is allowed.`,
        cpuMax: `The highest interval in the week. Each interval averages about 5 minutes, so shorter spikes are averaged in. The model does not fit servers at their peak: burst headroom counts how many could burst at once to ${cpuBurst}, or their source's peak where higher, at most ${cap}, and never decides a verdict.`,
        stealP50: `Steal p50: the median steal of the VPS's intervals of about 5 minutes. Steal lowers the VPS's effective vCPU, which the model fits servers on: vCPU × (1 − steal ${steal} ÷ 100).`,
        stealP95: `Steal p95: 95% of the VPS's intervals of about 5 minutes had at most this much steal, shown for comparison; the model takes the ${steal} off the vCPUs, not this.`,
        usable: `Usable: what is left for game servers, never below 0. Cores are effective vCPU − overhead cores, where effective vCPU is vCPU × (1 − steal ${steal} ÷ 100); memory is RAM − overhead memory.`,
        perServer: `Per server: what one server is fitted at on this VPS, what servers there usually need: the ${cpuBurst} target, or the ${typical} CPU of the source shown where higher, at most ${cap}, and ${memoryBurst} of memory, or its peak where higher, at most ${memoryCap}.`,
        modelled: `Servers at once (N): how many servers the VPS can run together at what they usually need: floor(min(usable cores ÷ per-server cores, usable memory ÷ per-server memory)), but never fewer than the static floor, min(floor(vCPU ÷ ${capacityModel.staticBurstVcpuPerServer}), floor(RAM ÷ ${memoryCap})), where steal lowers the vCPU only once its ${steal} reaches ${stealFloorThresholdPercent}%; unknown until its steal, overhead and memory are measured and its own servers, its instance type or the fleet have enough running data. It is compared with how many of its servers are online together (co-online, M) and with its slots (S): at risk −(M − N) when it can run fewer than are co-online, headroom +(N − S) when it can run more than its slots, matches otherwise. An instance type is compared with its static slots, ${staticRuleLabel(capacityModel)}, as if every one ran at once. Burst headroom, how many could burst at once, is information only and never changes the verdict.`,
        concurrent: `Co-online (M): how many of its current servers are online together at most, leaving under ${hourShare} of the week's hours with more, a server counting as online in an hour it ran at least ${busy} of, or had no samples in. Some servers counted as always online: a server with too few hours of samples counts as online in every hour, the worst case for it. Unmeasured, using slots: a VPS with no servers, or every VPS while the servers' online history cannot be read, counts every slot. Coverage is the share of the week's hours in which every current server has samples.`,
        burst: `Burst headroom: how many of its servers could burst at once, each to ${cpuBurst}, or its source's peak where higher, at most ${cap}, with the same memory per server. Information only: it never changes the verdict.`,
        limitedBy: "Whether CPU or memory runs out first at what servers usually need; where the static rule's floor sets servers at once, the one that limits the floor.",
    };
    if (capacityModel.memoryPercentile !== 99) return hints;
    return { ...hints,
        memory: `${workingSet} Planning uses each server's measured p99 working set.`,
        p95: "p99: 99% of sampled interval-end working sets were at or below this value.",
        max: "The highest sampled working set in the rolling week, shown separately from p99. Memory overflow can cause OOM.",
        cpuP50: "p50: median CPU use, shown for comparison.",
        cpuP95: "p95: the measured CPU planning demand. Target-host hardware normalization is retained.",
        cpuMax: "Highest sampled interval CPU use, informational only; shorter spikes may be averaged out.",
        perServer: "The mean of current occupants' individual CPU p95 and memory p99 planning demands. Short histories use qualified fleet measurements.",
        demandSource: "Each server qualifies after six running hours in the rolling week. Short histories use the fleet's measured p95 CPU and p99 memory from qualified servers; no qualified fleet history uses the documented bootstrap. Host planning figures average those individual demands.",
        burst: "Informational headroom at measured peak CPU, without a demand cap. It never changes the verdict.",
    };
}

/** The tooltips of a read from before typical demand, which fits servers at their burst targets or peaks. */
function earlierHints(capacityModel: HostingAdminFleetCapacity["model"]) {
    const memoryPercentile = `p${capacityModel.memoryPercentile}`;
    const rule = staticRuleLabel(capacityModel);
    const hours = formatServerHours(capacityModel.minimumRunningHours);
    const cpuBurst = `${capacityModel.cpuBurstVcpu} vCPU`;
    const memoryBurst = capacityModel.memoryBurstBytes === null ? null : ruleGiB(capacityModel.memoryBurstBytes);
    const workingSet = "Memory one server used (its working set) at the end of each running interval of about 5 minutes, in GiB.";
    return {
        cpu: "CPU cores one server used, averaged over each interval between its samples (about 5 minutes) while it was running.",
        memory: memoryBurst === null ? workingSet : `${workingSet} The model plans memory at the ${memoryBurst} burst target, or the peak where higher.`,
        p50: "p50: the median. Half of the intervals were at or below this.",
        p95: memoryBurst === null
            ? "p95: 95% of the intervals were at or below this. The model sizes servers at this level, so brief spikes above it are expected."
            : "p95: 95% of the intervals were at or below this, shown for comparison; the model does not plan memory from it.",
        max: memoryBurst === null ? "The highest interval in the week."
            : `The highest interval in the week. Each VPS plans the peak of its own demand source (its own servers, its instance type or the fleet) where that is above the ${memoryBurst} target, as its per-server column shows; no source peaks above this.`,
        cpuP50: `p50: the median. Half of the intervals were at or below this: a server's stable CPU use, shown for comparison. The model plans CPU from the ${cpuBurst} burst target and the peak, not from this.`,
        cpuP95: `p95: 95% of the intervals were at or below this. The model plans CPU from the ${cpuBurst} burst target and the peak, not from this.`,
        cpuMax: `The highest interval in the week. Each interval averages about 5 minutes, so shorter spikes are averaged in. Each VPS plans every online server at the ${cpuBurst} burst target, or at the peak of its own demand source (its own servers, its instance type or the fleet) where that is higher, as its per-server column shows; no source peaks above this.`,
        runningHours: "Hours that servers were running in the week, summed over servers. The more of them, the more the figures can be trusted.",
        throttled: "Share of a server's running time in which its CPU quota throttled it.",
        steal: "Steal: the share of the VPS's CPU time that the hypervisor gave to other tenants of the same physical machine, in percent. A VPS with high steal really has fewer cores than it is sold with.",
        stealP95: "Steal p95: 95% of the VPS's intervals of about 5 minutes had at most this much steal. The model takes it off the vCPUs.",
        stealMax: "The highest steal of any interval in the week.",
        busyCores: "Busy cores at p95: how many of the VPS's cores were busy (user, nice, system and interrupt time), game servers and everything else together, in 95% of its intervals.",
        overhead: "Overhead: the median cores and memory in use beyond the game servers' own, from the operating system, the runner and anything else on the VPS.",
        usable: "Usable: what is left for game servers, never below 0. Cores are vCPU × (1 − steal p95 ÷ 100) − overhead cores; memory is RAM − overhead memory.",
        perServer: memoryBurst === null
            ? `Per server: what one server is modelled to need on this VPS when every server on it bursts at once: ${cpuBurst}, or the peak CPU of the source shown where that is higher, and its ${memoryPercentile} memory.`
            : `Per server: what one server is modelled to need on this VPS when every server on it bursts at once: ${cpuBurst} and ${memoryBurst}, or the peak CPU and memory of the source shown where higher.`,
        demandSource: `Where the per-server needs come from: This VPS uses the servers that ran on this VPS once they have run ${hours} there in the week; Type uses the instance type's servers once they have; Fleet uses the whole fleet's once it has; None yet means none has enough data.`,
        typeDemandSource: `Where the type's per-server needs come from: Type uses its own servers once they have run ${hours} in the week; Fleet uses the whole fleet's once it has; None yet means neither has enough data.`,
        modelled: `Servers at once: how many servers the VPS could run together if each bursts to ${memoryBurst === null ? `${cpuBurst} (or its peak where higher) at once, with ${memoryPercentile} memory` : `${cpuBurst} and ${memoryBurst} (or its peaks where higher) at once`}: floor(min(usable cores ÷ per-server cores, usable memory ÷ per-server memory)), unknown until its steal, overhead and memory are measured and its own servers, its instance type or the fleet have enough running data. It counts servers online together, not servers on the VPS: placement can put more on it when they are rarely online at once. Compared with its slots (for an instance type, the static rule's ${rule}): fewer is at risk when they all run at once, more is headroom.`,
        slots: "Slots: the VPS's slot capacity, floor(vCPU ÷ 2) when it is registered and more once an administrator raises it, since a slot reserves no cores.",
        limitedBy: "Whether CPU or memory runs out first in the model.",
        hourly: "Mean steal and busy share of each UTC hour, oldest first. The fuller the gold, the more; a hatched hour has no data.",
        // Only a read that fits on typical demand reports these; an earlier one shows none of them.
        stealP50: "",
        concurrent: "",
        burst: "",
    };
}

export type FleetCapacityHints = ReturnType<typeof fleetCapacityHints>;
