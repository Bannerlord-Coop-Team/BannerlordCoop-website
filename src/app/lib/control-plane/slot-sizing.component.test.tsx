import { expect, it } from "vitest";
import { ControlPlaneAdminError, decodeControlPlaneAdminResponse } from "./client";
import {
    formatCoreHours,
    formatOverflowShare,
    parseSlotSizing,
    SLOT_SIZING_LIMITS,
    slotSizingBudgets,
    slotSizingCapacityFigures,
    slotSizingCapacityNote,
    slotSizingCapacitySources,
    slotSizingDifference,
    slotSizingErrorMessage,
    slotSizingFloor,
    slotSizingHints,
    slotSizingHostGroups,
    slotSizingOverBudget,
    slotSizingProviderLabel,
    slotSizingReasonDescription,
    slotSizingReasonLabel,
    slotSizingTypicalServer,
    slotSizingUnavailable,
} from "./slot-sizing";
import type { HostingAdminSlotSizing, HostingSlotSizingHost, HostingSlotSizingTarget } from "./types";

/** A copy of a record without one key. */
function without<T extends object>(value: T, key: keyof T) {
    const copy = { ...value };
    delete copy[key];
    return copy;
}

const GIB = 1024 ** 3;
const BURST = 2_684_354_560;
const model: HostingAdminSlotSizing["model"] = {
    cpuShortageBudgetCoreHoursPerWeek: 1, memoryOverflowShare: 0.01, cpuBurstVcpu: 1.6, memoryBurstBytes: BURST, historyDays: 28,
    halfLifeDays: 14, minimumObservedDays: 7, maximumSlots: 32, typicalWeeklyOnlineHours: 90.96, capacityErrorCode: null,
};
/** No slot target: every VPS's until automatic slot sizing sets one, and every production VPS's today. */
const NO_TARGET: HostingSlotSizingTarget = { targetSlots: null, pendingLowerSlots: null, pendingLowerSince: null, changedAt: null, reason: null };
const TARGET_CHANGED = "2026-10-21T08:16:04.000Z";
const TARGET_HELD = "2026-10-22T08:16:04.000Z";

/**
 * The control plane's documented example (`docs/managed-hosting/web-admin.md`, "Slot sizing"), from its PGlite test
 * fixture. The page elides `vps-new` and `vps-small`; they are filled in from its descriptions and the control plane's
 * test of the same fleet: `vps-new` borrows `vps-b`'s 4 cores and 12 GiB (both provider-vcpu) and is recommended 2
 * slots (cpu, 2 free), and `vps-small` has nothing to borrow. Since #542 each VPS has its slot target, all null.
 */
const example: HostingAdminSlotSizing = {
    generatedAt: "2026-10-17T00:20:00.000Z",
    model,
    hosts: [
        { serviceName: "vps-a", provider: "ovhcloud-vps", regionKeys: ["poland"], vCpu: 6, slots: 4,
            occupants: 4, acceptsRelocations: true, usableCores: 5.8, coresSource: "measured",
            usableMemoryBytes: 12884901888, memorySource: "measured", memoryBytesPerServer: 2684354560,
            recommendedSlots: 5, reason: "cpu", expectedShortageCoreHoursPerWeek: 0.072, withinCpuBudget: true,
            memoryOverflowShare: 0, withinMemoryBudget: true, serversToMove: 0, freeRecommendedSlots: 1, target: NO_TARGET },
        { serviceName: "vps-b", provider: "ovhcloud-vps", regionKeys: ["poland"], vCpu: 4, slots: 4,
            occupants: 4, acceptsRelocations: true, usableCores: 4, coresSource: "measured",
            usableMemoryBytes: 12884901888, memorySource: "measured", memoryBytesPerServer: 2684354560,
            recommendedSlots: 2, reason: "drain", expectedShortageCoreHoursPerWeek: 0, withinCpuBudget: true,
            memoryOverflowShare: 0, withinMemoryBudget: true, serversToMove: 2, freeRecommendedSlots: 0, target: NO_TARGET },
        { serviceName: "vps-new", provider: "ovhcloud-vps", regionKeys: ["poland"], vCpu: 4, slots: 2,
            occupants: 0, acceptsRelocations: true, usableCores: 4, coresSource: "provider-vcpu",
            usableMemoryBytes: 12884901888, memorySource: "provider-vcpu", memoryBytesPerServer: 2684354560,
            recommendedSlots: 2, reason: "cpu", expectedShortageCoreHoursPerWeek: 0, withinCpuBudget: true,
            memoryOverflowShare: 0, withinMemoryBudget: true, serversToMove: 0, freeRecommendedSlots: 2, target: NO_TARGET },
        { serviceName: "vps-small", provider: "ovhcloud-vps", regionKeys: ["poland"], vCpu: 2, slots: 1,
            occupants: 0, acceptsRelocations: true, usableCores: null, coresSource: "none",
            usableMemoryBytes: null, memorySource: "none", memoryBytesPerServer: 2684354560,
            recommendedSlots: null, reason: "unmeasured", expectedShortageCoreHoursPerWeek: null, withinCpuBudget: null,
            memoryOverflowShare: null, withinMemoryBudget: null, serversToMove: 0, freeRecommendedSlots: 0, target: NO_TARGET },
    ],
    regions: [{ regionKey: "poland", serversToMove: 2, freeRecommendedSlots: 3, shortfallServers: 0 }],
};

const ovh = { provider: "ovhcloud-vps", acceptsRelocations: true, memoryBytesPerServer: BURST, serversToMove: 0 } as const;
// Grows: three part-time owners, rarely online together.
const grows: HostingSlotSizingHost = { ...ovh, serviceName: "vps-de-part.vps.ovh.net", regionKeys: ["germany"], vCpu: 6, slots: 3, occupants: 3,
    usableCores: 5.58, coresSource: "measured", usableMemoryBytes: 11_703_786_240, memorySource: "measured", recommendedSlots: 5, reason: "cpu",
    expectedShortageCoreHoursPerWeek: 0.842, withinCpuBudget: true, memoryOverflowShare: 0.0021, withinMemoryBudget: true, freeRecommendedSlots: 2 };
// Three always-on servers fit its cores; a fourth would not.
const full: HostingSlotSizingHost = { ...grows, serviceName: "vps-de-always.vps.ovh.net", usableCores: 5.512, usableMemoryBytes: 11_274_289_152,
    recommendedSlots: 3, expectedShortageCoreHoursPerWeek: 0.004, memoryOverflowShare: 0, freeRecommendedSlots: 0 };
// Memory runs out before CPU.
const memoryBound: HostingSlotSizingHost = { ...grows, serviceName: "vps-uk-mem.vps.ovh.net", regionKeys: ["united-kingdom"], occupants: 1,
    usableCores: 5.6, usableMemoryBytes: 7 * GIB, recommendedSlots: 4, reason: "memory", expectedShortageCoreHoursPerWeek: 0.41,
    memoryOverflowShare: 0.0087, freeRecommendedSlots: 3 };
// Heavy steal: its two servers already break both budgets, but a VPS keeps its floor.
const floored: HostingSlotSizingHost = { ...grows, serviceName: "vps-pl-steal.vps.ovh.net", regionKeys: ["poland"], vCpu: 4, slots: 2, occupants: 2,
    usableCores: 2.9, usableMemoryBytes: 3_435_973_837, recommendedSlots: 2, reason: "floor", expectedShortageCoreHoursPerWeek: 1.853,
    withinCpuBudget: false, memoryOverflowShare: 0.0412, withinMemoryBudget: false, freeRecommendedSlots: 0 };
// Raised to five slots, its five always-on servers want twice its cores: two would move, down to its floor of three, which keep both budgets.
const drained: HostingSlotSizingHost = { ...grows, serviceName: "vps-us-busy.vps.ovh.net", regionKeys: ["us-east"], slots: 5, occupants: 5,
    usableCores: 5.5, usableMemoryBytes: 11_274_289_152, recommendedSlots: 3, reason: "drain", expectedShortageCoreHoursPerWeek: 0.95,
    memoryOverflowShare: 0.0003, serversToMove: 2, freeRecommendedSlots: 0 };
// Never used, it borrows its instance type's capacity.
const borrowed: HostingSlotSizingHost = { ...grows, serviceName: "vmi654321.contaboserver.net", provider: "contabo-vps", vCpu: 8, slots: 4, occupants: 0,
    usableCores: 7.2, coresSource: "type", usableMemoryBytes: 14 * GIB, memorySource: "type", recommendedSlots: 6, expectedShortageCoreHoursPerWeek: 0.677,
    memoryOverflowShare: 0.0011, freeRecommendedSlots: 6 };
// A large VPS whose servers' peak working set is above the target: 32 slots keep both budgets.
const biggest: HostingSlotSizingHost = { ...grows, serviceName: "vps-fr-big.vps.ovh.net", regionKeys: ["france"], vCpu: 24, slots: 12, occupants: 6,
    usableCores: 22.5, usableMemoryBytes: 62 * GIB, memoryBytesPerServer: 2_899_102_924, recommendedSlots: 32, reason: "maximum",
    expectedShortageCoreHoursPerWeek: 0.218, memoryOverflowShare: 0, freeRecommendedSlots: 26 };
// Not onboarded yet, so its free slots are not offered to its region.
const onboarding: HostingSlotSizingHost = { ...grows, serviceName: "vps-us-new.vps.ovh.net", regionKeys: ["us-east"], occupants: 0, acceptsRelocations: false,
    usableCores: 5.512, coresSource: "provider-vcpu", usableMemoryBytes: 11_274_289_152, memorySource: "provider-vcpu", recommendedSlots: 4,
    expectedShortageCoreHoursPerWeek: 0.6,
    memoryOverflowShare: 0.0004, freeRecommendedSlots: 4 };
const unmeasured: HostingSlotSizingHost = { ...ovh, serviceName: "vps-sg-spare.vps.ovh.net", regionKeys: ["singapore"], vCpu: 2, slots: 1, occupants: 0,
    usableCores: null, coresSource: "none", usableMemoryBytes: null, memorySource: "none", recommendedSlots: null, reason: "unmeasured",
    expectedShortageCoreHoursPerWeek: null, withinCpuBudget: null, memoryOverflowShare: null, withinMemoryBudget: null, freeRecommendedSlots: 0 };
// A floor with fewer servers than it: beside its one server one more typical server fits, and the floor's third slot filled breaks the CPU budget.
const roomyFloor: HostingSlotSizingHost = { ...floored, vCpu: 6, slots: 3, occupants: 1, recommendedSlots: 3, expectedShortageCoreHoursPerWeek: 252,
    withinCpuBudget: false, memoryOverflowShare: 0, withinMemoryBudget: true, freeRecommendedSlots: 1 };
// A drain that stops above its floor (8 vCPU, floor 4), keeping both budgets.
const drainedAbove: HostingSlotSizingHost = { ...grows, serviceName: "vps-us-busy.vps.ovh.net", regionKeys: ["us-east"], vCpu: 8, slots: 7, occupants: 7,
    recommendedSlots: 5, reason: "drain", expectedShortageCoreHoursPerWeek: 0.81, memoryOverflowShare: 0.0004, serversToMove: 2, freeRecommendedSlots: 0 };
/** A fleet like production's, with every reason: the two servers to move off us-east have no free slot there. */
const fleet: HostingAdminSlotSizing = {
    generatedAt: "2026-10-20T14:05:12.345Z",
    model: { ...model, typicalWeeklyOnlineHours: 41.37 },
    hosts: [grows, full, memoryBound, floored, drained, borrowed, biggest, onboarding, unmeasured],
    regions: [
        { regionKey: "us-east", serversToMove: 2, freeRecommendedSlots: 0, shortfallServers: 2 },
        { regionKey: "france", serversToMove: 0, freeRecommendedSlots: 26, shortfallServers: 0 },
        { regionKey: "germany", serversToMove: 0, freeRecommendedSlots: 8, shortfallServers: 0 },
        { regionKey: "united-kingdom", serversToMove: 0, freeRecommendedSlots: 3, shortfallServers: 0 },
        { regionKey: "poland", serversToMove: 0, freeRecommendedSlots: 0, shortfallServers: 0 },
        { regionKey: "singapore", serversToMove: 0, freeRecommendedSlots: 0, shortfallServers: 0 },
    ],
};

/** The fleet with one VPS changed. */
function withHost(entry: HostingSlotSizingHost, change: Record<string, unknown>) {
    return { ...fleet, hosts: fleet.hosts.map((candidate) => candidate === entry ? { ...entry, ...change } : candidate) };
}

/** One VPS with some fields changed. */
function variant(entry: HostingSlotSizingHost, change: Partial<HostingSlotSizingHost>): HostingSlotSizingHost {
    return { ...entry, ...change };
}

function withModel(change: Record<string, unknown>) {
    return { ...fleet, model: { ...fleet.model, ...change } };
}

function withRegion(index: number, change: Record<string, unknown>) {
    return { ...fleet, regions: fleet.regions.map((candidate, at) => at === index ? { ...candidate, ...change } : candidate) };
}

/** The fleet with one VPS given a slot target: none, with some fields changed. */
function withTarget(entry: HostingSlotSizingHost, change: Record<string, unknown>) {
    return withHost(entry, { target: { ...NO_TARGET, ...change } });
}

it("accepts the control plane's documented example exactly as it is", () => {
    expect(parseSlotSizing(example)).toBe(example);
});

it("accepts a realistic fleet with every reason", () => {
    expect(parseSlotSizing(fleet)).toBe(fleet);
    expect(new Set(fleet.hosts.map((entry) => entry.reason))).toEqual(new Set(["cpu", "memory", "floor", "maximum", "drain", "unmeasured"]));
});

it("accepts every VPS's slot target all null, as production sends it today, and a read without one from before it", () => {
    const untargeted = { ...fleet, hosts: fleet.hosts.map((entry) => ({ ...entry, target: NO_TARGET })) };
    expect(parseSlotSizing(untargeted)).toBe(untargeted);
    // A control plane before automatic slot sizing (#542) sends no target, so a rollback still reads.
    expect(fleet.hosts.some((entry) => "target" in entry)).toBe(false);
    expect(parseSlotSizing(fleet)).toBe(fleet);
});

it("accepts slot targets the sizer sets, holds and clears", () => {
    const set = withTarget(grows, { targetSlots: 5, changedAt: TARGET_CHANGED, reason: "cpu" });
    expect(parseSlotSizing(set)).toBe(set);
    // A target bounds its servers, not its slots: below them, with servers to drain, or at the floor or the maximum.
    expect(parseSlotSizing(withTarget(drained, { targetSlots: 3, changedAt: TARGET_CHANGED, reason: "drain" }))).not.toBeNull();
    expect(parseSlotSizing(withTarget(biggest, { targetSlots: 12, changedAt: TARGET_CHANGED, reason: "floor" }))).not.toBeNull();
    expect(parseSlotSizing(withTarget(biggest, { targetSlots: 32, changedAt: TARGET_CHANGED, reason: "maximum" }))).not.toBeNull();
    expect(parseSlotSizing(withTarget(unmeasured, { targetSlots: 1, changedAt: TARGET_CHANGED, reason: "memory" }))).not.toBeNull();
    // A lower recommendation held below the target, or below its slots before any target.
    expect(parseSlotSizing(withTarget(grows, { targetSlots: 5, pendingLowerSlots: 4, pendingLowerSince: TARGET_HELD, changedAt: TARGET_CHANGED,
        reason: "cpu" }))).not.toBeNull();
    expect(parseSlotSizing(withTarget(drained, { pendingLowerSlots: 4, pendingLowerSince: TARGET_HELD }))).not.toBeNull();
    // A cleared target keeps its time and reason; the control plane's own reasons, up to 32 characters.
    expect(parseSlotSizing(withTarget(grows, { changedAt: TARGET_CHANGED, reason: "switched-off" }))).not.toBeNull();
    expect(parseSlotSizing(withTarget(grows, { targetSlots: 6, changedAt: TARGET_CHANGED, reason: "admin-raise" }))).not.toBeNull();
    expect(parseSlotSizing(withTarget(grows, { changedAt: TARGET_CHANGED, reason: `a${"-".repeat(30)}9` }))).not.toBeNull();
});

it.each(["2026-02-30T08:16:04.000Z", "2026-13-21T08:16:04.000Z", "x".repeat(24)])(
    "accepts the target time %s, which the control plane stores and presents by its length alone", (time) => {
        // Only the sizer parses target times, so a stored non-date still reaches the read: one VPS's must not hide the fleet.
        expect(parseSlotSizing(withTarget(grows, { targetSlots: 5, changedAt: time, reason: "cpu" }))).not.toBeNull();
        expect(parseSlotSizing(withTarget(drained, { pendingLowerSlots: 4, pendingLowerSince: time }))).not.toBeNull();
    },
);

it("reads a generated time that has the form but does not parse as malformed, rather than throwing from toISOString", () => {
    expect(() => parseSlotSizing({ ...fleet, generatedAt: "9999-99-99T99:99:99.999Z" })).not.toThrow();
    expect(parseSlotSizing({ ...fleet, generatedAt: "9999-99-99T99:99:99.999Z" })).toBeNull();
});

it("accepts what the control plane can send that looks unusual", () => {
    // A failed capacity read: every VPS unmeasured, and nothing to move or offer anywhere.
    const failed = { ...fleet, model: { ...fleet.model, capacityErrorCode: "fleet_capacity_history_unavailable" },
        hosts: fleet.hosts.map((entry) => ({ ...unmeasured, serviceName: entry.serviceName, provider: entry.provider, regionKeys: entry.regionKeys, vCpu: entry.vCpu, slots: entry.slots, occupants: entry.occupants })),
        regions: fleet.regions.map((entry) => ({ ...entry, serversToMove: 0, freeRecommendedSlots: 0, shortfallServers: 0 })) };
    expect(parseSlotSizing(failed)).toBe(failed);
    // No VPSs and no regions; a VPS of a provider the website does not know, which the control plane leaves unmeasured.
    expect(parseSlotSizing({ ...fleet, hosts: [], regions: [] })).not.toBeNull();
    expect(parseSlotSizing(withHost(unmeasured, { provider: "hetzner-cloud" }))).not.toBeNull();
    // A drain that stops at its floor can still break a budget; one above it keeps both.
    expect(parseSlotSizing(withHost(drained, { expectedShortageCoreHoursPerWeek: 2.5, withinCpuBudget: false, memoryOverflowShare: 0.2,
        withinMemoryBudget: false }))).not.toBeNull();
    expect(parseSlotSizing(withHost(drained, drainedAbove))).not.toBeNull();
    // At the floor one budget can hold while the other breaks.
    expect(parseSlotSizing(withHost(floored, { memoryOverflowShare: 0.0099, withinMemoryBudget: true }))).not.toBeNull();
    // A figure that reads as its budget once rounded can be either side of it: the flags say which.
    expect(parseSlotSizing(withHost(grows, { expectedShortageCoreHoursPerWeek: 1, memoryOverflowShare: 0.01 }))).not.toBeNull();
    expect(parseSlotSizing(withHost(floored, { expectedShortageCoreHoursPerWeek: 1, memoryOverflowShare: 0.01 }))).not.toBeNull();
    // Floor with free slots the budgets allow under it, and the maximum on a small VPS whose servers are rarely online.
    expect(parseSlotSizing(withHost(floored, { occupants: 0, freeRecommendedSlots: 1 }))).not.toBeNull();
    expect(parseSlotSizing(withHost(floored, roomyFloor))).not.toBeNull();
    expect(parseSlotSizing(withHost(full, { reason: "maximum", recommendedSlots: 32, freeRecommendedSlots: 29 }))).not.toBeNull();
    // Figures carry floating-point noise from their rounding; a typical server online every hour of the week.
    expect(parseSlotSizing(withHost(grows, { expectedShortageCoreHoursPerWeek: 0.1 + 0.2, usableCores: 0.1 * 3 }))).not.toBeNull();
    expect(parseSlotSizing(withModel({ typicalWeeklyOnlineHours: 168 }))).not.toBeNull();
    // Usable capacity clamped at zero still sizes; each figure has its own source.
    expect(parseSlotSizing(withHost(floored, { usableCores: 0, usableMemoryBytes: 0 }))).not.toBeNull();
    expect(parseSlotSizing(withHost(grows, { memorySource: "type" }))).not.toBeNull();
    // A VPS with one side unknown is unmeasured, keeping the other and its source.
    expect(parseSlotSizing(withHost(unmeasured, { usableCores: 1.5, coresSource: "measured" }))).not.toBeNull();
    expect(parseSlotSizing(withHost(unmeasured, { usableMemoryBytes: GIB, memorySource: "provider-vcpu" }))).not.toBeNull();
});

it("keeps a flag whose figure, as rounded, crosses an uneven budget by less than half its last decimal", () => {
    // Under a budget of 0.9996 core-hours an exact 0.9996 reads 1.000, and over one of 1.0004 an exact 1.00045 reads 1.000 too.
    expect(parseSlotSizing({ ...withHost(grows, { expectedShortageCoreHoursPerWeek: 1 }), model: { ...fleet.model, cpuShortageBudgetCoreHoursPerWeek: 0.9996 } })).not.toBeNull();
    expect(parseSlotSizing({ ...withHost(floored, { expectedShortageCoreHoursPerWeek: 1 }), model: { ...fleet.model, cpuShortageBudgetCoreHoursPerWeek: 1.0004 } })).not.toBeNull();
    // Under 1.236% an exact 1.235% reads 1.24%, and at 1.234% an exact 1.2341% reads 1.23%.
    expect(parseSlotSizing({ ...withHost(grows, { memoryOverflowShare: 0.0124 }), model: { ...fleet.model, memoryOverflowShare: 0.01236 } })).not.toBeNull();
    expect(parseSlotSizing({ ...withHost(floored, { memoryOverflowShare: 0.0123 }), model: { ...fleet.model, memoryOverflowShare: 0.01234 } })).not.toBeNull();
    // A whole last decimal past it is not rounding.
    expect(parseSlotSizing({ ...withHost(grows, { expectedShortageCoreHoursPerWeek: 1.001 }), model: { ...fleet.model, cpuShortageBudgetCoreHoursPerWeek: 0.9996 } })).toBeNull();
    expect(parseSlotSizing({ ...withHost(floored, { memoryOverflowShare: 0.0122 }), model: { ...fleet.model, memoryOverflowShare: 0.01234 } })).toBeNull();
});

it.each([
    ["an extra top-level key", { ...fleet, apply: true }],
    ["a missing top-level key", without(fleet, "regions")],
    ["a timestamp without milliseconds", { ...fleet, generatedAt: "2026-10-20T14:05:12Z" }],
    ["a timestamp that is not a real date", { ...fleet, generatedAt: "2026-02-30T14:05:12.345Z" }],
    ["a model with an extra key", withModel({ applied: false })],
    ["a model without a key", { ...fleet, model: without(fleet.model, "capacityErrorCode") }],
    ["a negative CPU budget", withModel({ cpuShortageBudgetCoreHoursPerWeek: -1 })],
    ["a memory budget of 0", withModel({ memoryOverflowShare: 0 })],
    ["a memory budget above 1", withModel({ memoryOverflowShare: 1.5 })],
    ["a CPU burst of 0", withModel({ cpuBurstVcpu: 0 })],
    ["a CPU burst above 256 vCPU", withModel({ cpuBurstVcpu: 257 })],
    ["a fractional memory burst", withModel({ memoryBurstBytes: BURST + 0.5 })],
    ["a memory burst above 64 GiB", withModel({ memoryBurstBytes: 64 * GIB + 1 })],
    ["no history days", withModel({ historyDays: 0 })],
    ["a fractional half-life", withModel({ halfLifeDays: 1.5 })],
    ["a negative minimum observed days", withModel({ minimumObservedDays: -1 })],
    ["no maximum slots", withModel({ maximumSlots: 0 })],
    ["typical online hours beyond the week", withModel({ typicalWeeklyOnlineHours: 168.01 })],
    ["typical online hours with three decimals", withModel({ typicalWeeklyOnlineHours: 41.375 })],
    ["an empty capacity error code", withModel({ capacityErrorCode: "" })],
    ["a capacity error with a VPS still sized", withModel({ capacityErrorCode: "fleet_capacity_history_unavailable" })],
    ["hosts that are not a list", { ...fleet, hosts: {} }],
    ["a VPS with an extra key", withHost(grows, { apply: "raise" })],
    ["a VPS without a key", { ...fleet, hosts: [without(grows, "acceptsRelocations")] }],
    ["one VPS twice", { ...fleet, hosts: [...fleet.hosts, grows] }],
    ["an empty service name", withHost(grows, { serviceName: "" })],
    ["an empty provider", withHost(grows, { provider: "" })],
    ["a region key that is not text", withHost(grows, { regionKeys: [7] })],
    ["a VPS of 1 vCPU, which sizing refuses", withHost(unmeasured, { vCpu: 1 })],
    ["fractional slots", withHost(grows, { slots: 3.5 })],
    // Each whole-number check on its own. Fractional servers to move need none: every reason pins them to a whole number.
    ["fractional vCPUs", withHost(unmeasured, { vCpu: 2.5 })],
    ["fractional servers", withHost(unmeasured, { occupants: 0.5 })],
    ["fractional free slots under a floor", withHost(floored, { ...roomyFloor, freeRecommendedSlots: 0.5 })],
    ["fractional memory per server", withHost(grows, { memoryBytesPerServer: BURST + 0.5 })],
    ["fewer slots than its floor", withHost(borrowed, { slots: 3 })],
    ["more slots than any VPS holds", withHost(biggest, { slots: 33 })],
    ["more servers than slots", withHost(grows, { occupants: 4, freeRecommendedSlots: 1 })],
    ["whether it accepts relocations as text", withHost(grows, { acceptsRelocations: "yes" })],
    ["usable cores with four decimals", withHost(grows, { usableCores: 5.5801 })],
    ["negative usable cores", withHost(grows, { usableCores: -0.5 })],
    ["fractional usable memory", withHost(grows, { usableMemoryBytes: 11_703_786_240.5 })],
    ["an unknown cores source", withHost(grows, { coresSource: "fleet" })],
    ["an unknown memory source", withHost(grows, { memorySource: "fleet" })],
    ["memory per server under the burst target", withHost(grows, { memoryBytesPerServer: BURST - 1 })],
    ["an unknown reason", withHost(grows, { reason: "steal" })],
    // Each source is none exactly when its figure is unknown.
    ["usable cores with the cores source none", withHost(unmeasured, { usableCores: 1.5 })],
    ["unknown usable cores with a cores source", withHost(unmeasured, { coresSource: "measured" })],
    ["usable memory with the memory source none", withHost(unmeasured, { usableMemoryBytes: GIB })],
    ["unknown usable memory with a memory source", withHost(unmeasured, { memorySource: "type" })],
    // Unmeasured exactly when either source is none, and then with nothing else.
    ["an unmeasured VPS with both figures and their sources", withHost(unmeasured, { usableCores: 1.5, coresSource: "measured", usableMemoryBytes: GIB, memorySource: "measured" })],
    ["a sized VPS with its cores unknown", withHost(grows, { usableCores: null, coresSource: "none" })],
    ["a sized VPS with its memory unknown", withHost(grows, { usableMemoryBytes: null, memorySource: "none" })],
    ["an unmeasured VPS with a recommendation", withHost(unmeasured, { recommendedSlots: 1 })],
    ["an unmeasured VPS with a shortage", withHost(unmeasured, { expectedShortageCoreHoursPerWeek: 0 })],
    ["an unmeasured VPS with a memory overflow", withHost(unmeasured, { memoryOverflowShare: 0 })],
    ["an unmeasured VPS with a CPU budget flag", withHost(unmeasured, { withinCpuBudget: true })],
    ["an unmeasured VPS with a memory budget flag", withHost(unmeasured, { withinMemoryBudget: false })],
    ["an unmeasured VPS with free slots", withHost(unmeasured, { freeRecommendedSlots: 1 })],
    ["an unmeasured VPS with servers to move", withHost(unmeasured, { occupants: 1, serversToMove: 1 })],
    ["a sized VPS without a recommendation", withHost(grows, { recommendedSlots: null })],
    ["a sized VPS without a shortage", withHost(grows, { expectedShortageCoreHoursPerWeek: null })],
    ["a sized VPS without a memory overflow", withHost(grows, { memoryOverflowShare: null })],
    // A sized VPS flags both budgets, as booleans; null read as false would pass the floor's rules.
    ["a sized VPS without a CPU budget flag", withHost(floored, { withinCpuBudget: null })],
    ["a sized VPS without a memory budget flag", withHost(floored, { withinMemoryBudget: null })],
    ["a budget flag as text", withHost(grows, { withinCpuBudget: "true" })],
    // A flag is of the exact figure: the rounded one is within half a last decimal of its side of the budget.
    ["the CPU budget kept with a shortage a decimal over it", withHost(drained, { expectedShortageCoreHoursPerWeek: 1.001 })],
    ["the memory budget kept with a share a decimal over it", withHost(drained, { memoryOverflowShare: 0.0101 })],
    ["the CPU budget broken with a shortage a decimal under it", withHost(floored, { expectedShortageCoreHoursPerWeek: 0.999 })],
    ["the memory budget broken with a share a decimal under it", withHost(floored, { memoryOverflowShare: 0.0099 })],
    // Within floor(vCPU ÷ 2) to the maximum.
    ["a recommendation below the floor", withHost(memoryBound, { recommendedSlots: 2, freeRecommendedSlots: 1 })],
    // A CPU-bound VPS within its slots, recommended one more than any VPS holds: only the recommendation's range rejects it.
    ["a recommendation above the maximum", withHost(grows, { recommendedSlots: 33, freeRecommendedSlots: 30 })],
    // Its floor, floor(66 ÷ 2) = 33, is above the maximum, so no VPS can have it: its slots are below that floor and any
    // recommendation is above the maximum, and both rules reject it. Each has its own isolated case above.
    ["a VPS whose floor is above the maximum", withHost(floored, { vCpu: 66, recommendedSlots: 33 })],
    ["a fractional recommendation", withHost(grows, { recommendedSlots: 4.5, freeRecommendedSlots: 1.5 })],
    // Rounded as the control plane rounds them.
    ["a shortage with four decimals", withHost(grows, { expectedShortageCoreHoursPerWeek: 0.8421 })],
    ["a negative shortage", withHost(floored, { expectedShortageCoreHoursPerWeek: -0.001 })],
    ["a memory overflow with five decimals", withHost(grows, { memoryOverflowShare: 0.00211 })],
    ["a memory overflow above 1", withHost(floored, { memoryOverflowShare: 1.0001 })],
    // Only drain moves servers, keeps the rest and has no free slots.
    ["servers to move without a drain", withHost(full, { serversToMove: 1 })],
    // Without regions, so only the VPS's own rule can reject it.
    ["a drain that moves nothing", { ...withHost(drained, { serversToMove: 0, recommendedSlots: 5 }), regions: [] }],
    ["a drain that moves more than its servers less those kept", withHost(drained, { serversToMove: 3 })],
    ["a drain with free slots", withHost(drained, { freeRecommendedSlots: 1 })],
    // A drain keeps both budgets unless it stopped at its floor.
    ["a drain above its floor that breaks the CPU budget", withHost(drained, { ...drainedAbove, expectedShortageCoreHoursPerWeek: 1, withinCpuBudget: false })],
    ["a drain above its floor that breaks the memory budget", withHost(drained, { ...drainedAbove, memoryOverflowShare: 0.01, withinMemoryBudget: false })],
    // Floor recommends floor(vCPU ÷ 2), with no more free slots than it leaves, and breaks a budget there.
    ["a floor above floor(vCPU ÷ 2)", withHost(floored, { recommendedSlots: 3 })],
    ["a floor with more free slots than it leaves", withHost(floored, { freeRecommendedSlots: 1 })],
    ["a floor below its servers", withHost(floored, { occupants: 3 })],
    ["a floor that keeps both budgets", withHost(floored, { expectedShortageCoreHoursPerWeek: 0.9, withinCpuBudget: true, memoryOverflowShare: 0.009, withinMemoryBudget: true })],
    // CPU, memory and maximum keep both budgets, and offer every slot beyond their servers.
    ["a CPU reason that breaks the CPU budget", withHost(grows, { expectedShortageCoreHoursPerWeek: 1, withinCpuBudget: false })],
    ["a CPU reason that breaks the memory budget", withHost(grows, { memoryOverflowShare: 0.01, withinMemoryBudget: false })],
    ["a memory reason that breaks the memory budget", withHost(memoryBound, { memoryOverflowShare: 0.01, withinMemoryBudget: false })],
    ["a maximum that breaks the CPU budget", withHost(biggest, { expectedShortageCoreHoursPerWeek: 1.2, withinCpuBudget: false })],
    ["a CPU reason with fewer free slots than it has", withHost(grows, { freeRecommendedSlots: 1 })],
    ["a CPU reason with more free slots than it has", withHost(grows, { freeRecommendedSlots: 3 })],
    ["a CPU reason at the maximum", withHost(biggest, { reason: "cpu" })],
    ["a maximum below the maximum", withHost(grows, { reason: "maximum" })],
    // A slot target, when the control plane sends one, as it stores it.
    ["a slot target with an extra key", withTarget(grows, { applied: true })],
    ["a slot target without a key", withHost(grows, { target: without(NO_TARGET, "reason") })],
    ["a slot target that is null", withHost(grows, { target: null })],
    ["a fractional target", withTarget(drained, { targetSlots: 3.5, changedAt: TARGET_CHANGED, reason: "drain" })],
    ["a target below floor(vCPU ÷ 2)", withTarget(grows, { targetSlots: 2, changedAt: TARGET_CHANGED, reason: "drain" })],
    ["a target above the most a VPS holds", withTarget(biggest, { targetSlots: 33, changedAt: TARGET_CHANGED, reason: "maximum" })],
    ["a target without its change time and reason", withTarget(grows, { targetSlots: 5 })],
    ["a reason without a change time", withTarget(grows, { reason: "cpu" })],
    ["a change time without a reason", withTarget(grows, { changedAt: TARGET_CHANGED })],
    // A target time is only checked for its stored form's length, as the control plane presents it.
    ["a change time without milliseconds", withTarget(grows, { targetSlots: 5, changedAt: "2026-10-21T08:16:04Z", reason: "cpu" })],
    ["a change time with an offset", withTarget(grows, { targetSlots: 5, changedAt: "2026-10-21T08:16:04.000+00:00", reason: "cpu" })],
    ["a change time that is not text", withTarget(grows, { targetSlots: 5, changedAt: Date.parse(TARGET_CHANGED), reason: "cpu" })],
    ["a reason in capitals", withTarget(grows, { targetSlots: 5, changedAt: TARGET_CHANGED, reason: "CPU" })],
    ["a reason of 33 characters", withTarget(grows, { changedAt: TARGET_CHANGED, reason: "a".repeat(33) })],
    ["a reason that is not text", withTarget(grows, { changedAt: TARGET_CHANGED, reason: 1 })],
    ["a held recommendation without its time", withTarget(drained, { pendingLowerSlots: 4 })],
    ["a hold time without a held recommendation", withTarget(drained, { pendingLowerSince: TARGET_HELD })],
    ["a hold time shorter than its stored form", withTarget(drained, { pendingLowerSlots: 4, pendingLowerSince: "2026-10-22 08:16:04" })],
    ["a hold time longer than its stored form", withTarget(drained, { pendingLowerSlots: 4, pendingLowerSince: `${TARGET_HELD} ` })],
    ["a hold time that is not text", withTarget(drained, { pendingLowerSlots: 4, pendingLowerSince: Date.parse(TARGET_HELD) })],
    ["a held recommendation at its target", withTarget(grows, { targetSlots: 5, pendingLowerSlots: 5, pendingLowerSince: TARGET_HELD,
        changedAt: TARGET_CHANGED, reason: "cpu" })],
    ["a held recommendation above its target", withTarget(grows, { targetSlots: 5, pendingLowerSlots: 6, pendingLowerSince: TARGET_HELD,
        changedAt: TARGET_CHANGED, reason: "cpu" })],
    ["a held recommendation at its slots without a target", withTarget(drained, { pendingLowerSlots: 5, pendingLowerSince: TARGET_HELD })],
    ["a held recommendation below floor(vCPU ÷ 2)", withTarget(drained, { pendingLowerSlots: 2, pendingLowerSince: TARGET_HELD })],
    // Regions.
    ["regions that are not a list", { ...fleet, regions: {} }],
    ["a region with an extra key", withRegion(0, { vpssNeeded: 1 })],
    ["a region without a key", { ...fleet, regions: [without(fleet.regions[0]!, "shortfallServers")] }],
    ["one region twice", { ...fleet, regions: [...fleet.regions, fleet.regions[1]] }],
    ["an empty region key", withRegion(1, { regionKey: "" })],
    ["a fractional shortfall", withRegion(0, { shortfallServers: 1.5 })],
    ["a shortfall above the servers to move", withRegion(0, { shortfallServers: 3 })],
    ["a shortfall below what the free slots leave", withRegion(0, { shortfallServers: 1 })],
    ["more servers to move than the VPSs move", withRegion(0, { serversToMove: 3, shortfallServers: 3 })],
    ["more free slots than the VPSs that accept relocations offer", withRegion(1, { freeRecommendedSlots: 38 })],
])("rejects %s", (_case, value) => {
    expect(parseSlotSizing(value)).toBeNull();
});

it.each([
    ["VPSs", (count: number) => ({ ...fleet, hosts: Array.from({ length: count }, (_, index) => ({ ...unmeasured, serviceName: `vps-${index}` })), regions: [] }), SLOT_SIZING_LIMITS.hosts],
    ["regions", (count: number) => ({ ...fleet, regions: Array.from({ length: count }, (_, index) => ({ regionKey: `region-${index}`, serversToMove: 0, freeRecommendedSlots: 0, shortfallServers: 0 })) }), SLOT_SIZING_LIMITS.regions],
    ["regions on one VPS", (count: number) => withHost(unmeasured, { regionKeys: Array.from({ length: count }, (_, index) => `region-${index}`) }), 32],
] as const)("accepts as many %s as the cap and rejects one more", (_case, build, limit) => {
    expect(parseSlotSizing(build(limit))).not.toBeNull();
    expect(parseSlotSizing(build(limit + 1))).toBeNull();
});

it("caps the lists as the fleet capacity read does", () => {
    expect(SLOT_SIZING_LIMITS).toEqual({ hosts: 256, regions: 32 });
});

it("reads the current control plane's answer to the unknown operation as not available yet", () => {
    // Exactly what control plane main answers through the Edge Function: HTTP 400 with an empty request id, as the
    // Edge Function sends no x-request-id, so the client reads the bare error.
    const body = JSON.stringify({ version: 1, requestId: "", ok: false, error: { code: "invalid_request", message: "The control plane request is invalid.", retryable: false } });
    let error: unknown = null;
    try {
        decodeControlPlaneAdminResponse(body, "11111111-1111-4111-8111-111111111111", false);
    } catch (cause) {
        error = cause;
    }
    expect(error).toBeInstanceOf(ControlPlaneAdminError);
    expect(error).toMatchObject({ code: "invalid_request", message: "The control plane request is invalid.", retryable: false });
    expect(slotSizingUnavailable(error)).toBe(true);
    expect(slotSizingUnavailable(new ControlPlaneAdminError("unsupported_operation", "Unsupported."))).toBe(true);
    // Anything else is a failure to show, not the missing operation.
    for (const other of [new ControlPlaneAdminError("rate_limited", "Too many.", true), new ControlPlaneAdminError("slot_sizing_unavailable", "Slot sizing needs an enabled VPS provider."),
        new ControlPlaneAdminError("control_plane_unavailable", "The control plane could not be reached.", true), new Error("boom"), null]) {
        expect(slotSizingUnavailable(other)).toBe(false);
    }
});

it("explains a failed read, including the rate limit", () => {
    expect(slotSizingErrorMessage(new ControlPlaneAdminError("rate_limited", "Slot sizing is being requested too frequently.", true)))
        .toBe("You can read slot sizing six times every five minutes. Wait a few minutes, then refresh.");
    expect(slotSizingErrorMessage(new ControlPlaneAdminError("slot_sizing_unavailable", "Slot sizing needs an enabled VPS provider."))).toBe("Slot sizing needs an enabled VPS provider.");
    expect(slotSizingErrorMessage(new Error("Authentication is required."))).toBe("Authentication is required.");
    expect(slotSizingErrorMessage("nope")).toBe("Slot sizing could not be loaded.");
});

it("compares each recommendation with today's slots", () => {
    expect(slotSizingDifference(5, 3)).toEqual({ kind: "more", label: "+2", description: "2 more than its 3 slots now." });
    expect(slotSizingDifference(3, 5)).toEqual({ kind: "fewer", label: "−2", description: "2 fewer than its 5 slots now." });
    expect(slotSizingDifference(1, 1)).toEqual({ kind: "same", label: "same", description: "As many as its 1 slot now." });
});

it("says each reason in plain words, with the VPS's own figures", () => {
    expect(fleet.hosts.map((entry) => slotSizingReasonLabel(entry.reason))).toEqual(["CPU budget", "CPU budget", "Memory budget", "Floor", "Drain", "CPU budget", "Maximum", "CPU budget", "Unmeasured"]);
    expect(slotSizingReasonDescription(grows, model)).toBe("One more slot would break the CPU budget.");
    expect(slotSizingReasonDescription(memoryBound, model)).toBe("One more slot would break the memory budget.");
    expect(slotSizingReasonDescription(biggest, model)).toBe("32 slots, the most a VPS holds, keep both budgets.");
    expect(slotSizingFloor(7)).toBe(3);
});

it("says a floor's servers break a budget themselves when they fill it, and how many more fit when they do not", () => {
    expect(slotSizingReasonDescription(floored, model)).toBe("Its 2 servers already break the CPU and memory budgets. A VPS keeps its floor of 2 slots (floor(vCPU ÷ 2)), and this one has no more servers than that, so nothing moves.");
    expect(slotSizingReasonDescription(variant(floored, { vCpu: 3, slots: 1, occupants: 1, recommendedSlots: 1, withinCpuBudget: true }), model))
        .toBe("Its 1 server already breaks the memory budget. A VPS keeps its floor of 1 slot (floor(vCPU ÷ 2)), and this one has no more servers than that, so nothing moves.");
    expect(slotSizingReasonDescription(roomyFloor, model)).toBe("Beside its 1 server, 1 more typical server fits within the budgets. A VPS keeps its floor of 3 slots (floor(vCPU ÷ 2)) anyway; filled with typical servers, they would break the CPU budget.");
    expect(slotSizingReasonDescription(variant(roomyFloor, { occupants: 2, freeRecommendedSlots: 0 }), model))
        .toBe("Beside its 2 servers, no more typical server fits within the budgets. A VPS keeps its floor of 3 slots (floor(vCPU ÷ 2)) anyway; filled with typical servers, they would break the CPU budget.");
    expect(slotSizingReasonDescription(variant(roomyFloor, { occupants: 1, freeRecommendedSlots: 0, withinMemoryBudget: false }), model))
        .toBe("Beside its 1 server, no more typical server fits within the budgets. A VPS keeps its floor of 3 slots (floor(vCPU ÷ 2)) anyway; filled with typical servers, they would break the CPU and memory budgets.");
    expect(slotSizingReasonDescription(variant(roomyFloor, { occupants: 0, freeRecommendedSlots: 2 }), model))
        .toBe("2 typical servers fit within the budgets. A VPS keeps its floor of 3 slots (floor(vCPU ÷ 2)) anyway; filled with typical servers, they would break the CPU budget.");
    expect(slotSizingReasonDescription(variant(roomyFloor, { occupants: 0, freeRecommendedSlots: 1, withinCpuBudget: true, withinMemoryBudget: false }), model))
        .toBe("1 typical server fits within the budgets. A VPS keeps its floor of 3 slots (floor(vCPU ÷ 2)) anyway; filled with typical servers, they would break the memory budget.");
    expect(slotSizingReasonDescription(variant(roomyFloor, { occupants: 0, freeRecommendedSlots: 0 }), model))
        .toBe("Not even one typical server fits within the budgets. A VPS keeps its floor of 3 slots (floor(vCPU ÷ 2)) anyway; filled with typical servers, they would break the CPU budget.");
});

it("says how a drain ends: above its floor keeping both budgets, or at it keeping or still breaking one", () => {
    expect(slotSizingReasonDescription(drainedAbove, model)).toBe("Its 7 servers alone break a budget, so 2 would move, and the 5 that stay keep both budgets.");
    expect(slotSizingReasonDescription(drained, model)).toBe("Its 5 servers alone break a budget, so 2 would move, down to its floor of 3 slots (floor(vCPU ÷ 2)), where the 3 that stay keep both budgets.");
    expect(slotSizingReasonDescription(variant(drained, { expectedShortageCoreHoursPerWeek: 218.4, withinCpuBudget: false }), model))
        .toBe("Its 5 servers alone break a budget, so 2 would move, down to its floor of 3 slots (floor(vCPU ÷ 2)), where the 3 that stay still break the CPU budget.");
    const single = { ...drained, vCpu: 2, slots: 2, occupants: 2, serversToMove: 1, recommendedSlots: 1 };
    expect(slotSizingReasonDescription(single, model)).toBe("Its 2 servers alone break a budget, so 1 would move, down to its floor of 1 slot (floor(vCPU ÷ 2)), where the 1 that stays keeps both budgets.");
    expect(slotSizingReasonDescription(variant(single, { withinMemoryBudget: false }), model))
        .toBe("Its 2 servers alone break a budget, so 1 would move, down to its floor of 1 slot (floor(vCPU ÷ 2)), where the 1 that stays still breaks the memory budget.");
});

it("names the usable figure an unmeasured VPS is missing", () => {
    expect(slotSizingReasonDescription(unmeasured, model)).toBe("Its usable cores and memory are neither measured nor borrowable, so there is no recommendation.");
    expect(slotSizingReasonDescription(variant(unmeasured, { usableCores: 1.5, coresSource: "measured" }), model)).toBe("Its usable memory is neither measured nor borrowable, so there is no recommendation.");
    expect(slotSizingReasonDescription(variant(unmeasured, { usableMemoryBytes: GIB, memorySource: "type" }), model)).toBe("Its usable cores are neither measured nor borrowable, so there is no recommendation.");
});

it("names each usable figure's source, the figures it knows, providers and figures as people read them", () => {
    expect([grows, borrowed, onboarding, unmeasured].map(slotSizingCapacitySources)).toEqual([
        "Cores and memory measured", "Cores and memory borrowed (type)", "Cores and memory borrowed (provider and vCPU)", "Cores and memory unknown",
    ]);
    expect(slotSizingCapacitySources({ ...grows, memorySource: "type" })).toBe("Cores measured · memory borrowed (type)");
    expect(slotSizingCapacitySources({ coresSource: "provider-vcpu", memorySource: "measured" })).toBe("Cores borrowed (provider and vCPU) · memory measured");
    expect([grows, borrowed, onboarding].map(slotSizingCapacityFigures)).toEqual([
        "5.580 cores, 10.90 GiB usable", "7.200 cores, 14.00 GiB usable", "5.512 cores, 10.50 GiB usable",
    ]);
    expect(slotSizingCapacityFigures(unmeasured)).toBeNull();
    // An unmeasured VPS shows the figure it knows, and its sources name the one it is missing.
    const coresOnly = { ...unmeasured, usableCores: 1.5, coresSource: "measured" } as const;
    expect([slotSizingCapacitySources(coresOnly), slotSizingCapacityFigures(coresOnly)]).toEqual(["Cores measured · memory unknown", "1.500 cores usable"]);
    const memoryOnly = { ...unmeasured, usableMemoryBytes: GIB, memorySource: "provider-vcpu" } as const;
    expect([slotSizingCapacitySources(memoryOnly), slotSizingCapacityFigures(memoryOnly)]).toEqual(["Cores unknown · memory borrowed (provider and vCPU)", "1.00 GiB usable"]);
    expect(["ovhcloud-vps", "contabo-vps", "hosthatch-vps", "hetzner-cloud"].map(slotSizingProviderLabel)).toEqual(["OVHcloud", "Contabo", "HostHatch", "hetzner-cloud"]);
    expect(formatCoreHours(0.072)).toBe("0.072 core-h");
    expect(formatCoreHours(0)).toBe("0.000 core-h");
    expect(formatOverflowShare(0.0087)).toBe("0.87%");
    expect(formatOverflowShare(0.0412)).toBe("4.12%");
    expect(formatOverflowShare(0)).toBe("0.00%");
});

it("marks a budget over from the control plane's flags, not from the rounded figures", () => {
    expect(slotSizingOverBudget(floored)).toEqual({ cpu: true, memory: true });
    expect(slotSizingOverBudget(roomyFloor)).toEqual({ cpu: true, memory: false });
    expect(slotSizingOverBudget(grows)).toEqual({ cpu: false, memory: false });
    // The same rounded figures at the budget are over it or not as the flags say.
    expect(slotSizingOverBudget(variant(grows, { expectedShortageCoreHoursPerWeek: 1, memoryOverflowShare: 0.01 }))).toEqual({ cpu: false, memory: false });
    expect(slotSizingOverBudget(variant(floored, { expectedShortageCoreHoursPerWeek: 1, memoryOverflowShare: 0.01, withinMemoryBudget: true }))).toEqual({ cpu: true, memory: false });
    expect(slotSizingOverBudget(unmeasured)).toEqual({ cpu: false, memory: false });
});

it("groups VPSs by provider then region, without a region last, keeping the read's order within", () => {
    const groups = slotSizingHostGroups([...fleet.hosts, { ...unmeasured, serviceName: "vps-nowhere", regionKeys: [] }]);
    expect(groups.map((group) => [group.label, group.hosts.map((entry) => entry.serviceName)])).toEqual([
        ["Contabo · Germany", ["vmi654321.contaboserver.net"]],
        ["OVHcloud · France", ["vps-fr-big.vps.ovh.net"]],
        ["OVHcloud · Germany", ["vps-de-part.vps.ovh.net", "vps-de-always.vps.ovh.net"]],
        ["OVHcloud · Poland", ["vps-pl-steal.vps.ovh.net"]],
        ["OVHcloud · Singapore", ["vps-sg-spare.vps.ovh.net"]],
        ["OVHcloud · United Kingdom", ["vps-uk-mem.vps.ovh.net"]],
        ["OVHcloud · US-East", ["vps-us-busy.vps.ovh.net", "vps-us-new.vps.ovh.net"]],
        ["OVHcloud · No region", ["vps-nowhere"]],
    ]);
});

it("states the budgets, the typical server and a failed capacity read from the model", () => {
    expect(slotSizingBudgets(model)).toBe("Each VPS gets the most slots, from floor(vCPU ÷ 2) to 32, at which its servers now plus typical new servers in the rest keep two budgets: at most 1 core-hour a week of expected CPU shortage, and more servers online at once than its memory holds in under 1% of the week.");
    expect(slotSizingBudgets({ ...model, cpuShortageBudgetCoreHoursPerWeek: 0.5, memoryOverflowShare: 0.025 })).toContain("at most 0.5 core-hours a week of expected CPU shortage, and more servers online at once than its memory holds in under 2.5% of the week.");
    expect(slotSizingTypicalServer(fleet.model)).toBe("A typical new server needs 1.6 vCPU and 2.5 GiB while online and is online 41.37 hours a week, the mean of servers' weeks over the last 28 days (14-day half-life). A server observed for under 7 days counts with that typical week.");
    expect(slotSizingCapacityNote(model)).toBeNull();
    expect(slotSizingCapacityNote({ capacityErrorCode: "fleet_capacity_history_unavailable" })).toBe("Capacity samples could not be read (fleet_capacity_history_unavailable), so no VPS's usable cores or memory are known: every VPS is unmeasured and has no recommendation.");
});

it("explains each column as the control plane computes it", () => {
    const hints = slotSizingHints(model);
    expect(hints.recommended).toContain("the most, from floor(vCPU ÷ 2) to 32, at which the servers on it now plus typical new servers in the other slots keep both budgets (at most 1 core-hour a week of expected CPU shortage, and more online at once than its memory holds in under 1% of the week)");
    expect(hints.recommended).toContain("one observed for under 7 days counts with the typical week, and one without a measured need at 1.6 vCPU");
    expect(hints.recommended).toContain("Nothing applies it.");
    expect(hints.reason).toContain("Floor: the most slots that keep both budgets, if any, is below floor(vCPU ÷ 2), but a VPS always keeps that many, so at least one budget breaks there");
    expect(hints.reason).toContain("Drain: its servers alone break a budget and are more than the floor");
    expect(hints.reason).toContain("down to the floor, where they may still break one");
    expect(hints.reason).toContain("Unmeasured: its usable cores or memory are neither measured nor borrowable");
    expect(hints.shortage).toContain("summed over the week's half-hours");
    expect(hints.shortage).toContain("The budget is 1 core-hour. Over budget marks where the control plane says the exact figure breaks it, which the rounded figure cannot show at the edge; only Drain and Floor can be.");
    expect(hints.overflow).toContain("floor(usable memory ÷ memory per server). The budget is under 1%. Over budget marks where the control plane says the exact share reaches it");
    expect(hints.free).toContain("0 for Drain and Unmeasured");
    expect(hints.capacity).toContain("borrowed (provider and vCPU), the median of the measured VPSs of its provider and vCPU count");
    expect(hints.capacity).toContain("unknown, nothing to measure or borrow, which leaves the VPS Unmeasured. Each is borrowed on its own.");
    expect(hints.capacity).toContain("2.5 GiB of memory on it, or its servers' measured peak where higher");
    expect(hints.shortfall).toContain("the read does not say how many");
    // No hint names a raw provider id.
    for (const hint of Object.values(hints)) expect(hint).not.toMatch(/ovhcloud-vps|contabo-vps|hosthatch-vps/u);
});

// A control plane that fits on typical demand (#550) adds the typical new server's CPU to the model, and nothing else.
const typicalFleet: HostingAdminSlotSizing = { ...fleet, model: { ...fleet.model, typicalServerCpuCores: 1.6 } };

it("accepts the typical new server's CPU from a control plane that fits on typical demand, and describes the server with it", () => {
    expect(parseSlotSizing(typicalFleet)).toBe(typicalFleet);
    expect(parseSlotSizing(withModel({ typicalServerCpuCores: 1.8 }))).not.toBeNull();
    // A capacity read that fails with the control plane's new history error names it, as every capacity error does.
    expect(slotSizingCapacityNote({ capacityErrorCode: "fleet_capacity_history_invalid" })).toBe("Capacity samples could not be read (fleet_capacity_history_invalid), so no VPS's usable cores or memory are known: every VPS is unmeasured and has no recommendation.");
    const typicalModel = parseSlotSizing(typicalFleet)!.model;
    expect(slotSizingTypicalServer(typicalModel)).toBe("A typical new server needs 1.600 cores and 2.5 GiB while online: what servers usually need, the 1.6 vCPU target or the fleet's p95 CPU where higher, at most 2 vCPU (the target before the fleet has data). It is online 41.37 hours a week, the mean of servers' weeks over the last 28 days (14-day half-life). A server observed for under 7 days counts with that typical week.");
    const hints = slotSizingHints(typicalModel);
    expect(hints.recommended).toContain("one observed for under 7 days counts with the typical week, and one without a measured need at the typical 1.600 cores.");
    expect(hints.capacity).toContain("Each online server is planned to need 2.5 GiB of memory on it, or its servers' measured peak where higher, at most 3 GiB.");
    // The current control plane's copy is as it was.
    const current = slotSizingHints(parseSlotSizing(fleet)!.model);
    expect(current.recommended).toContain("and one without a measured need at 1.6 vCPU.");
    expect(current.capacity).toContain("or its servers' measured peak where higher.");
    expect(slotSizingTypicalServer(parseSlotSizing(fleet)!.model)).toMatch(/^A typical new server needs 1\.6 vCPU and 2\.5 GiB while online/u);
});

it.each([
    ["zero", { typicalServerCpuCores: 0 }],
    ["negative", { typicalServerCpuCores: -1.6 }],
    ["given as text", { typicalServerCpuCores: "1.6" }],
    ["null", { typicalServerCpuCores: null }],
    ["above 256 vCPU", { typicalServerCpuCores: 257 }],
    ["beside another new key", { typicalServerCpuCores: 1.6, typicalServerMemoryBytes: BURST }],
])("rejects a typical new server's CPU %s", (_case, change) => {
    expect(parseSlotSizing(withModel(change))).toBeNull();
});
