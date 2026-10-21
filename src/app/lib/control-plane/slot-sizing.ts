import { hasExactKeys, isRecord } from "../../../../supabase/functions/_shared/dto-validation";
import { hostingRegionLabel, MAXIMUM_REGIONS } from "../../../../supabase/functions/_shared/hosting-regions";
import { ControlPlaneAdminError } from "./client";
import { FLEET_CAPACITY_LIMITS, FLEET_CAPACITY_PROVIDERS, fleetCapacityProviderLabel, formatGiB } from "./fleet-capacity";
import type {
    HostingAdminSlotSizing,
    HostingFleetCapacityProviderId,
    HostingSlotSizingCapacitySource,
    HostingSlotSizingHost,
    HostingSlotSizingReason,
    HostingSlotSizingTarget,
} from "./types";

/**
 * The most VPSs and regions a read may hold, so a malformed response cannot make the pane draw thousands of rows:
 * the fleet capacity read's VPS cap, well above the control plane's 64 placement hosts, and the 32 regions a catalog
 * may publish.
 */
export const SLOT_SIZING_LIMITS = { hosts: FLEET_CAPACITY_LIMITS.hosts, regions: MAXIMUM_REGIONS } as const;

const GIB = 1024 ** 3;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
/** The hours of a week: a typical server is online at most all of them. */
const WEEK_HOURS = 168;
/** The most a read's model may claim: vCPUs, and bytes of memory, as the fleet capacity read bounds its targets. */
const MAXIMUM_BURST_VCPU = 256;
const MAXIMUM_BURST_MEMORY_BYTES = 64 * GIB;
/** A figure within this of a whole number of its last decimal is that number: floating-point noise, not a digit. */
const DECIMAL_NOISE = 1e-6;
/**
 * Half the last decimal the control plane rounds the shortage (three) and the overflow share (four) to: each rounded
 * figure is within this of the exact one its budget flag describes.
 */
const SHORTAGE_ROUNDING = 0.0005;
const OVERFLOW_ROUNDING = 0.00005;
/** Room for the control plane's own 1e-9 core-hour tolerance on the CPU budget, and for floating-point sums. */
const FIGURE_NOISE = 1e-9;
const REASONS: readonly HostingSlotSizingReason[] = ["cpu", "memory", "floor", "maximum", "drain", "unmeasured"];
const CAPACITY_SOURCES: readonly HostingSlotSizingCapacitySource[] = ["measured", "type", "provider-vcpu", "none"];
const TOP_KEYS = ["generatedAt", "model", "hosts", "regions"];
const MODEL_KEYS = [
    "cpuShortageBudgetCoreHoursPerWeek", "memoryOverflowShare", "cpuBurstVcpu", "memoryBurstBytes", "historyDays", "halfLifeDays",
    "minimumObservedDays", "maximumSlots", "typicalWeeklyOnlineHours", "capacityErrorCode",
];
const HOST_KEYS = [
    "serviceName", "provider", "regionKeys", "vCpu", "slots", "occupants", "acceptsRelocations", "usableCores", "coresSource",
    "usableMemoryBytes", "memorySource", "memoryBytesPerServer", "recommendedSlots", "reason", "expectedShortageCoreHoursPerWeek",
    "withinCpuBudget", "memoryOverflowShare", "withinMemoryBudget", "serversToMove", "freeRecommendedSlots",
];
/** A VPS from a control plane with automatic slot sizing: the same keys and its slot target. */
const TARGETED_HOST_KEYS = [...HOST_KEYS, "target"];
const TARGET_KEYS = ["targetSlots", "pendingLowerSlots", "pendingLowerSince", "changedAt", "reason"];
/** A target's reason as the control plane stores it: a recommendation's reason, or one of its own such as `admin-raise`. */
const TARGET_REASON = /^[a-z][a-z0-9-]{0,31}$/u;
const REGION_KEYS = ["regionKey", "serversToMove", "freeRecommendedSlots", "shortfallServers"];

type Model = HostingAdminSlotSizing["model"];

function timestamp(value: unknown): value is string {
    return typeof value === "string" && TIMESTAMP.test(value) && new Date(value).toISOString() === value;
}

function count(value: unknown, minimum = 0): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}

/** A finite number from 0 to `maximum`. */
function amount(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function text(value: unknown) {
    return typeof value === "string" && value.length > 0 && value.length <= 256;
}

/** A number with at most `digits` decimals, as the control plane rounds it. */
function decimals(value: number, digits: number) {
    const scaled = value * 10 ** digits;
    return Math.abs(scaled - Math.round(scaled)) <= DECIMAL_NOISE;
}

/** A finite non-negative figure the control plane rounds to `digits` decimals, at most `maximum`. */
function rounded(value: unknown, digits: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
    return amount(value, maximum) && decimals(value, digits);
}

function within(value: unknown, maximum: number): value is unknown[] {
    return Array.isArray(value) && value.length <= maximum;
}

function unique(values: readonly string[]) {
    return new Set(values).size === values.length;
}

/** The fewest slots a VPS keeps, and the least any recommendation is: floor(vCPU ÷ 2), as the control plane registers it. */
export function slotSizingFloor(vCpu: number) {
    return Math.floor(vCpu / 2);
}

/** A slot count a VPS of `vCpu` vCPUs may store: from floor(vCPU ÷ 2), and at least 1, to `maximum`. */
function slotCount(value: unknown, vCpu: number, maximum: number): value is number {
    return count(value, Math.max(1, slotSizingFloor(vCpu))) && value <= maximum;
}

function model(value: unknown): value is Model {
    return isRecord(value) && hasExactKeys(value, MODEL_KEYS)
        && amount(value.cpuShortageBudgetCoreHoursPerWeek)
        && amount(value.memoryOverflowShare, 1) && value.memoryOverflowShare > 0
        && amount(value.cpuBurstVcpu, MAXIMUM_BURST_VCPU) && value.cpuBurstVcpu > 0
        && count(value.memoryBurstBytes, 1) && value.memoryBurstBytes <= MAXIMUM_BURST_MEMORY_BYTES
        && count(value.historyDays, 1) && count(value.halfLifeDays, 1) && count(value.minimumObservedDays)
        && count(value.maximumSlots, 1)
        && rounded(value.typicalWeeklyOnlineHours, 2, WEEK_HOURS)
        && (value.capacityErrorCode === null || text(value.capacityErrorCode));
}

function source(value: unknown): value is HostingSlotSizingCapacitySource {
    return CAPACITY_SOURCES.includes(value as HostingSlotSizingCapacitySource);
}

/**
 * Whether a rounded figure can stand for the exact one its budget flag describes: at most the budget when it keeps it,
 * at least the budget when it breaks it, each within the figure's rounding.
 */
function fitsFlag(within: boolean, figure: number, budget: number, rounding: number) {
    return within ? figure <= budget + rounding + FIGURE_NOISE : figure >= budget - rounding - FIGURE_NOISE;
}

/**
 * A VPS's slot target, as `presentSlotTarget` in the control plane presents it, which refuses the whole read rather than
 * present stored columns that break a rule:
 *
 * - the target and a held lower recommendation are slot counts as `slots` is, from floor(vCPU ÷ 2) to `maximumSlots`;
 * - `changedAt` and `reason` are both set or both null, and a target has them;
 * - a held lower recommendation has its time, and is below the target, or below `slots` without one.
 */
function target(value: unknown, vCpu: number, slots: number, sizingModel: Model): value is HostingSlotSizingTarget {
    if (!isRecord(value) || !hasExactKeys(value, TARGET_KEYS)) return false;
    const { targetSlots, pendingLowerSlots, pendingLowerSince, changedAt, reason } = value;
    if (targetSlots !== null && !slotCount(targetSlots, vCpu, sizingModel.maximumSlots)) return false;
    if (changedAt !== null && !timestamp(changedAt)) return false;
    if (reason !== null && (typeof reason !== "string" || !TARGET_REASON.test(reason))) return false;
    if ((changedAt === null) !== (reason === null) || (targetSlots !== null && changedAt === null)) return false;
    if ((pendingLowerSlots === null) !== (pendingLowerSince === null)) return false;
    if (pendingLowerSlots === null) return true;
    return slotCount(pendingLowerSlots, vCpu, sizingModel.maximumSlots) && timestamp(pendingLowerSince)
        && pendingLowerSlots < (typeof targetSlots === "number" ? targetSlots : slots);
}

/**
 * One VPS, field by field and against its reason, as `sizeVpsSlots`, `slotSizingHostEntry` and `readSlotSizing` in the
 * control plane make it:
 *
 * - its slots are from floor(vCPU ÷ 2), and at least 1, to `maximumSlots`, and its servers are no more than its slots;
 * - its slot target is absent, from a control plane before automatic slot sizing, or as `target` checks it;
 * - each usable figure's source is `none` exactly when that figure is null;
 * - it is `unmeasured` exactly when either source is `none`, and then it has no recommendation, figures or budget flags,
 *   and nothing moves to or from it;
 * - otherwise its recommendation is from floor(vCPU ÷ 2) to `maximumSlots`, its figures are rounded to three and four
 *   decimals, and both budget flags are set. The flags are of the exact figures, so a flag that keeps its budget has
 *   its rounded figure at most half a last decimal above the budget, and one that breaks it at most half below;
 * - `cpu`, `memory` and `maximum` keep both budgets, `maximum` at `maximumSlots` and the other two below it, and their
 *   free slots are the recommendation less the servers;
 * - `floor` recommends floor(vCPU ÷ 2), at least its servers, with free slots no more than the floor leaves, and breaks
 *   at least one budget there: a count no larger than the floor (its servers, or one more than the most that keep both)
 *   already breaks one, and adding servers never lowers a figure;
 * - `drain` moves at least one server and keeps the rest, which is the recommendation, has no free slots, and keeps
 *   both budgets unless it stopped at the floor;
 * - only `drain` moves servers.
 */
function host(value: unknown, sizingModel: Model): value is HostingSlotSizingHost {
    if (!isRecord(value)) return false;
    // A control plane before automatic slot sizing (#542) sends no `target`, so a rollback still reads; one with it
    // sends it with every VPS.
    const targeted = Object.hasOwn(value, "target");
    if (!hasExactKeys(value, targeted ? TARGETED_HOST_KEYS : HOST_KEYS)) return false;
    if (!text(value.serviceName) || !text(value.provider)) return false;
    if (!within(value.regionKeys, MAXIMUM_REGIONS) || !value.regionKeys.every(text)) return false;
    // Sizing throws for fewer than 2 vCPUs. A VPS's stored capacity is from floor(vCPU ÷ 2), and at least 1, to the most a
    // VPS holds, and each of its servers holds one of its slots: the hosts CHECK and the slot triggers keep both.
    if (!count(value.vCpu, 2)) return false;
    if (!slotCount(value.slots, value.vCpu, sizingModel.maximumSlots)) return false;
    if (!count(value.occupants) || value.occupants > value.slots) return false;
    if (targeted && !target(value.target, value.vCpu, value.slots, sizingModel)) return false;
    if (typeof value.acceptsRelocations !== "boolean") return false;
    if (value.usableCores !== null && !rounded(value.usableCores, 3)) return false;
    if (value.usableMemoryBytes !== null && !count(value.usableMemoryBytes)) return false;
    if (!source(value.coresSource) || !source(value.memorySource)) return false;
    // Each source names its own figure: none exactly when that figure is unknown.
    if ((value.usableCores === null) !== (value.coresSource === "none")) return false;
    if ((value.usableMemoryBytes === null) !== (value.memorySource === "none")) return false;
    // The burst target, or the VPS's servers' peak working set where that is higher.
    if (!count(value.memoryBytesPerServer, sizingModel.memoryBurstBytes)) return false;
    if (!REASONS.includes(value.reason as HostingSlotSizingReason)) return false;
    if (!count(value.serversToMove) || !count(value.freeRecommendedSlots)) return false;

    const unmeasured = value.reason === "unmeasured";
    if (unmeasured !== (value.coresSource === "none" || value.memorySource === "none")) return false;
    if (unmeasured) {
        return value.recommendedSlots === null && value.expectedShortageCoreHoursPerWeek === null && value.withinCpuBudget === null
            && value.memoryOverflowShare === null && value.withinMemoryBudget === null && value.serversToMove === 0
            && value.freeRecommendedSlots === 0;
    }
    const floor = slotSizingFloor(value.vCpu);
    const recommended = value.recommendedSlots;
    if (!count(recommended, floor) || recommended > sizingModel.maximumSlots) return false;
    const shortage = value.expectedShortageCoreHoursPerWeek;
    const overflow = value.memoryOverflowShare;
    if (!rounded(shortage, 3) || !rounded(overflow, 4, 1)) return false;
    const { withinCpuBudget: cpu, withinMemoryBudget: memory } = value;
    if (typeof cpu !== "boolean" || typeof memory !== "boolean") return false;
    if (!fitsFlag(cpu, shortage, sizingModel.cpuShortageBudgetCoreHoursPerWeek, SHORTAGE_ROUNDING)) return false;
    if (!fitsFlag(memory, overflow, sizingModel.memoryOverflowShare, OVERFLOW_ROUNDING)) return false;
    const { occupants, serversToMove: moving, freeRecommendedSlots: free } = value;
    if (value.reason === "drain") {
        return moving >= 1 && recommended === occupants - moving && free === 0 && (recommended === floor || (cpu && memory));
    }
    if (moving !== 0) return false;
    if (value.reason === "floor") return recommended === floor && free <= recommended - occupants && !(cpu && memory);
    const atMaximum = recommended === sizingModel.maximumSlots;
    return cpu && memory && free === recommended - occupants && (value.reason === "maximum" ? atMaximum : !atMaximum);
}

/**
 * One region's figures: its servers to move with no free slot of their own provider are at most all of them, and at
 * least those its free slots cannot take; neither its servers to move nor its free slots exceed the whole read's.
 */
function region(value: unknown, hosts: readonly HostingSlotSizingHost[]) {
    if (!isRecord(value) || !hasExactKeys(value, REGION_KEYS) || !text(value.regionKey)) return false;
    const { serversToMove: moving, freeRecommendedSlots: free, shortfallServers: shortfall } = value;
    if (!count(moving) || !count(free) || !count(shortfall)) return false;
    const allMoving = hosts.reduce((total, entry) => total + entry.serversToMove, 0);
    const allFree = hosts.reduce((total, entry) => total + (entry.acceptsRelocations ? entry.freeRecommendedSlots : 0), 0);
    return shortfall <= moving && shortfall >= moving - free && moving <= allMoving && free <= allFree;
}

/**
 * The `slot-sizing` result, checked key by key against the control plane's contract; null when anything is not as it
 * says. Beyond each field's range and enum it checks every rule between a VPS's reason and its figures that the control
 * plane guarantees (see `host`), that a capacity read that failed left every VPS unmeasured, each region's figures
 * against the VPSs', that each VPS and region appears once, and that no list is longer than `SLOT_SIZING_LIMITS`.
 */
export function parseSlotSizing(value: unknown): HostingAdminSlotSizing | null {
    if (!isRecord(value) || !hasExactKeys(value, TOP_KEYS) || !timestamp(value.generatedAt) || !model(value.model)) return null;
    const sizingModel = value.model;
    if (!within(value.hosts, SLOT_SIZING_LIMITS.hosts) || !value.hosts.every((entry) => host(entry, sizingModel))) return null;
    const hosts = value.hosts as HostingSlotSizingHost[];
    if (!unique(hosts.map((entry) => entry.serviceName))) return null;
    if (sizingModel.capacityErrorCode !== null && hosts.some((entry) => entry.reason !== "unmeasured")) return null;
    if (!within(value.regions, SLOT_SIZING_LIMITS.regions) || !value.regions.every((entry) => region(entry, hosts))) return null;
    const read = value as HostingAdminSlotSizing;
    return unique(read.regions.map((entry) => entry.regionKey)) ? read : null;
}

/**
 * Whether a failed read means this control plane has no `slot-sizing` operation yet. One from before it answers the
 * unknown operation with HTTP 400 `invalid_request` ("The control plane request is invalid."), as the request fails its
 * operation schema; the control plane that has it accepts the `{}` the pane sends.
 */
export function slotSizingUnavailable(error: unknown) {
    return error instanceof ControlPlaneAdminError && (error.code === "invalid_request" || error.code === "unsupported_operation");
}

/** What the pane says while the control plane has no `slot-sizing` operation. */
export const SLOT_SIZING_UNAVAILABLE = "Slot sizing is not available on this control plane yet. It appears here once the control plane that recommends slot counts is deployed; the rest of this tab does not depend on it.";

/** Turns any other failed read into text, including the rate limit. */
export function slotSizingErrorMessage(error: unknown) {
    if (error instanceof ControlPlaneAdminError) {
        if (error.code === "rate_limited") return "You can read slot sizing six times every five minutes. Wait a few minutes, then refresh.";
        return error.message;
    }
    return error instanceof Error ? error.message : "Slot sizing could not be loaded.";
}

/** A provider's readable name, or its id as the read gives it for a provider the website does not know. */
export function slotSizingProviderLabel(provider: string) {
    return (FLEET_CAPACITY_PROVIDERS as readonly string[]).includes(provider)
        ? fleetCapacityProviderLabel(provider as HostingFleetCapacityProviderId)
        : provider;
}

export type SlotSizingHostGroup = { label: string; hosts: HostingSlotSizingHost[] };

/** The VPSs grouped by provider, then region, as the VPS table groups them: alphabetical, without a region last, read order within. */
export function slotSizingHostGroups(hosts: readonly HostingSlotSizingHost[]): SlotSizingHostGroup[] {
    const groups = new Map<string, { provider: string; region: string; hosts: HostingSlotSizingHost[] }>();
    for (const entry of hosts) {
        const provider = slotSizingProviderLabel(entry.provider);
        const region = entry.regionKeys.length === 0 ? "" : entry.regionKeys.map(hostingRegionLabel).join(", ");
        const key = `${provider}\u0000${region}`;
        const group = groups.get(key) ?? { provider, region, hosts: [] };
        group.hosts.push(entry);
        groups.set(key, group);
    }
    return [...groups.values()]
        .sort((left, right) => left.provider.localeCompare(right.provider) || Number(left.region === "") - Number(right.region === "") || left.region.localeCompare(right.region))
        .map((group) => ({ label: `${group.provider} · ${group.region === "" ? "No region" : group.region}`, hosts: group.hosts }));
}

export type SlotSizingDifference = { kind: "more" | "fewer" | "same"; label: string; description: string };

/** The recommendation against today's slots: "+2", "−1" or "same", and the sentence behind it. */
export function slotSizingDifference(recommended: number, slots: number): SlotSizingDifference {
    const of = `${slots} ${slots === 1 ? "slot" : "slots"} now`;
    if (recommended > slots) return { kind: "more", label: `+${recommended - slots}`, description: `${recommended - slots} more than its ${of}.` };
    if (recommended < slots) return { kind: "fewer", label: `−${slots - recommended}`, description: `${slots - recommended} fewer than its ${of}.` };
    return { kind: "same", label: "same", description: `As many as its ${of}.` };
}

const REASON_LABELS: Record<HostingSlotSizingReason, string> = {
    cpu: "CPU budget", memory: "Memory budget", floor: "Floor", maximum: "Maximum", drain: "Drain", unmeasured: "Unmeasured",
};

export function slotSizingReasonLabel(reason: HostingSlotSizingReason) {
    return REASON_LABELS[reason];
}

type ReasonFacts = Pick<HostingSlotSizingHost, "reason" | "vCpu" | "occupants" | "recommendedSlots" | "serversToMove" | "freeRecommendedSlots"
    | "withinCpuBudget" | "withinMemoryBudget" | "coresSource" | "memorySource">;

/** "1 server" or "3 servers". */
function servers(count: number) {
    return `${count} ${count === 1 ? "server" : "servers"}`;
}

/** The budgets its flags say the exact figures break: "the CPU budget", "the memory budget" or both. */
function brokenBudgets(entry: Pick<HostingSlotSizingHost, "withinCpuBudget" | "withinMemoryBudget">) {
    const cpu = entry.withinCpuBudget === false;
    const memory = entry.withinMemoryBudget === false;
    return cpu && memory ? "the CPU and memory budgets" : cpu ? "the CPU budget" : "the memory budget";
}

/** "its floor of 3 slots (floor(vCPU ÷ 2))". */
function floorOf(vCpu: number) {
    const floor = slotSizingFloor(vCpu);
    return `its floor of ${floor} ${floor === 1 ? "slot" : "slots"} (floor(vCPU ÷ 2))`;
}

/**
 * Why `floor`: the most slots that keep both budgets, if any, is below the floor, so at the floor at least one breaks.
 * With as many servers as the floor,
 * they break it themselves and nothing moves; with fewer, they take `freeRecommendedSlots` typical servers within the
 * budgets, and the floor filled with typical servers breaks the budgets its flags name.
 */
function floorDescription(entry: ReasonFacts) {
    const budgets = brokenBudgets(entry);
    if (entry.occupants === entry.recommendedSlots) {
        return `Its ${servers(entry.occupants)} already ${entry.occupants === 1 ? "breaks" : "break"} ${budgets}. A VPS keeps ${floorOf(entry.vCpu)}, and this one has no more servers than that, so nothing moves.`;
    }
    const free = entry.freeRecommendedSlots;
    const room = entry.occupants === 0
        ? free === 0 ? "Not even one typical server fits within the budgets." : `${free} typical ${free === 1 ? "server fits" : "servers fit"} within the budgets.`
        : free === 0 ? `Beside its ${servers(entry.occupants)}, no more typical server fits within the budgets.`
            : `Beside its ${servers(entry.occupants)}, ${free} more typical ${free === 1 ? "server fits" : "servers fit"} within the budgets.`;
    return `${room} A VPS keeps ${floorOf(entry.vCpu)} anyway; filled with typical servers, they would break ${budgets}.`;
}

/** Why `drain`: some would move, and those that stay keep both budgets, or still break one at the floor. */
function drainDescription(entry: ReasonFacts) {
    const kept = entry.recommendedSlots ?? 0;
    // A drain keeps at least floor(vCPU ÷ 2), at least 1, and moves at least 1, so it starts from at least 2 servers.
    const start = `Its ${entry.occupants} servers alone break a budget, so ${entry.serversToMove} would move`;
    const stay = kept === 1 ? "the 1 that stays" : `the ${kept} that stay`;
    if (kept !== slotSizingFloor(entry.vCpu)) return `${start}, and ${stay} ${kept === 1 ? "keeps" : "keep"} both budgets.`;
    const end = entry.withinCpuBudget === false || entry.withinMemoryBudget === false
        ? `still ${kept === 1 ? "breaks" : "break"} ${brokenBudgets(entry)}` : `${kept === 1 ? "keeps" : "keep"} both budgets`;
    return `${start}, down to ${floorOf(entry.vCpu)}, where ${stay} ${end}.`;
}

/** Why `unmeasured`: the usable figure, or figures, neither measured nor borrowable. */
function unmeasuredDescription(entry: ReasonFacts) {
    const missing = entry.coresSource === "none" && entry.memorySource === "none" ? "Its usable cores and memory are"
        : entry.coresSource === "none" ? "Its usable cores are" : "Its usable memory is";
    return `${missing} neither measured nor borrowable, so there is no recommendation.`;
}

/** The sentence under a VPS's reason, with its own floor, servers, free slots, budget flags and model maximum. */
export function slotSizingReasonDescription(entry: ReasonFacts, sizingModel: Pick<Model, "maximumSlots">) {
    switch (entry.reason) {
    case "cpu": return "One more slot would break the CPU budget.";
    case "memory": return "One more slot would break the memory budget.";
    case "floor": return floorDescription(entry);
    case "maximum": return `${sizingModel.maximumSlots} slots, the most a VPS holds, keep both budgets.`;
    case "drain": return drainDescription(entry);
    case "unmeasured": return unmeasuredDescription(entry);
    }
}

const SOURCE_WORDS: Record<HostingSlotSizingCapacitySource, string> = {
    measured: "measured", type: "borrowed (type)", "provider-vcpu": "borrowed (provider and vCPU)", none: "unknown",
};

/** Where each usable figure comes from: "Cores and memory measured", or "Cores measured · memory borrowed (type)" when they differ. */
export function slotSizingCapacitySources(entry: Pick<HostingSlotSizingHost, "coresSource" | "memorySource">) {
    return entry.coresSource === entry.memorySource ? `Cores and memory ${SOURCE_WORDS[entry.coresSource]}`
        : `Cores ${SOURCE_WORDS[entry.coresSource]} · memory ${SOURCE_WORDS[entry.memorySource]}`;
}

/** The usable figures it knows: "5.580 cores, 10.90 GiB usable", only the known one while the other is unknown, or null. */
export function slotSizingCapacityFigures(entry: Pick<HostingSlotSizingHost, "usableCores" | "usableMemoryBytes">) {
    const known = [
        entry.usableCores === null ? null : `${entry.usableCores.toFixed(3)} cores`,
        entry.usableMemoryBytes === null ? null : formatGiB(entry.usableMemoryBytes),
    ].filter((part) => part !== null);
    return known.length === 0 ? null : `${known.join(", ")} usable`;
}

/** "0.072 core-h": the control plane's own three decimals. */
export function formatCoreHours(value: number) {
    return `${value.toFixed(3)} core-h`;
}

/** A share (0–1) the control plane rounds to four decimals, as a percent with all of them: "0.42%". */
export function formatOverflowShare(value: number) {
    return `${(value * 100).toFixed(2)}%`;
}

/** "1 core-hour" or "0.5 core-hours", as the budget reads. */
function coreHours(value: number) {
    return `${value} ${value === 1 ? "core-hour" : "core-hours"}`;
}

/** "1%", as the memory budget reads: the share as a percent without trailing zeros. */
function budgetPercent(share: number) {
    return `${Number((share * 100).toFixed(4))}%`;
}

/** "2.5 GiB": the burst target with at most two decimals, as the capacity read writes its rules. */
function ruleGiB(bytes: number) {
    return `${Number((bytes / GIB).toFixed(2))} GiB`;
}

/**
 * Which budgets the figures at the recommendation break, from the control plane's flags on the exact figures: the
 * rounded figures cannot tell one at the edge ("1.000 core-h" can be over). Only `floor`, and `drain` at its floor, can be.
 */
export function slotSizingOverBudget(entry: Pick<HostingSlotSizingHost, "withinCpuBudget" | "withinMemoryBudget">) {
    return { cpu: entry.withinCpuBudget === false, memory: entry.withinMemoryBudget === false };
}

/** The two budgets in one sentence, from the read's model. */
export function slotSizingBudgets(sizingModel: Model) {
    return `Each VPS gets the most slots, from floor(vCPU ÷ 2) to ${sizingModel.maximumSlots}, at which its servers now plus typical new servers in the rest keep two budgets: at most ${coreHours(sizingModel.cpuShortageBudgetCoreHoursPerWeek)} a week of expected CPU shortage, and more servers online at once than its memory holds in under ${budgetPercent(sizingModel.memoryOverflowShare)} of the week.`;
}

/** What a typical new server is planned to be, and the history behind it. */
export function slotSizingTypicalServer(sizingModel: Model) {
    return `A typical new server needs ${sizingModel.cpuBurstVcpu} vCPU and ${ruleGiB(sizingModel.memoryBurstBytes)} while online and is online ${sizingModel.typicalWeeklyOnlineHours.toFixed(2)} hours a week, the mean of servers' weeks over the last ${sizingModel.historyDays} days (${sizingModel.halfLifeDays}-day half-life). A server observed for under ${sizingModel.minimumObservedDays} days counts with that typical week.`;
}

/** The note shown when the capacity samples could not be read, or null. */
export function slotSizingCapacityNote(sizingModel: Pick<Model, "capacityErrorCode">) {
    return sizingModel.capacityErrorCode === null ? null
        : `Capacity samples could not be read (${sizingModel.capacityErrorCode}), so no VPS's usable cores or memory are known: every VPS is unmeasured and has no recommendation.`;
}

/** The explanations behind each column's tooltip, with the read's own budgets and targets. */
export function slotSizingHints(sizingModel: Model) {
    const budget = coreHours(sizingModel.cpuShortageBudgetCoreHoursPerWeek);
    const share = budgetPercent(sizingModel.memoryOverflowShare);
    return {
        slots: "Slots now: the VPS's stored slot capacity, floor(vCPU ÷ 2) when it is registered and more once an administrator raises it. A slot reserves no cores.",
        servers: "Servers in its slots now.",
        recommended: `Recommended slots: the most, from floor(vCPU ÷ 2) to ${sizingModel.maximumSlots}, at which the servers on it now plus typical new servers in the other slots keep both budgets (at most ${budget} a week of expected CPU shortage, and more online at once than its memory holds in under ${share} of the week). Each server counts with its own week of online hours and the CPU it is planned to need on this VPS; one observed for under ${sizingModel.minimumObservedDays} days counts with the typical week, and one without a measured need at ${sizingModel.cpuBurstVcpu} vCPU. Servers rarely online together can share a VPS, so this can be above the servers it fits at once. The difference is against its slots now. Nothing applies it.`,
        reason: `Why the recommendation is what it is. CPU budget or Memory budget: one more slot would break that budget. Floor: the most slots that keep both budgets, if any, is below floor(vCPU ÷ 2), but a VPS always keeps that many, so at least one budget breaks there; either its servers, as many as the floor, break it themselves and nothing moves, or fewer servers leave room for the free recommended slots within the budgets and the floor filled with typical servers breaks it. Maximum: ${sizingModel.maximumSlots} slots, the most a VPS holds, keep both budgets. Drain: its servers alone break a budget and are more than the floor, so the recommendation is below them and some would move, until those that stay keep both budgets or down to the floor, where they may still break one. Unmeasured: its usable cores or memory are neither measured nor borrowable, so there is no recommendation.`,
        shortage: `Expected CPU shortage at the recommendation, in core-hours a week: the cores that the servers online together are expected to want beyond its usable cores, summed over the week's half-hours, for the servers that stay plus typical servers up to the recommendation. The budget is ${budget}. Over budget marks where the control plane says the exact figure breaks it, which the rounded figure cannot show at the edge; only Drain and Floor can be.`,
        overflow: `Memory over: the expected share of the week in which more of those servers are online at once than floor(usable memory ÷ memory per server). The budget is under ${share}. Over budget marks where the control plane says the exact share reaches it, which the rounded figure cannot show at the edge; only Drain and Floor can be.`,
        toMove: "Servers that would move off it: with Drain, its servers beyond the recommendation, dropped one at a time by whichever leaves the broken budget lowest; 0 otherwise. Nothing moves them.",
        free: "Free recommended slots: slots beyond the servers that stay that a moved server could take, counted as a typical server, with both budgets kept. The recommendation less its servers for CPU budget, Memory budget and Maximum; the room the budgets allow under the floor for Floor; 0 for Drain and Unmeasured. Only a VPS that accepts relocations offers them to its region.",
        capacity: `Its usable cores and memory, each with where it comes from: measured, its own from the capacity read; borrowed (type), the median of the measured VPSs of its instance type; borrowed (provider and vCPU), the median of the measured VPSs of its provider and vCPU count; unknown, nothing to measure or borrow, which leaves the VPS Unmeasured. Each is borrowed on its own. Each online server is planned to need ${ruleGiB(sizingModel.memoryBurstBytes)} of memory on it, or its servers' measured peak where higher.`,
        regionToMove: "Servers to move off drained VPSs whose region this is: a server's own published region, else its VPS's.",
        regionFree: "Free recommended slots on the region's VPSs that accept relocations. Regions overlap, so a VPS in several regions offers the same slots to each.",
        shortfall: "Shortfall: servers to move with no free recommended slot of their own provider in the region, since a move keeps a server on its provider. They need more VPSs; the read does not say how many.",
    };
}

export type SlotSizingHints = ReturnType<typeof slotSizingHints>;
