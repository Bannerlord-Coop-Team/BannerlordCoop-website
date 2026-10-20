import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { hostingRegionLabel, MAXIMUM_REGIONS } from "../../../../supabase/functions/_shared/hosting-regions";
import { ControlPlaneAdminError } from "./client";
import { shortServiceName } from "./placement-live-moves";
import { vpsProviderLabel } from "./vps-providers";
import type {
    HostingAdminFleetCapacity,
    HostingFleetCapacityCpuCores,
    HostingFleetCapacityDemand,
    HostingFleetCapacityDemandSource,
    HostingFleetCapacityHost,
    HostingFleetCapacityInstanceType,
    HostingFleetCapacityMemoryBytes,
    HostingFleetCapacityProviderId,
} from "./types";

/** The measured window: one week of hours. */
export const FLEET_CAPACITY_HOURS = 168;
/**
 * The most of each list a read may hold, so a malformed response cannot make the tab draw thousands of rows of
 * 336 cells. Each is well above the control plane's own bounds (64 VPSs and 512 placed servers today), which may
 * rise. Providers need no cap: each appears once and is one of `FLEET_CAPACITY_PROVIDERS`.
 */
export const FLEET_CAPACITY_LIMITS = { hosts: 256, occupantsPerHost: 64, instanceTypes: 256, regionsPerHost: MAXIMUM_REGIONS } as const;

/**
 * Exactly the control plane's closed `VPS_PROVIDER_IDS` (`src/hosting/providers/vps-provider-ids.ts`). A provider
 * it adds makes the read unexpected until this list, and its label, are updated, so the website updates first.
 */
export const FLEET_CAPACITY_PROVIDERS = ["ovhcloud-vps", "contabo-vps", "hosthatch-vps"] as const satisfies readonly HostingFleetCapacityProviderId[];

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
/** The most burst headroom, in percent, a read may claim. */
const MAXIMUM_BURST_PERCENT = 1_000;
const TOP_KEYS = ["generatedAt", "windowStartedAt", "windowEndedAt", "hours", "model", "fleet", "providers", "instanceTypes", "hosts"];
const MODEL_KEYS = ["cpuPercentile", "cpuBurstPercent", "memoryPercentile", "minimumRunningHours", "staticBurstVcpuPerServer", "staticBurstMemoryBytesPerServer"];
/**
 * An older control plane's model and VPS, from before the burst headroom: it planned each server at a percentile,
 * with no `cpuBurstPercent` or `stableCpuCores` and no `vps` demand source. The read accepts either shape, the
 * whole read in one, so the website can deploy first.
 */
const LEGACY_MODEL_KEYS = MODEL_KEYS.filter((key) => key !== "cpuBurstPercent");
const DEMAND_KEYS = ["runningServerHours", "samples", "cpuCores", "memoryBytes", "throttledShare", "cpuPressureShare"];
const PROVIDER_KEYS = ["provider", "hosts", "servers", "demand", "steal", "busyCores"];
const INSTANCE_TYPE_KEYS = ["key", "provider", "vCpu", "memoryBytes", "cpuModel", "cpuMhz", "hosts", "servers", "demand", "steal", "modelledServers", "demandSource"];
const HOST_KEYS = [
    "serviceName", "provider", "regionKeys", "vCpu", "memoryBytes", "cpuModel", "cpuMhz", "instanceTypeKey", "slots", "occupants",
    "steal", "busyCores", "cpuPressureShare", "overheadCores", "overheadMemoryBytes", "usableCores", "usableMemoryBytes",
    "stableCpuCores", "demandCpuCores", "demandMemoryBytes", "demandSource", "modelledServers", "limitedBy", "samples", "stealHourly", "busyHourly",
];
const LEGACY_HOST_KEYS = HOST_KEYS.filter((key) => key !== "stableCpuCores");
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
    if (!isRecord(value) || !hasExactKeys(value, ["p50", "p95", "max"])) return false;
    const figures = [value.p50, value.p95, value.max];
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

/** A week's measure: its mean and p95 no more than its max, each from 0 to `maximum`. */
function stat(maximum: number) {
    return (value: unknown) => isRecord(value) && hasExactKeys(value, ["samples", "mean", "p95", "max"])
        && count(value.samples) && amount(value.mean, maximum) && amount(value.p95, maximum) && amount(value.max, maximum)
        && ordered([value.mean as number, value.max as number]) && ordered([value.p95 as number, value.max as number]);
}

const percentStat = stat(100);
const coresStat = stat(Number.MAX_SAFE_INTEGER);

function providerId(value: unknown) {
    return (FLEET_CAPACITY_PROVIDERS as readonly unknown[]).includes(value);
}

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

/** The model, in either shape: with burst headroom, or an older control plane's without (`legacy`). */
function model(value: unknown, legacy: boolean) {
    return isRecord(value) && (legacy ? hasExactKeys(value, LEGACY_MODEL_KEYS) : hasExactKeys(value, MODEL_KEYS) && amount(value.cpuBurstPercent, MAXIMUM_BURST_PERCENT))
        && percentile(value.cpuPercentile) && percentile(value.memoryPercentile)
        && amount(value.minimumRunningHours)
        && typeof value.staticBurstVcpuPerServer === "number" && Number.isFinite(value.staticBurstVcpuPerServer) && value.staticBurstVcpuPerServer > 0
        && positiveBytes(value.staticBurstMemoryBytesPerServer);
}

function provider(value: unknown) {
    return isRecord(value) && hasExactKeys(value, PROVIDER_KEYS)
        && providerId(value.provider) && count(value.hosts) && count(value.servers) && demand(value.demand)
        && nullable(value.steal, percentStat) && nullable(value.busyCores, coresStat);
}

function instanceType(value: unknown) {
    return isRecord(value) && hasExactKeys(value, INSTANCE_TYPE_KEYS)
        && typeKey(value.key) && providerId(value.provider) && count(value.vCpu, 1)
        && nullable(value.memoryBytes, positiveBytes) && nullable(value.cpuModel, text) && nullable(value.cpuMhz, mhz)
        && count(value.hosts) && count(value.servers) && demand(value.demand)
        && nullable(value.steal, percentStat)
        && nullable(value.modelledServers, (servers) => count(servers)) && demandSource(TYPE_DEMAND_SOURCES)(value.demandSource);
}

function occupant(value: unknown) {
    return isRecord(value) && hasExactKeys(value, ["serverId", "displayName", "demand"])
        && text(value.serverId) && text(value.displayName) && demand(value.demand);
}

/** 168 hourly hex pairs; busy is a percent, so no hour is above `64` (100). */
function hourly(value: unknown, maximum: number) {
    return typeof value === "string" && HOURLY.test(value) && decodeHourly(value).every((hour) => hour === null || hour <= maximum);
}

/** A VPS in the read's shape: with its stable CPU and the `vps` source, or an older control plane's (`legacy`). */
function host(value: unknown, legacy: boolean) {
    return isRecord(value) && (legacy ? hasExactKeys(value, LEGACY_HOST_KEYS) : hasExactKeys(value, HOST_KEYS) && nullable(value.stableCpuCores, (cores) => amount(cores)))
        && text(value.serviceName) && providerId(value.provider)
        && within(value.regionKeys, FLEET_CAPACITY_LIMITS.regionsPerHost) && value.regionKeys.every((key) => text(key))
        && count(value.vCpu, 1) && nullable(value.memoryBytes, positiveBytes)
        && nullable(value.cpuModel, text) && nullable(value.cpuMhz, mhz) && nullable(value.instanceTypeKey, typeKey)
        && count(value.slots)
        && within(value.occupants, FLEET_CAPACITY_LIMITS.occupantsPerHost) && value.occupants.every(occupant)
        && nullable(value.steal, percentStat) && nullable(value.busyCores, coresStat)
        && nullable(value.cpuPressureShare, share)
        && nullable(value.overheadCores, (cores) => amount(cores)) && nullable(value.overheadMemoryBytes, (bytes) => count(bytes))
        // The control plane clamps what is left after steal and overhead at zero.
        && nullable(value.usableCores, (cores) => amount(cores)) && nullable(value.usableMemoryBytes, (bytes) => count(bytes))
        && nullable(value.demandCpuCores, (cores) => amount(cores)) && nullable(value.demandMemoryBytes, (bytes) => count(bytes))
        && demandSource(legacy ? TYPE_DEMAND_SOURCES : HOST_DEMAND_SOURCES)(value.demandSource)
        && plannedDemand(value, legacy)
        && nullable(value.modelledServers, (servers) => count(servers))
        && (value.limitedBy === null || value.limitedBy === "cpu" || value.limitedBy === "memory")
        && count(value.samples)
        && hourly(value.stealHourly, STEAL_CAP_PERMILLE) && hourly(value.busyHourly, 100);
}

/**
 * A VPS's per-server figures agree with their source, as the control plane chooses them: none has no figures, and
 * any other source has CPU and memory to plan with. With burst headroom it also has a positive stable CPU, which
 * the read's model checks the planned CPU against once the whole read is parsed (`burstConsistent`).
 */
function plannedDemand(value: Record<string, unknown>, legacy: boolean) {
    const figures = legacy ? [value.demandCpuCores, value.demandMemoryBytes] : [value.stableCpuCores, value.demandCpuCores, value.demandMemoryBytes];
    if (value.demandSource === "none") return figures.every((figure) => figure === null);
    return figures.every((figure) => figure !== null) && (legacy || (value.stableCpuCores as number) > 0);
}

/** Each planned CPU is its stable CPU plus the model's headroom, to the control plane's three decimals. */
function burstConsistent(hosts: readonly HostingFleetCapacityHost[], burstPercent: number) {
    return hosts.every((entry) => entry.stableCpuCores === null || entry.demandCpuCores === null
        || Math.abs(entry.demandCpuCores - burstCores(entry.stableCpuCores, burstPercent)) <= ROUNDING);
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
 * that each provider, instance type and VPS appears once, and that no list is longer than `FLEET_CAPACITY_LIMITS`.
 * An older control plane's read, without burst headroom, comes back with `cpuBurstPercent` and every
 * `stableCpuCores` null.
 */
export function parseFleetCapacity(value: unknown): HostingAdminFleetCapacity | null {
    if (!isRecord(value) || !hasExactKeys(value, TOP_KEYS)) return null;
    const legacy = isRecord(value.model) && !("cpuBurstPercent" in value.model);
    if (!timestamp(value.generatedAt) || !timestamp(value.windowStartedAt) || !timestamp(value.windowEndedAt)) return null;
    if (value.hours !== FLEET_CAPACITY_HOURS) return null;
    if (Date.parse(value.windowEndedAt) - Date.parse(value.windowStartedAt) !== FLEET_CAPACITY_HOURS * HOUR_MILLISECONDS) return null;
    if (!model(value.model, legacy)) return null;
    const fleet = value.fleet;
    if (!isRecord(fleet) || !hasExactKeys(fleet, ["hosts", "servers", "demand"]) || !count(fleet.hosts) || !count(fleet.servers) || !demand(fleet.demand)) return null;
    if (!Array.isArray(value.providers) || !value.providers.every(provider)) return null;
    if (!within(value.instanceTypes, FLEET_CAPACITY_LIMITS.instanceTypes) || !value.instanceTypes.every(instanceType)) return null;
    if (!within(value.hosts, FLEET_CAPACITY_LIMITS.hosts) || !value.hosts.every((entry) => host(entry, legacy))) return null;
    const capacity = value as HostingAdminFleetCapacity;
    if (!unique(capacity.providers.map((entry) => entry.provider)) || !unique(capacity.instanceTypes.map((entry) => entry.key))
        || !unique(capacity.hosts.map((entry) => entry.serviceName))) return null;
    if (!legacy) return capacity.model.cpuBurstPercent !== null && burstConsistent(capacity.hosts, capacity.model.cpuBurstPercent) ? capacity : null;
    return {
        ...capacity,
        model: { ...capacity.model, cpuBurstPercent: null },
        hosts: capacity.hosts.map((entry) => ({ ...entry, stableCpuCores: null })),
    };
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

/** "3 GiB" for the static rule's whole gibibytes, two decimals at most otherwise. */
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
const MEMORY_PERCENTILES: Record<number, keyof HostingFleetCapacityMemoryBytes> = { 50: "p50", 95: "p95", 100: "max" };

/** The figure at the model's percentile, falling back to p95 for a percentile the demand does not report. */
export function modelCpu(cores: HostingFleetCapacityCpuCores, percentileValue: number) {
    const key = CPU_PERCENTILES[percentileValue] ?? "p95";
    return { key, value: cores[key] };
}

export function modelMemory(bytes: HostingFleetCapacityMemoryBytes, percentileValue: number) {
    const key = MEMORY_PERCENTILES[percentileValue] ?? "p95";
    return { key, value: bytes[key] };
}

/** Stable CPU with the model's burst headroom: what one server is planned to need when every one bursts at once. */
export function burstCores(stableCores: number, burstPercent: number) {
    return stableCores * (1 + burstPercent / 100);
}

/**
 * One sentence comparing what a running server uses at the model's percentiles with today's static rule, and, with
 * burst headroom, what the model plans for each server instead.
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
    if (rule.cpuBurstPercent === null) return uses;
    // Rounded to three decimals as the control plane rounds each VPS's planned CPU, and shown with them.
    const planned = Math.round(burstCores(cpu.value, rule.cpuBurstPercent) * 1_000) / 1_000;
    const plannedShare = Math.round((planned / rule.staticBurstVcpuPerServer) * 100);
    return `${uses} With ${rule.cpuBurstPercent}% burst headroom above that stable use, the model plans ${formatCoresExact(planned)} per server (${plannedShare}% of ${rule.staticBurstVcpuPerServer} vCPU).`;
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
        const scopes = capacity.model.cpuBurstPercent === null ? "an instance type's or the whole fleet's" : "a VPS's own servers', an instance type's or the whole fleet's";
        return `Not enough data yet: the fleet has ${formatServerHours(hours)} of running data, and the model plans with ${scopes} figures only once it has ${formatServerHours(capacity.model.minimumRunningHours)}. Until then no VPS is modelled, and figures without data show —.`;
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
 * Modelled servers against today's slots: fewer is at risk when they all run at once, more is headroom. `label`
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

export function demandSourceLabel(source: HostingFleetCapacityDemandSource) {
    return source === "vps" ? "This VPS" : source === "type" ? "Type" : source === "fleet" ? "Fleet" : "None yet";
}

/**
 * Where a VPS's per-server figure comes from and how it is made, under that figure: "This VPS · 1.170 cores stable +
 * 66%", or "Type p95" from an older control plane, or "None yet". Stable CPU has three decimals, as the planned figure
 * above it does (`formatCoresExact`), so 0.600 + 66% reads as 0.996, never as 1.00.
 */
export function perServerSourceLabel(host: Pick<HostingFleetCapacityHost, "demandSource" | "stableCpuCores">,
    capacityModel: Pick<HostingAdminFleetCapacity["model"], "cpuPercentile" | "cpuBurstPercent">) {
    const source = demandSourceLabel(host.demandSource);
    if (host.demandSource === "none") return source;
    if (capacityModel.cpuBurstPercent === null || host.stableCpuCores === null) return `${source} p${capacityModel.cpuPercentile}`;
    return `${source} · ${formatCoresExact(host.stableCpuCores)} stable + ${capacityModel.cpuBurstPercent}%`;
}

export function limitedByLabel(limitedBy: HostingFleetCapacityHost["limitedBy"]) {
    return limitedBy === "cpu" ? "CPU" : limitedBy === "memory" ? "Memory" : null;
}

/**
 * One occupant's needs, each figure with its own percentile: "1.10 cores stable (p50) · 1.65 GiB at p95", its CPU at
 * the model's stable percentile; from an older control plane without burst headroom "1.10 cores · 1.65 GiB at
 * p95", both at p95 as before; or that it has no data yet.
 */
export function occupantDemandLabel(occupantDemand: HostingFleetCapacityDemand,
    capacityModel: Pick<HostingAdminFleetCapacity["model"], "cpuPercentile" | "cpuBurstPercent">) {
    if (occupantDemand.cpuCores === null && occupantDemand.memoryBytes === null) return "no data yet";
    const memory = occupantDemand.memoryBytes === null ? null : formatGiB(occupantDemand.memoryBytes.p95);
    if (capacityModel.cpuBurstPercent === null) {
        const cpu = occupantDemand.cpuCores === null ? null : formatCores(occupantDemand.cpuCores.p95);
        return `${cpu ?? "CPU —"} · ${memory ?? "memory —"} at p95`;
    }
    const stable = occupantDemand.cpuCores === null ? null : modelCpu(occupantDemand.cpuCores, capacityModel.cpuPercentile);
    const cpu = stable === null ? "CPU —" : `${formatCores(stable.value)} stable (${stable.key})`;
    return `${cpu} · ${memory === null ? "memory —" : `${memory} at p95`}`;
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

/** HostHatch is not in the website's own provider list yet, so its label lives here. */
export function fleetCapacityProviderLabel(provider: HostingFleetCapacityProviderId) {
    return provider === "hosthatch-vps" ? "HostHatch" : vpsProviderLabel(provider);
}

/**
 * An instance type as people read it, "OVHcloud · 6 vCPU · 11.68 GiB · Intel Core Processor (Haswell, no TSX) ·
 * 2,400 MHz": the parts of its key without the raw provider id. RAM uses `formatGiB`, as the row's RAM cell does,
 * so the two always agree; MemTotal is never a whole GiB, unlike the key's rounded figure.
 */
export function fleetCapacityTypeLabel(entry: Pick<HostingFleetCapacityInstanceType, "provider" | "vCpu" | "memoryBytes" | "cpuModel" | "cpuMhz">) {
    const mhzKnown = knownMhz(entry.cpuMhz);
    return [
        fleetCapacityProviderLabel(entry.provider),
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
        const provider = fleetCapacityProviderLabel(entry.provider);
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

/** The explanations behind each figure's tooltip, with the model's own thresholds. */
export function fleetCapacityHints(capacityModel: HostingAdminFleetCapacity["model"]) {
    const cpu = `p${capacityModel.cpuPercentile}`;
    const memory = `p${capacityModel.memoryPercentile}`;
    const rule = staticRuleLabel(capacityModel);
    const hours = formatServerHours(capacityModel.minimumRunningHours);
    const burst = capacityModel.cpuBurstPercent;
    if (burst !== null) {
        return {
            ...legacyHints(capacityModel),
            cpuP50: `p50: the median. Half of the intervals were at or below this. The model takes the ${cpu} as a server's stable CPU use and plans ${burst}% above it.`,
            cpuP95: `p95: 95% of the intervals were at or below this. The model plans CPU from the stable ${cpu} plus headroom, not from this.`,
            perServer: `Per server: what one server is modelled to need on this VPS when every server on it bursts at once: its stable CPU, the ${cpu} from the source shown, plus ${burst}% headroom, and its ${memory} memory.`,
            demandSource: `Where the per-server needs come from: This VPS uses the servers that ran on this VPS once they have run ${hours} there in the week; Type uses the instance type's servers once they have; Fleet uses the whole fleet's once it has; None yet means none has enough data.`,
            typeDemandSource: `Where the type's per-server needs come from: Type uses its own servers once they have run ${hours} in the week; Fleet uses the whole fleet's once it has; None yet means neither has enough data.`,
            modelled: `Servers at once: how many servers the VPS could run together if each bursts ${burst}% above its stable ${cpu} CPU at once, with ${memory} memory: floor(min(usable cores ÷ per-server cores, usable memory ÷ per-server memory)), unknown until its steal, overhead and memory are measured and its own servers, its instance type or the fleet have enough running data. Compared with today's slots from the static rule (${rule}): fewer is at risk when they all run at once, more is headroom.`,
        };
    }
    return legacyHints(capacityModel);
}

/** The hints of an older control plane's model, which planned for its percentiles without burst headroom. */
function legacyHints(capacityModel: HostingAdminFleetCapacity["model"]) {
    const cpu = `p${capacityModel.cpuPercentile}`;
    const memory = `p${capacityModel.memoryPercentile}`;
    const rule = staticRuleLabel(capacityModel);
    return {
        cpu: "CPU cores one server used, averaged over each interval between its samples (about 5 minutes) while it was running.",
        memory: "Memory one server used (its working set) at the end of each running interval of about 5 minutes, in GiB.",
        p50: "p50: the median. Half of the intervals were at or below this.",
        p95: "p95: 95% of the intervals were at or below this. The model sizes servers at this level, so brief spikes above it are expected.",
        cpuP50: "p50: the median. Half of the intervals were at or below this.",
        cpuP95: "p95: 95% of the intervals were at or below this. The model sizes servers at this level, so brief spikes above it are expected.",
        max: "The highest interval in the week.",
        runningHours: "Hours that servers were running in the week, summed over servers. The more of them, the more the figures can be trusted.",
        throttled: "Share of a server's running time in which its CPU quota throttled it.",
        steal: "Steal: the share of the VPS's CPU time that the hypervisor gave to other tenants of the same physical machine, in percent. A VPS with high steal really has fewer cores than it is sold with.",
        stealP95: "Steal p95: 95% of the VPS's intervals of about 5 minutes had at most this much steal. The model takes it off the vCPUs.",
        stealMax: "The highest steal of any interval in the week.",
        busyCores: "Busy cores at p95: how many of the VPS's cores were busy (user, nice, system and interrupt time), game servers and everything else together, in 95% of its intervals.",
        overhead: "Overhead: the median cores and memory in use beyond the game servers' own, from the operating system, the runner and anything else on the VPS.",
        usable: "Usable: what is left for game servers, never below 0. Cores are vCPU × (1 − steal p95 ÷ 100) − overhead cores; memory is RAM − overhead memory.",
        perServer: `Per server: the ${cpu} CPU and ${memory} memory one server is modelled to need on this VPS, from the source shown.`,
        demandSource: `Where the per-server needs come from: Type uses the instance type's own figures once its servers have run ${formatServerHours(capacityModel.minimumRunningHours)} in the week; Fleet uses the whole fleet's once it has; None yet means neither has enough data.`,
        typeDemandSource: `Where the per-server needs come from: Type uses the instance type's own figures once its servers have run ${formatServerHours(capacityModel.minimumRunningHours)} in the week; Fleet uses the whole fleet's once it has; None yet means neither has enough data.`,
        modelled: `Servers at once: how many servers the VPS could run together at their ${cpu} CPU and ${memory} memory, floor(min(usable cores ÷ per-server cores, usable memory ÷ per-server memory)), unknown until its steal, overhead and memory are measured and its instance type or the fleet has enough running data. Compared with today's slots from the static rule (${rule}): fewer is at risk when they all run at once, more is headroom.`,
        slots: `Slots today: floor(vCPU ÷ ${capacityModel.staticBurstVcpuPerServer}), from the static rule of ${rule}.`,
        limitedBy: "Whether CPU or memory runs out first in the model.",
        hourly: "Mean steal and busy share of each UTC hour, oldest first. The fuller the gold, the more; a hatched hour has no data.",
    };
}

export type FleetCapacityHints = ReturnType<typeof fleetCapacityHints>;
