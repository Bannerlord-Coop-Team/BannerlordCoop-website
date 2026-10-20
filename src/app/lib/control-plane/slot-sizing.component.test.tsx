import { expect, it } from "vitest";
import { ControlPlaneAdminError, decodeControlPlaneAdminResponse } from "./client";
import {
    formatCoreHours,
    formatOverflowShare,
    parseSlotSizing,
    SLOT_SIZING_LIMITS,
    slotSizingBudgets,
    slotSizingCapacityLabel,
    slotSizingCapacityNote,
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
import type { HostingAdminSlotSizing, HostingSlotSizingHost } from "./types";

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

/**
 * The control plane's documented example (`docs/managed-hosting/web-admin.md`, "Slot sizing"), from its PGlite test
 * fixture. The page elides `vps-new` and `vps-small`; they are filled in from its descriptions and the control plane's
 * test of the same fleet: `vps-new` borrows `vps-b`'s 4 cores and 12 GiB (provider-vcpu) and is recommended 2 slots
 * (cpu, 2 free), and `vps-small` has nothing to borrow.
 */
const example: HostingAdminSlotSizing = {
    generatedAt: "2026-10-17T00:20:00.000Z",
    model,
    hosts: [
        { serviceName: "vps-a", provider: "ovhcloud-vps", regionKeys: ["poland"], vCpu: 6, slots: 4,
            occupants: 4, acceptsRelocations: true, usableCores: 5.8, usableMemoryBytes: 12884901888,
            capacitySource: "measured", memoryBytesPerServer: 2684354560, recommendedSlots: 5, reason: "cpu",
            expectedShortageCoreHoursPerWeek: 0.072, memoryOverflowShare: 0, serversToMove: 0,
            freeRecommendedSlots: 1 },
        { serviceName: "vps-b", provider: "ovhcloud-vps", regionKeys: ["poland"], vCpu: 4, slots: 4,
            occupants: 4, acceptsRelocations: true, usableCores: 4, usableMemoryBytes: 12884901888,
            capacitySource: "measured", memoryBytesPerServer: 2684354560, recommendedSlots: 2, reason: "drain",
            expectedShortageCoreHoursPerWeek: 0, memoryOverflowShare: 0, serversToMove: 2,
            freeRecommendedSlots: 0 },
        { serviceName: "vps-new", provider: "ovhcloud-vps", regionKeys: ["poland"], vCpu: 4, slots: 2,
            occupants: 0, acceptsRelocations: true, usableCores: 4, usableMemoryBytes: 12884901888,
            capacitySource: "provider-vcpu", memoryBytesPerServer: 2684354560, recommendedSlots: 2, reason: "cpu",
            expectedShortageCoreHoursPerWeek: 0, memoryOverflowShare: 0, serversToMove: 0,
            freeRecommendedSlots: 2 },
        { serviceName: "vps-small", provider: "ovhcloud-vps", regionKeys: ["poland"], vCpu: 2, slots: 1,
            occupants: 0, acceptsRelocations: true, usableCores: null, usableMemoryBytes: null,
            capacitySource: "none", memoryBytesPerServer: 2684354560, recommendedSlots: null, reason: "unmeasured",
            expectedShortageCoreHoursPerWeek: null, memoryOverflowShare: null, serversToMove: 0,
            freeRecommendedSlots: 0 },
    ],
    regions: [{ regionKey: "poland", serversToMove: 2, freeRecommendedSlots: 3, shortfallServers: 0 }],
};

const ovh = { provider: "ovhcloud-vps", acceptsRelocations: true, memoryBytesPerServer: BURST, serversToMove: 0 } as const;
// Grows: three part-time owners, rarely online together.
const grows: HostingSlotSizingHost = { ...ovh, serviceName: "vps-de-part.vps.ovh.net", regionKeys: ["germany"], vCpu: 6, slots: 3, occupants: 3,
    usableCores: 5.58, usableMemoryBytes: 11_703_786_240, capacitySource: "measured", recommendedSlots: 5, reason: "cpu",
    expectedShortageCoreHoursPerWeek: 0.842, memoryOverflowShare: 0.0021, freeRecommendedSlots: 2 };
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
    memoryOverflowShare: 0.0412, freeRecommendedSlots: 0 };
// Raised to five slots, its five always-on servers want twice its cores: two would move.
const drained: HostingSlotSizingHost = { ...grows, serviceName: "vps-us-busy.vps.ovh.net", regionKeys: ["us-east"], slots: 5, occupants: 5,
    usableCores: 5.5, usableMemoryBytes: 11_274_289_152, recommendedSlots: 3, reason: "drain", expectedShortageCoreHoursPerWeek: 0.95,
    memoryOverflowShare: 0.0003, serversToMove: 2, freeRecommendedSlots: 0 };
// Never used, it borrows its instance type's capacity.
const borrowed: HostingSlotSizingHost = { ...grows, serviceName: "vmi654321.contaboserver.net", provider: "contabo-vps", vCpu: 8, slots: 4, occupants: 0,
    usableCores: 7.2, usableMemoryBytes: 14 * GIB, capacitySource: "type", recommendedSlots: 6, expectedShortageCoreHoursPerWeek: 0.677,
    memoryOverflowShare: 0.0011, freeRecommendedSlots: 6 };
// A large VPS whose servers' peak working set is above the target: 32 slots keep both budgets.
const biggest: HostingSlotSizingHost = { ...grows, serviceName: "vps-fr-big.vps.ovh.net", regionKeys: ["france"], vCpu: 24, slots: 12, occupants: 6,
    usableCores: 22.5, usableMemoryBytes: 62 * GIB, memoryBytesPerServer: 2_899_102_924, recommendedSlots: 32, reason: "maximum",
    expectedShortageCoreHoursPerWeek: 0.218, memoryOverflowShare: 0, freeRecommendedSlots: 26 };
// Not onboarded yet, so its free slots are not offered to its region.
const onboarding: HostingSlotSizingHost = { ...grows, serviceName: "vps-us-new.vps.ovh.net", regionKeys: ["us-east"], occupants: 0, acceptsRelocations: false,
    usableCores: 5.512, usableMemoryBytes: 11_274_289_152, capacitySource: "provider-vcpu", recommendedSlots: 4, expectedShortageCoreHoursPerWeek: 0.6,
    memoryOverflowShare: 0.0004, freeRecommendedSlots: 4 };
const unmeasured: HostingSlotSizingHost = { ...ovh, serviceName: "vps-sg-spare.vps.ovh.net", regionKeys: ["singapore"], vCpu: 2, slots: 1, occupants: 0,
    usableCores: null, usableMemoryBytes: null, capacitySource: "none", recommendedSlots: null, reason: "unmeasured",
    expectedShortageCoreHoursPerWeek: null, memoryOverflowShare: null, freeRecommendedSlots: 0 };
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

function withModel(change: Record<string, unknown>) {
    return { ...fleet, model: { ...fleet.model, ...change } };
}

function withRegion(index: number, change: Record<string, unknown>) {
    return { ...fleet, regions: fleet.regions.map((candidate, at) => at === index ? { ...candidate, ...change } : candidate) };
}

it("accepts the control plane's documented example exactly as it is", () => {
    expect(parseSlotSizing(example)).toBe(example);
});

it("accepts a realistic fleet with every reason", () => {
    expect(parseSlotSizing(fleet)).toBe(fleet);
    expect(new Set(fleet.hosts.map((entry) => entry.reason))).toEqual(new Set(["cpu", "memory", "floor", "maximum", "drain", "unmeasured"]));
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
    // Floor and drain at its floor can be over a budget; within budget sits at it once rounded.
    expect(parseSlotSizing(withHost(drained, { expectedShortageCoreHoursPerWeek: 2.5, memoryOverflowShare: 0.2 }))).not.toBeNull();
    expect(parseSlotSizing(withHost(grows, { expectedShortageCoreHoursPerWeek: 1, memoryOverflowShare: 0.01 }))).not.toBeNull();
    // Floor with free slots the budgets allow under it, and the maximum on a small VPS whose servers are rarely online.
    expect(parseSlotSizing(withHost(floored, { occupants: 0, freeRecommendedSlots: 1 }))).not.toBeNull();
    expect(parseSlotSizing(withHost(full, { reason: "maximum", recommendedSlots: 32, freeRecommendedSlots: 29 }))).not.toBeNull();
    // Figures carry floating-point noise from their rounding; a typical server online every hour of the week.
    expect(parseSlotSizing(withHost(grows, { expectedShortageCoreHoursPerWeek: 0.1 + 0.2, usableCores: 0.1 * 3 }))).not.toBeNull();
    expect(parseSlotSizing(withModel({ typicalWeeklyOnlineHours: 168 }))).not.toBeNull();
    // Usable capacity clamped at zero still sizes; a VPS with one side unknown is unmeasured.
    expect(parseSlotSizing(withHost(floored, { usableCores: 0, usableMemoryBytes: 0 }))).not.toBeNull();
    expect(parseSlotSizing(withHost(unmeasured, { usableCores: 1.5 }))).not.toBeNull();
    expect(parseSlotSizing(withHost(unmeasured, { usableMemoryBytes: GIB }))).not.toBeNull();
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
    ["more servers than any VPS holds", withHost(biggest, { occupants: 33, recommendedSlots: 32, freeRecommendedSlots: 0 })],
    ["whether it accepts relocations as text", withHost(grows, { acceptsRelocations: "yes" })],
    ["usable cores with four decimals", withHost(grows, { usableCores: 5.5801 })],
    ["negative usable cores", withHost(grows, { usableCores: -0.5 })],
    ["fractional usable memory", withHost(grows, { usableMemoryBytes: 11_703_786_240.5 })],
    ["an unknown capacity source", withHost(grows, { capacitySource: "fleet" })],
    ["memory per server under the burst target", withHost(grows, { memoryBytesPerServer: BURST - 1 })],
    ["an unknown reason", withHost(grows, { reason: "steal" })],
    // Unmeasured exactly when usable cores or memory are unknown, with the source none and nothing else.
    ["an unmeasured VPS with usable cores and memory", withHost(unmeasured, { usableCores: 1.5, usableMemoryBytes: GIB })],
    ["a sized VPS without usable cores", withHost(grows, { usableCores: null })],
    ["a sized VPS with the source none", withHost(grows, { capacitySource: "none" })],
    ["an unmeasured VPS with a measured source", withHost(unmeasured, { capacitySource: "measured" })],
    ["an unmeasured VPS with a recommendation", withHost(unmeasured, { recommendedSlots: 1 })],
    ["an unmeasured VPS with a shortage", withHost(unmeasured, { expectedShortageCoreHoursPerWeek: 0 })],
    ["an unmeasured VPS with a memory overflow", withHost(unmeasured, { memoryOverflowShare: 0 })],
    ["an unmeasured VPS with free slots", withHost(unmeasured, { freeRecommendedSlots: 1 })],
    ["an unmeasured VPS with servers to move", withHost(unmeasured, { occupants: 1, serversToMove: 1 })],
    ["a sized VPS without a recommendation", withHost(grows, { recommendedSlots: null })],
    ["a sized VPS without a shortage", withHost(grows, { expectedShortageCoreHoursPerWeek: null })],
    ["a sized VPS without a memory overflow", withHost(grows, { memoryOverflowShare: null })],
    // Within floor(vCPU ÷ 2) to the maximum.
    ["a recommendation below the floor", withHost(memoryBound, { recommendedSlots: 2, freeRecommendedSlots: 1 })],
    ["a recommendation above the maximum", withHost(biggest, { recommendedSlots: 33, freeRecommendedSlots: 27 })],
    // Its floor, floor(66 ÷ 2), is above the maximum: only the range rejects it.
    ["a floor above the maximum", withHost(floored, { vCpu: 66, recommendedSlots: 33 })],
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
    // Floor recommends floor(vCPU ÷ 2), with no more free slots than it leaves.
    ["a floor above floor(vCPU ÷ 2)", withHost(floored, { recommendedSlots: 3 })],
    ["a floor with more free slots than it leaves", withHost(floored, { freeRecommendedSlots: 1 })],
    ["a floor below its servers", withHost(floored, { occupants: 3 })],
    // CPU, memory and maximum keep both budgets, and offer every slot beyond their servers.
    ["a CPU reason over the CPU budget", withHost(grows, { expectedShortageCoreHoursPerWeek: 1.001 })],
    ["a memory reason over the memory budget", withHost(memoryBound, { memoryOverflowShare: 0.0101 })],
    ["a maximum over the CPU budget", withHost(biggest, { expectedShortageCoreHoursPerWeek: 1.2 })],
    ["a CPU reason with fewer free slots than it has", withHost(grows, { freeRecommendedSlots: 1 })],
    ["a CPU reason with more free slots than it has", withHost(grows, { freeRecommendedSlots: 3 })],
    ["a CPU reason at the maximum", withHost(biggest, { reason: "cpu" })],
    ["a maximum below the maximum", withHost(grows, { reason: "maximum" })],
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
    expect(slotSizingReasonDescription(floored, model)).toBe("The budgets allow fewer slots, but a VPS always keeps floor(vCPU ÷ 2): 2 here.");
    expect(slotSizingReasonDescription(biggest, model)).toBe("32 slots, the most a VPS holds, keep both budgets.");
    expect(slotSizingReasonDescription(drained, model)).toBe("Its 5 servers alone break a budget, so 2 would move.");
    expect(slotSizingReasonDescription({ ...drained, occupants: 1, serversToMove: 1 }, model)).toBe("Its 1 server alone breaks a budget, so 1 would move.");
    expect(slotSizingReasonDescription(unmeasured, model)).toBe("No usable cores or memory are measured or borrowable, so there is no recommendation.");
    expect(slotSizingFloor(7)).toBe(3);
});

it("names capacity sources, providers and figures as people read them", () => {
    expect(slotSizingCapacityLabel(grows)).toBe("Measured · 5.580 cores, 10.90 GiB usable");
    expect(slotSizingCapacityLabel(borrowed)).toBe("Borrowed by type · 7.200 cores, 14.00 GiB usable");
    expect(slotSizingCapacityLabel(onboarding)).toBe("Borrowed by provider and vCPU · 5.512 cores, 10.50 GiB usable");
    expect(slotSizingCapacityLabel(unmeasured)).toBe("None");
    expect(slotSizingCapacityLabel({ ...unmeasured, usableCores: 1.5 })).toBe("None");
    expect(["ovhcloud-vps", "contabo-vps", "hosthatch-vps", "hetzner-cloud"].map(slotSizingProviderLabel)).toEqual(["OVHcloud", "Contabo", "HostHatch", "hetzner-cloud"]);
    expect(formatCoreHours(0.072)).toBe("0.072 core-h");
    expect(formatCoreHours(0)).toBe("0.000 core-h");
    expect(formatOverflowShare(0.0087)).toBe("0.87%");
    expect(formatOverflowShare(0.0412)).toBe("4.12%");
    expect(formatOverflowShare(0)).toBe("0.00%");
});

it("marks a figure above its budget, which only floor and drain can be", () => {
    expect(slotSizingOverBudget(floored, model)).toEqual({ cpu: true, memory: true });
    expect(slotSizingOverBudget(grows, model)).toEqual({ cpu: false, memory: false });
    // At the budget, as rounded, is not over it.
    expect(slotSizingOverBudget({ ...grows, expectedShortageCoreHoursPerWeek: 1, memoryOverflowShare: 0.01 }, model)).toEqual({ cpu: false, memory: false });
    expect(slotSizingOverBudget(unmeasured, model)).toEqual({ cpu: false, memory: false });
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
    expect(hints.reason).toContain("Drain: its servers alone break a budget");
    expect(hints.shortage).toContain("summed over the week's half-hours");
    expect(hints.shortage).toContain("The budget is 1 core-hour; only Drain and Floor can be above it.");
    expect(hints.overflow).toContain("floor(usable memory ÷ memory per server). The budget is under 1%");
    expect(hints.free).toContain("0 for Drain and Unmeasured");
    expect(hints.capacity).toContain("Borrowed by provider and vCPU, the median of the measured VPSs of its provider and vCPU count");
    expect(hints.capacity).toContain("2.5 GiB of memory on it, or its servers' measured peak where higher");
    expect(hints.shortfall).toContain("the read does not say how many");
    // No hint names a raw provider id.
    for (const hint of Object.values(hints)) expect(hint).not.toMatch(/ovhcloud-vps|contabo-vps|hosthatch-vps/u);
});
