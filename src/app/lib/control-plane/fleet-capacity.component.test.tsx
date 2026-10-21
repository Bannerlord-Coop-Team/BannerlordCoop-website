import { expect, it } from "vitest";
import { ControlPlaneAdminError } from "./client";
import {
    burstBytes,
    burstCores,
    burstHeadroomLabel,
    capacityAtOnceSummary,
    capacityVerdict,
    effectiveVcpuLabel,
    fitCores,
    fleetCapacityTypical,
    stealFigures,
    busyBand,
    capacityHourLabel,
    capacityWindowLabel,
    decodeHourly,
    fleetCapacityDataNote,
    fleetCapacityDataState,
    fleetCapacityErrorMessage,
    fleetCapacityHostGroups,
    FLEET_CAPACITY_LIMITS,
    FLEET_CAPACITY_PROVIDERS,
    fleetCapacityProviderLabel,
    fleetCapacityTypeLabel,
    formatCoresExact,
    formatGiB,
    fleetCapacityHints,
    fleetCapacityHostNote,
    formatPercent,
    hostMetricsMissing,
    knownMhz,
    modelledVerdict,
    occupantDemandLabel,
    parseFleetCapacity,
    perServerSourceLabel,
    staticRuleComparison,
    staticSlots,
    stealBand,
} from "./fleet-capacity";

/** A copy of a record without one key. */
function without<T extends object>(value: T, key: keyof T) {
    const copy = { ...value };
    delete copy[key];
    return copy;
}

const GIB = 1024 ** 3;
const week = <T,>(value: (hour: number) => T) => Array.from({ length: 168 }, (_, hour) => value(hour));
/** Hourly values as the control plane encodes them: two hex digits, `--` without data. */
const hex = (values: Array<number | null>) => values.map((value) => value === null ? "--" : value.toString(16).padStart(2, "0")).join("");

/** An instance type's key: provider, vCPUs, whole GiB, CPU model and MHz rounded to 100. */
const SIX_KEY = "ovhcloud-vps|6|12|Intel Core Processor (Haswell, no TSX)|2400";
const demand = {
    runningServerHours: 412.5, samples: 4950,
    cpuCores: { p50: 0.85, p90: 1.1, p95: 1.2, p99: 1.6, max: 1.95 },
    memoryBytes: { p50: 1_503_238_553, p95: 1_932_735_283, max: 2 * GIB },
    throttledShare: 0.012, cpuPressureShare: 0.034,
};
const noDemand = { runningServerHours: 0, samples: 0, cpuCores: null, memoryBytes: null, throttledShare: null, cpuPressureShare: null };
const steal = { samples: 2016, mean: 0.4, p95: 1.2, max: 6.5 };
const busy = { samples: 2016, mean: 1.1, p95: 2.4, max: 4.8 };
const host = {
    serviceName: "vps-1a2b3c4d.vps.ovh.net", provider: "ovhcloud-vps", regionKeys: ["germany"], vCpu: 6, memoryBytes: 12 * GIB,
    cpuModel: "Intel Core Processor (Haswell, no TSX)", cpuMhz: 2399.996, instanceTypeKey: SIX_KEY, slots: 3,
    occupants: [{ serverId: "22222222-2222-4222-8222-222222222222", displayName: "Calradia Company", demand }],
    steal, busyCores: busy, cpuPressureShare: 0.02, overheadCores: 0.35, overheadMemoryBytes: 1_181_116_006,
    usableCores: 5.58, usableMemoryBytes: 11_703_786_240, stableCpuCores: 0.85, peakCpuCores: 1.95, demandCpuCores: 1.95,
    demandMemoryBytes: 1_932_735_283, demandSource: "vps", modelledServers: 2, limitedBy: "cpu", samples: 2016,
    stealHourly: hex(week((hour) => hour < 2 ? null : hour === 68 ? 255 : 4)),
    busyHourly: hex(week((hour) => hour < 2 ? null : 30)),
};
const spare = {
    ...host, serviceName: "vps-spare", regionKeys: [], memoryBytes: null, cpuModel: null, cpuMhz: null, instanceTypeKey: null, occupants: [],
    steal: null, busyCores: null, cpuPressureShare: null, overheadCores: null, overheadMemoryBytes: null, usableCores: null, usableMemoryBytes: null,
    stableCpuCores: null, peakCpuCores: null, demandCpuCores: null, demandMemoryBytes: null, demandSource: "none", modelledServers: null,
    limitedBy: null, samples: 0,
    stealHourly: "--".repeat(168), busyHourly: "--".repeat(168),
};
const instanceType = {
    key: SIX_KEY, provider: "ovhcloud-vps" as const, vCpu: 6, memoryBytes: 12 * GIB, cpuModel: "Intel Core Processor (Haswell, no TSX)", cpuMhz: 2399.996,
    hosts: 1, servers: 1, demand, steal, modelledServers: 2, demandSource: "type",
};
const provider = { provider: "ovhcloud-vps", hosts: 2, servers: 1, demand, steal, busyCores: busy };
// The current control plane's model: a CPU burst target, and memory planned at its percentile.
const model = { cpuPercentile: 50, cpuBurstVcpu: 1.6, memoryPercentile: 95, minimumRunningHours: 6, staticBurstVcpuPerServer: 2, staticBurstMemoryBytesPerServer: 3 * GIB };
const capacity = {
    generatedAt: "2026-10-19T00:07:31.552Z", windowStartedAt: "2026-10-12T00:00:00.000Z", windowEndedAt: "2026-10-19T00:00:00.000Z", hours: 168,
    model, fleet: { hosts: 2, servers: 1, demand }, providers: [provider], instanceTypes: [instanceType], hosts: [host, spare],
};
/** A read in the current control plane's shape as parsed: without a memory burst target, so it and every peak memory are null. */
const asParsed = <T extends { model: object; hosts: object[] }>(read: T) =>
    ({ ...read, model: { ...read.model, memoryBurstBytes: null }, hosts: read.hosts.map((entry) => ({ ...entry, peakMemoryBytes: null })) });

// The next control plane's: every online server is planned to burst to 2.5 GiB too, or its peak where higher. The
// VPS's servers peaked at 2 GiB, under the target, which it plans.
const memoryModel = { ...model, memoryBurstBytes: 2.5 * GIB };
const memoryHost = { ...host, peakMemoryBytes: 2 * GIB, demandMemoryBytes: 2.5 * GIB };
const memorySpare = { ...spare, peakMemoryBytes: null };
const memoryCapacity = { ...capacity, model: memoryModel, hosts: [memoryHost, memorySpare] };
const withMemoryHost = (changes: Record<string, unknown>) => ({ ...memoryCapacity, hosts: [{ ...memoryHost, ...changes }] });
// The first read after the backend deploys: nothing measured yet, every figure null.
const blank = {
    ...capacity, fleet: { hosts: 1, servers: 0, demand: noDemand },
    providers: [{ ...provider, hosts: 1, servers: 0, demand: noDemand, steal: null, busyCores: null }],
    instanceTypes: [{ ...instanceType, demand: noDemand, steal: null, modelledServers: null, demandSource: "none" }],
    hosts: [spare],
};

const withHost = (changes: Record<string, unknown>) => ({ ...capacity, hosts: [{ ...host, ...changes }] });
const withDemand = (changes: Record<string, unknown>) => ({ ...capacity, fleet: { ...capacity.fleet, demand: { ...demand, ...changes } } });

it("accepts the current control plane's fleet-capacity read, with its memory burst target and peak memory null", () => {
    expect(parseFleetCapacity(capacity)).toEqual(asParsed(capacity));
    expect(parseFleetCapacity({ ...capacity, providers: [], instanceTypes: [], hosts: [] })).not.toBeNull();
    // Without a memory burst target nothing ties the planned memory to a peak: it is the source's p95.
    expect(parseFleetCapacity(capacity)!.hosts[0]!.demandMemoryBytes).toBe(demand.memoryBytes.p95);
});

it("accepts the next control plane's read, with a memory burst target, exactly as it is", () => {
    expect(parseFleetCapacity(memoryCapacity)).toBe(memoryCapacity);
    // A peak above the target is what is planned, and one at the target plans the target.
    expect(parseFleetCapacity(withMemoryHost({ peakMemoryBytes: 2.75 * GIB, demandMemoryBytes: 2.75 * GIB }))).not.toBeNull();
    expect(parseFleetCapacity(withMemoryHost({ peakMemoryBytes: 2.5 * GIB, demandMemoryBytes: 2.5 * GIB }))).not.toBeNull();
    expect(parseFleetCapacity(withMemoryHost({ peakMemoryBytes: 0, demandMemoryBytes: 2.5 * GIB }))).not.toBeNull();
    // The largest target the read accepts.
    expect(parseFleetCapacity({ ...memoryCapacity, model: { ...memoryModel, memoryBurstBytes: 64 * GIB }, hosts: [{ ...memoryHost, demandMemoryBytes: 64 * GIB }] })).not.toBeNull();
    expect(burstBytes(2 * GIB, 2.5 * GIB)).toBe(2.5 * GIB);
    expect(burstBytes(2.75 * GIB, 2.5 * GIB)).toBe(2.75 * GIB);
});

it("accepts the sparse first read, with every figure null", () => {
    expect(parseFleetCapacity(blank)).toEqual(asParsed(blank));
    expect(parseFleetCapacity({ ...blank, model: memoryModel, hosts: [memorySpare] })).not.toBeNull();
    expect(parseFleetCapacity({ ...capacity, hosts: [{ ...spare, occupants: [{ serverId: "33333333-3333-4333-8333-333333333333", displayName: "New", demand: noDemand }] }] })).not.toBeNull();
});

// The control plane's own example (docs/managed-hosting/web-admin.md#fleet-capacity), its elisions filled in.
const exampleDemand = {
    runningServerHours: 335.833, samples: 4030,
    cpuCores: { p50: 0.6, p90: 1.2, p95: 1.2, p99: 1.2, max: 1.2 },
    memoryBytes: { p50: 1073741824, p95: 1610612736, max: 1610612736 },
    throttledShare: 0, cpuPressureShare: null,
};
const exampleSteal = { samples: 2015, mean: 5, p95: 5, max: 5 };
const exampleKey = "ovhcloud-vps|6|12|Intel Core Processor (Haswell, no TSX)|2400";
const example = {
    generatedAt: "2026-10-17T00:20:00.000Z", windowStartedAt: "2026-10-10T00:00:00.000Z", windowEndedAt: "2026-10-17T00:00:00.000Z", hours: 168,
    model: { cpuPercentile: 50, cpuBurstVcpu: 1.6, memoryBurstBytes: 2684354560, memoryPercentile: 95, minimumRunningHours: 6, staticBurstVcpuPerServer: 2,
        staticBurstMemoryBytesPerServer: 3221225472 },
    fleet: { hosts: 1, servers: 2, demand: exampleDemand },
    providers: [{ provider: "ovhcloud-vps", hosts: 1, servers: 2, demand: exampleDemand, steal: exampleSteal, busyCores: { samples: 2015, mean: 2.1, p95: 2.1, max: 2.1 } }],
    instanceTypes: [{
        key: exampleKey, provider: "ovhcloud-vps", vCpu: 6, memoryBytes: 12884901888, cpuModel: "Intel Core Processor (Haswell, no TSX)", cpuMhz: 2400,
        hosts: 1, servers: 2, demand: exampleDemand, steal: exampleSteal, modelledServers: 3, demandSource: "type",
    }],
    hosts: [{
        serviceName: "vps-1a2b3c4d.vps.ovh.net", provider: "ovhcloud-vps", regionKeys: ["germany"],
        vCpu: 6, memoryBytes: 12884901888, cpuModel: "Intel Core Processor (Haswell, no TSX)", cpuMhz: 2394,
        instanceTypeKey: exampleKey, slots: 3,
        occupants: [
            { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Calradia Company", demand: {
                runningServerHours: 167.917, samples: 2015, cpuCores: { p50: 1.2, p90: 1.2, p95: 1.2, p99: 1.2, max: 1.2 },
                memoryBytes: { p50: 1610612736, p95: 1610612736, max: 1610612736 }, throttledShare: 0, cpuPressureShare: null } },
            { serverId: "33333333-3333-4333-8333-333333333333", displayName: "Sturgia Nights", demand: {
                runningServerHours: 167.917, samples: 2015, cpuCores: { p50: 0.6, p90: 0.6, p95: 0.6, p99: 0.6, max: 0.6 },
                memoryBytes: { p50: 1073741824, p95: 1073741824, max: 1073741824 }, throttledShare: 0, cpuPressureShare: null } },
        ],
        steal: exampleSteal, busyCores: { samples: 2015, mean: 2.1, p95: 2.1, max: 2.1 },
        cpuPressureShare: null, overheadCores: 0.3, overheadMemoryBytes: 1610612736,
        usableCores: 5.4, usableMemoryBytes: 11274289152,
        stableCpuCores: 0.6, peakCpuCores: 1.2, peakMemoryBytes: 1610612736, demandCpuCores: 1.6, demandMemoryBytes: 2684354560, demandSource: "vps",
        modelledServers: 3, limitedBy: "cpu", samples: 4032,
        stealHourly: "32".repeat(168), busyHourly: "23".repeat(168),
    }],
};

it("accepts the control plane's documented example", () => {
    expect(parseFleetCapacity(example)).toBe(example);
});

/** A read from before the CPU burst target: no `cpuBurstVcpu`, `stableCpuCores` or `peakCpuCores` and no `vps` source. */
const earlierHost = <T extends { stableCpuCores: unknown; peakCpuCores: unknown; demandSource: string }>(entry: T) =>
    ({ ...without(without(entry, "stableCpuCores"), "peakCpuCores"), demandSource: entry.demandSource === "vps" ? "type" : entry.demandSource });
const earlier = { ...capacity, model: without({ ...model, cpuPercentile: 95 }, "cpuBurstVcpu"), hosts: [earlierHost(host), earlierHost(spare)] };

it.each([
    // No control plane sends a read from before the CPU burst target now.
    ["a read from before the CPU burst target", earlier],
    ["a model with a CPU burst target and a VPS from before it", { ...capacity, hosts: [earlierHost(host)] }],
    // A read is in the current shape or the next one, never a mix.
    ["a memory burst target with a VPS without its peak memory", { ...memoryCapacity, hosts: [host] }],
    ["a VPS's peak memory without a memory burst target", { ...capacity, hosts: [memoryHost] }],
    ["a memory burst target with one VPS of each shape", { ...memoryCapacity, hosts: [memoryHost, spare] }],
    ["a zero memory burst target", { ...memoryCapacity, model: { ...memoryModel, memoryBurstBytes: 0 } }],
    ["a negative memory burst target", { ...memoryCapacity, model: { ...memoryModel, memoryBurstBytes: -2.5 * GIB } }],
    ["a fractional memory burst target", { ...memoryCapacity, model: { ...memoryModel, memoryBurstBytes: 2.5 * GIB + 0.5 } }],
    ["a memory burst target above 64 GiB", { ...memoryCapacity, model: { ...memoryModel, memoryBurstBytes: 64 * GIB + 1 }, hosts: [{ ...memoryHost, demandMemoryBytes: 64 * GIB + 1 }] }],
    ["a memory burst target given as text", { ...memoryCapacity, model: { ...memoryModel, memoryBurstBytes: "2684354560" } }],
    ["a null memory burst target", { ...memoryCapacity, model: { ...memoryModel, memoryBurstBytes: null } }],
    ["a negative peak memory", withMemoryHost({ peakMemoryBytes: -1 })],
    ["a fractional peak memory", withMemoryHost({ peakMemoryBytes: 2 * GIB + 0.5 })],
    ["no source but a peak memory alone", withMemoryHost({ demandSource: "none", stableCpuCores: null, peakCpuCores: null, demandCpuCores: null, demandMemoryBytes: null })],
    ["a source without a peak memory", withMemoryHost({ peakMemoryBytes: null })],
    ["a planned memory under the burst target", withMemoryHost({ demandMemoryBytes: 2 * GIB })],
    ["a planned memory a byte over the burst target", withMemoryHost({ demandMemoryBytes: 2.5 * GIB + 1 })],
    ["a planned memory under its peak", withMemoryHost({ peakMemoryBytes: 2.75 * GIB, demandMemoryBytes: 2.5 * GIB })],
    ["the p95 planned with a memory burst target", withMemoryHost({ demandMemoryBytes: demand.memoryBytes.p95 })],
    ["an instance type planned from one VPS", { ...capacity, instanceTypes: [{ ...instanceType, demandSource: "vps" }] }],
    ["a zero burst target", { ...capacity, model: { ...model, cpuBurstVcpu: 0 } }],
    ["a negative burst target", { ...capacity, model: { ...model, cpuBurstVcpu: -1.6 } }],
    ["a burst target above 256 vCPU", { ...capacity, model: { ...model, cpuBurstVcpu: 257 } }],
    ["a burst target given as text", { ...capacity, model: { ...model, cpuBurstVcpu: "1.6" } }],
    ["a null burst target", { ...capacity, model: { ...model, cpuBurstVcpu: null } }],
    ["the earlier burst headroom in percent", { ...capacity, model: { ...without(model, "cpuBurstVcpu"), cpuBurstPercent: 66 } }],
    ["negative stable CPU", withHost({ stableCpuCores: -0.1 })],
    ["negative peak CPU", withHost({ peakCpuCores: -0.1 })],
    ["no source but figures", withHost({ demandSource: "none" })],
    ["no source but a stable CPU alone", withHost({ demandSource: "none", stableCpuCores: 0.85, peakCpuCores: null, demandCpuCores: null, demandMemoryBytes: null })],
    ["no source but a peak CPU alone", withHost({ demandSource: "none", stableCpuCores: null, peakCpuCores: 1.95, demandCpuCores: null, demandMemoryBytes: null })],
    ["a source without a stable CPU", withHost({ stableCpuCores: null })],
    ["a source without a peak CPU", withHost({ peakCpuCores: null })],
    ["a source with zero stable CPU", withHost({ stableCpuCores: 0 })],
    ["a peak below the stable CPU", withHost({ stableCpuCores: 0.85, peakCpuCores: 0.84, demandCpuCores: 1.6 })],
    ["a source without planned memory", withHost({ demandMemoryBytes: null })],
    ["a planned CPU under its peak", withHost({ demandCpuCores: 1.6 })],
    ["a planned CPU under the burst target", withHost({ peakCpuCores: 1.2, demandCpuCores: 1.2 })],
    ["a planned CPU over the burst target and its peak", withHost({ peakCpuCores: 1.2, demandCpuCores: 1.99 })],
    ["a planned CPU under its peak with a memory burst target", withMemoryHost({ demandCpuCores: 1.6 })],
])("rejects %s, mixing the two shapes or out of range", (_case, value) => {
    expect(parseFleetCapacity(value)).toBeNull();
});

it("labels each VPS's per-server source with the burst target and its peak", () => {
    const parsed = parseFleetCapacity(capacity)!;
    const [measured, unmeasured] = parsed.hosts;
    // Its servers peaked above the target, so the peak is what it plans.
    expect(perServerSourceLabel(measured!, parsed.model)).toBe("This VPS · peak 1.950");
    // A peak within the target plans the target. Three decimals, as the planned figure has.
    expect(perServerSourceLabel({ ...measured!, demandSource: "fleet", peakCpuCores: 1.445 }, parsed.model)).toBe("Fleet · 1.6 vCPU burst · peak 1.445");
    expect(perServerSourceLabel({ ...measured!, peakCpuCores: 1.6 }, parsed.model)).toBe("This VPS · 1.6 vCPU burst · peak 1.600");
    expect(formatCoresExact(0.996)).toBe("0.996 cores");
    expect(perServerSourceLabel(unmeasured!, parsed.model)).toBe("None yet");
    // Each figure names its own percentile: the median CPU, its peak and the p95 memory, planned without a memory target.
    expect(occupantDemandLabel(demand, parsed.model)).toBe("0.85 cores stable (p50), peak 1.95 · 1.80 GiB at p95");
    expect(occupantDemandLabel({ ...demand, memoryBytes: null }, parsed.model)).toBe("0.85 cores stable (p50), peak 1.95 · memory —");
    expect(occupantDemandLabel({ ...demand, cpuCores: null }, parsed.model)).toBe("CPU — · 1.80 GiB at p95");
    expect(occupantDemandLabel(noDemand, parsed.model)).toBe("no data yet");
    expect(burstCores(1.445, 1.6)).toBe(1.6);
    expect(burstCores(1.95, 1.6)).toBe(1.95);
});

it("labels each VPS's per-server source with the burst targets it plans and both peaks", () => {
    const parsed = parseFleetCapacity(memoryCapacity)!;
    const [measured, unmeasured] = parsed.hosts;
    // Its CPU peak is above the target and planned; its 2 GiB memory peak is under the target, which is planned.
    expect(perServerSourceLabel(measured!, parsed.model)).toBe("This VPS · 2.5 GiB burst · peaks 1.950 cores, 2.00 GiB");
    // Both peaks within their targets, as on today's fleet; a target is planned at its peak exactly.
    expect(perServerSourceLabel({ ...measured!, peakCpuCores: 1.372, peakMemoryBytes: 2_430_492_672 }, parsed.model)).toBe("This VPS · 1.6 vCPU, 2.5 GiB burst · peaks 1.372 cores, 2.26 GiB");
    expect(perServerSourceLabel({ ...measured!, demandSource: "fleet", peakCpuCores: 1.6, peakMemoryBytes: 2.5 * GIB }, parsed.model)).toBe("Fleet · 1.6 vCPU, 2.5 GiB burst · peaks 1.600 cores, 2.50 GiB");
    // Memory above its target, CPU within; and both above.
    expect(perServerSourceLabel({ ...measured!, peakCpuCores: 1.372, peakMemoryBytes: 2.6 * GIB }, parsed.model)).toBe("This VPS · 1.6 vCPU burst · peaks 1.372 cores, 2.60 GiB");
    expect(perServerSourceLabel({ ...measured!, peakMemoryBytes: 2.6 * GIB }, parsed.model)).toBe("This VPS · peaks 1.950 cores, 2.60 GiB");
    // A memory peak a few MiB above the target prints as 2.50 GiB, so the label keeps the target it reads as.
    expect(perServerSourceLabel({ ...measured!, peakCpuCores: 1.372, peakMemoryBytes: 2.5 * GIB + 5 * 2 ** 20 }, parsed.model)).toBe("This VPS · 1.6 vCPU, 2.5 GiB burst · peaks 1.372 cores, 2.50 GiB");
    expect(perServerSourceLabel(unmeasured!, parsed.model)).toBe("None yet");
    // An occupant's memory peak is shown beside its p95, as it is what the plan follows.
    expect(occupantDemandLabel(demand, parsed.model)).toBe("0.85 cores stable (p50), peak 1.95 · 1.80 GiB at p95, peak 2.00");
    expect(occupantDemandLabel({ ...demand, memoryBytes: null }, parsed.model)).toBe("0.85 cores stable (p50), peak 1.95 · memory —");
    expect(occupantDemandLabel({ ...demand, cpuCores: null }, parsed.model)).toBe("CPU — · 1.80 GiB at p95, peak 2.00");
});

it("accepts what the contract does not rule out", () => {
    // A starved VPS: the control plane clamps usable cores and memory at zero once steal and overhead are taken off.
    expect(parseFleetCapacity(withHost({ usableCores: 0, usableMemoryBytes: 0, modelledServers: 0 }))).not.toBeNull();
    // A key holds a whole CPU model, so it may be longer than other text.
    const longModel = "x".repeat(256);
    expect(parseFleetCapacity({ ...capacity, instanceTypes: [{ ...instanceType, key: `ovhcloud-vps|6|12|${longModel}|2400`, cpuModel: longModel }] })).not.toBeNull();
    // A window that does not start on the hour still covers 168 hours.
    expect(parseFleetCapacity({ ...capacity, windowStartedAt: "2026-10-12T19:30:00.000Z", windowEndedAt: "2026-10-19T19:30:00.000Z" })).not.toBeNull();
    // Percentiles rounded to three decimals may cross by 0.001.
    expect(parseFleetCapacity(withDemand({ cpuCores: { p50: 1.201, p90: 1.2, p95: 1.2, p99: 1.2, max: 1.2 } }))).not.toBeNull();
    expect(parseFleetCapacity(withHost({ steal: { samples: 3, mean: 6.501, p95: 6.501, max: 6.5 } }))).not.toBeNull();
    // Equal figures, steal at its bounds, the hex extremes, a VPS with no slots and figures that do not add up.
    expect(parseFleetCapacity(withHost({ steal: { samples: 1, mean: 100, p95: 100, max: 100 }, stealHourly: hex(week(() => 255)), busyHourly: hex(week(() => 100)) }))).not.toBeNull();
    expect(parseFleetCapacity(withHost({ vCpu: 1, slots: 0, occupants: [host.occupants[0], { ...host.occupants[0], serverId: "44444444-4444-4444-8444-444444444444" }] }))).not.toBeNull();
    expect(parseFleetCapacity({ ...capacity, fleet: { hosts: 0, servers: 99, demand } })).not.toBeNull();
    expect(parseFleetCapacity(withHost({ instanceTypeKey: "not-in-the-read", demandSource: "none", stableCpuCores: null, peakCpuCores: null,
        demandCpuCores: null, demandMemoryBytes: null }))).not.toBeNull();
    // A planned CPU within the control plane's rounding of its peak, and the target where the peak is under it.
    expect(parseFleetCapacity(withHost({ peakCpuCores: 1.9504, demandCpuCores: 1.951 }))).not.toBeNull();
    expect(parseFleetCapacity(withHost({ peakCpuCores: 1.2, demandCpuCores: 1.6 }))).not.toBeNull();
    // A stable CPU equal to its peak: a server that never varied.
    expect(parseFleetCapacity(withHost({ stableCpuCores: 1.95 }))).not.toBeNull();
    expect(parseFleetCapacity({ ...capacity, model: { ...model, cpuPercentile: 90, minimumRunningHours: 12.5, staticBurstVcpuPerServer: 1.5 } })).not.toBeNull();
    // A VPS may report a clock of 0 MHz, and a type rounds anything under 50 MHz to 0.
    expect(parseFleetCapacity(withHost({ cpuMhz: 0 }))).not.toBeNull();
    expect(parseFleetCapacity({ ...capacity, instanceTypes: [{ ...instanceType, key: "ovhcloud-vps|6|12|Intel Core Processor (Haswell, no TSX)|0", cpuMhz: 0 }] })).not.toBeNull();
});

it.each([
    ["an extra top-level key", { ...capacity, plan: {} }],
    ["a missing top-level key", without(capacity, "generatedAt")],
    ["hours other than 168", { ...capacity, hours: 167 }],
    ["a window that is not 168 hours", { ...capacity, windowStartedAt: "2026-10-12T01:00:00.000Z" }],
    ["a timestamp without milliseconds", { ...capacity, generatedAt: "2026-10-19T00:07:31Z" }],
    ["a timestamp that is not a real date", { ...capacity, generatedAt: "2026-02-30T00:07:31.552Z" }],
    ["a model with an extra key", { ...capacity, model: { ...model, cpuShare: 1 } }],
    ["a model without a key", { ...capacity, model: without(model, "minimumRunningHours") }],
    ["a CPU percentile of 0", { ...capacity, model: { ...model, cpuPercentile: 0 } }],
    ["a memory percentile above 100", { ...capacity, model: { ...model, memoryPercentile: 101 } }],
    ["negative minimum running hours", { ...capacity, model: { ...model, minimumRunningHours: -1 } }],
    ["a static vCPU of 0", { ...capacity, model: { ...model, staticBurstVcpuPerServer: 0 } }],
    ["fractional static memory", { ...capacity, model: { ...model, staticBurstMemoryBytesPerServer: 3 * GIB + 0.5 } }],
    ["a fleet without demand", { ...capacity, fleet: without(capacity.fleet, "demand") }],
    ["a fractional fleet host count", { ...capacity, fleet: { ...capacity.fleet, hosts: 1.5 } }],
    ["a demand with an extra key", withDemand({ medianCores: 1 })],
    ["a demand without a key", { ...capacity, fleet: { ...capacity.fleet, demand: without(demand, "throttledShare") } }],
    ["negative running server-hours", withDemand({ runningServerHours: -0.1 })],
    ["fractional samples", withDemand({ samples: 10.5 })],
    ["CPU percentiles out of order", withDemand({ cpuCores: { ...demand.cpuCores, p95: 1.7 } })],
    ["CPU percentiles out of order by more than the rounding", withDemand({ cpuCores: { p50: 1.202, p90: 1.2, p95: 1.2, p99: 1.2, max: 1.2 } })],
    ["CPU percentiles without p90", withDemand({ cpuCores: without(demand.cpuCores, "p90") })],
    ["a negative CPU figure", withDemand({ cpuCores: { p50: -0.1, p90: 1.1, p95: 1.2, p99: 1.6, max: 1.95 } })],
    ["CPU given as text", withDemand({ cpuCores: { ...demand.cpuCores, max: "1.95" } })],
    ["fractional memory bytes", withDemand({ memoryBytes: { ...demand.memoryBytes, p50: 1.5 } })],
    ["memory percentiles out of order", withDemand({ memoryBytes: { ...demand.memoryBytes, max: GIB } })],
    ["memory with a p99", withDemand({ memoryBytes: { ...demand.memoryBytes, p99: 2 * GIB } })],
    ["a throttled share above 1", withDemand({ throttledShare: 1.2 })],
    ["a negative pressure share", withDemand({ cpuPressureShare: -0.1 })],
    ["a provider with an extra key", { ...capacity, providers: [{ ...provider, region: "eu" }] }],
    ["a provider without a name", { ...capacity, providers: [{ ...provider, provider: "" }] }],
    ["one provider twice", { ...capacity, providers: [provider, provider] }],
    ["steal above 100%", { ...capacity, providers: [{ ...provider, steal: { ...steal, max: 100.5 } }] }],
    ["a steal p95 above its max", { ...capacity, providers: [{ ...provider, steal: { ...steal, p95: 7 } }] }],
    ["a steal mean above its max", { ...capacity, providers: [{ ...provider, steal: { ...steal, mean: 7 } }] }],
    ["a stat with an extra key", { ...capacity, providers: [{ ...provider, steal: { ...steal, p99: 3 } }] }],
    ["negative busy cores", { ...capacity, providers: [{ ...provider, busyCores: { ...busy, mean: -1 } }] }],
    ["an instance type with an extra key", { ...capacity, instanceTypes: [{ ...instanceType, region: "eu" }] }],
    ["one instance type twice", { ...capacity, instanceTypes: [instanceType, instanceType] }],
    ["an instance type of 0 vCPU", { ...capacity, instanceTypes: [{ ...instanceType, vCpu: 0 }] }],
    ["an instance type of 0 bytes", { ...capacity, instanceTypes: [{ ...instanceType, memoryBytes: 0 }] }],
    ["a negative clock on an instance type", { ...capacity, instanceTypes: [{ ...instanceType, cpuMhz: -100 }] }],
    ["a negative clock on a VPS", withHost({ cpuMhz: -1 })],
    ["an infinite clock", withHost({ cpuMhz: Number.POSITIVE_INFINITY })],
    ["a clock given as text", withHost({ cpuMhz: "2400" })],
    ["an empty CPU model", { ...capacity, instanceTypes: [{ ...instanceType, cpuModel: "" }] }],
    ["an unknown demand source", { ...capacity, instanceTypes: [{ ...instanceType, demandSource: "host" }] }],
    ["fractional modelled servers", { ...capacity, instanceTypes: [{ ...instanceType, modelledServers: 1.5 }] }],
    ["negative modelled servers", { ...capacity, instanceTypes: [{ ...instanceType, modelledServers: -1 }] }],
    ["hosts that are not a list", { ...capacity, hosts: {} }],
    ["a host with an extra key", withHost({ cost: 1 })],
    ["a host without a key", { ...capacity, hosts: [without(host, "busyHourly")] }],
    ["one VPS twice", { ...capacity, hosts: [host, host] }],
    ["a region key that is not text", withHost({ regionKeys: [7] })],
    ["negative slots", withHost({ slots: -1 })],
    ["an occupant with an extra key", withHost({ occupants: [{ ...host.occupants[0], ownerId: "x" }] })],
    ["an occupant without demand", withHost({ occupants: [without(host.occupants[0]!, "demand")] })],
    ["negative overhead cores", withHost({ overheadCores: -0.1 })],
    ["fractional overhead memory", withHost({ overheadMemoryBytes: 1.5 })],
    ["infinite usable cores", withHost({ usableCores: Number.POSITIVE_INFINITY })],
    ["usable cores below zero", withHost({ usableCores: -0.25 })],
    ["usable memory below zero", withHost({ usableMemoryBytes: -1024 })],
    ["an instance type key longer than 512 characters", { ...capacity, instanceTypes: [{ ...instanceType, key: "k".repeat(513) }] }],
    ["fractional usable memory", withHost({ usableMemoryBytes: 0.5 })],
    ["negative per-server demand", withHost({ demandCpuCores: -1 })],
    ["limited by something else", withHost({ limitedBy: "disk" })],
    ["a pressure share above 1", withHost({ cpuPressureShare: 2 })],
    ["fractional samples on a host", withHost({ samples: 0.5 })],
    ["a steal string of 167 hours", withHost({ stealHourly: host.stealHourly.slice(2) })],
    ["a steal string with an odd character", withHost({ stealHourly: `x${host.stealHourly.slice(1)}` })],
    ["a single dash in an hour", withHost({ stealHourly: `0-${host.stealHourly.slice(2)}` })],
    ["upper-case hex", withHost({ stealHourly: `FF${host.stealHourly.slice(2)}` })],
    ["a busy hour above 100%", withHost({ busyHourly: `65${host.busyHourly.slice(2)}` })],
    ["an hourly series that is not text", withHost({ busyHourly: week(() => 30) })],
])("rejects %s", (_case, value) => {
    expect(parseFleetCapacity(value)).toBeNull();
});

/** `count` copies of `entry`, each with its own `key` from its index, so lists can be built at any length. */
const many = <T extends object>(count: number, entry: T, key: keyof T, name: (index: number) => string) =>
    Array.from({ length: count }, (_, index) => ({ ...entry, [key]: name(index) }));

it.each([
    ["VPSs", (count: number) => ({ ...capacity, hosts: many(count, spare, "serviceName", (index) => `vps-${index}`) }), FLEET_CAPACITY_LIMITS.hosts],
    ["servers on one VPS", (count: number) => withHost({ occupants: many(count, host.occupants[0]!, "serverId", (index) => `server-${index}`) }), FLEET_CAPACITY_LIMITS.occupantsPerHost],
    ["instance types", (count: number) => ({ ...capacity, instanceTypes: many(count, instanceType, "key", (index) => `type-${index}`) }), FLEET_CAPACITY_LIMITS.instanceTypes],
    ["regions on one VPS", (count: number) => withHost({ regionKeys: Array.from({ length: count }, (_, index) => `region-${index}`) }), FLEET_CAPACITY_LIMITS.regionsPerHost],
] as const)("accepts as many %s as the cap and rejects one more", (_case, build, limit) => {
    expect(parseFleetCapacity(build(limit))).not.toBeNull();
    expect(parseFleetCapacity(build(limit + 1))).toBeNull();
});

it("caps each list well above the control plane's own bounds", () => {
    expect(FLEET_CAPACITY_LIMITS).toEqual({ hosts: 256, occupantsPerHost: 64, instanceTypes: 256, regionsPerHost: 32 });
});

it("knows exactly the control plane's VPS providers, each with a readable name", () => {
    expect(FLEET_CAPACITY_PROVIDERS).toEqual(["ovhcloud-vps", "contabo-vps", "hosthatch-vps"]);
    expect(FLEET_CAPACITY_PROVIDERS.map(fleetCapacityProviderLabel)).toEqual(["OVHcloud", "Contabo", "HostHatch"]);
});

it("describes an instance type in words, never by its raw key", () => {
    // A real 12 GB VPS's MemTotal is not a whole GiB: the description shows it as the RAM cell does.
    const memoryBytes = Math.round(11.68 * GIB);
    expect(fleetCapacityTypeLabel({ ...instanceType, memoryBytes })).toBe("OVHcloud · 6 vCPU · 11.68 GiB · Intel Core Processor (Haswell, no TSX) · 2,400 MHz");
    expect(fleetCapacityTypeLabel({ ...instanceType, memoryBytes }).split(" · ")[2]).toBe(formatGiB(memoryBytes));
    expect(fleetCapacityTypeLabel(instanceType)).toBe("OVHcloud · 6 vCPU · 12.00 GiB · Intel Core Processor (Haswell, no TSX) · 2,400 MHz");
    expect(fleetCapacityTypeLabel({ ...instanceType, provider: "hosthatch-vps", memoryBytes: null, cpuModel: null, cpuMhz: 0 })).toBe("HostHatch · 6 vCPU · RAM unknown · CPU model unknown · MHz unknown");
    expect(fleetCapacityTypeLabel({ ...instanceType, provider: "contabo-vps", cpuMhz: null })).toBe("Contabo · 6 vCPU · 12.00 GiB · Intel Core Processor (Haswell, no TSX) · MHz unknown");
});

it.each(FLEET_CAPACITY_PROVIDERS)("accepts %s as a provider, an instance type's and a VPS's", (id) => {
    expect(parseFleetCapacity({ ...capacity, providers: [{ ...provider, provider: id }] })).not.toBeNull();
    expect(parseFleetCapacity({ ...capacity, instanceTypes: [{ ...instanceType, provider: id }] })).not.toBeNull();
    expect(parseFleetCapacity(withHost({ provider: id }))).not.toBeNull();
    // All three providers in one read.
    expect(parseFleetCapacity({ ...capacity, providers: FLEET_CAPACITY_PROVIDERS.map((each) => ({ ...provider, provider: each })) })).not.toBeNull();
});

it.each([
    ["the provider list", { ...capacity, providers: [{ ...provider, provider: "unknown-provider" }] }],
    ["an instance type", { ...capacity, instanceTypes: [{ ...instanceType, provider: "unknown-provider" }] }],
    ["a VPS", withHost({ provider: "unknown-provider" })],
    ["a VPS, by a provider id's case", withHost({ provider: "OVHcloud-VPS" })],
    ["a VPS, by a provider's display name", withHost({ provider: "OVHcloud" })],
])("rejects an unknown provider on %s", (_case, value) => {
    expect(parseFleetCapacity(value)).toBeNull();
});

it("notes VPSs whose servers report but whose host metrics are not measured yet", () => {
    // Enough server demand, but one VPS has no host counters: no sparse note, so this note explains its nulls.
    const unmeasured = { ...host, serviceName: "vps-no-host", steal: null, busyCores: null, cpuPressureShare: null, overheadCores: null, overheadMemoryBytes: null,
        usableCores: null, usableMemoryBytes: null, modelledServers: null, limitedBy: null, stealHourly: "--".repeat(168), busyHourly: "--".repeat(168) };
    const parsed = parseFleetCapacity({ ...capacity, hosts: [host, unmeasured, spare] })!;
    expect(fleetCapacityDataState(parsed)).toBe("ready");
    expect(fleetCapacityDataNote(parsed)).toBeNull();
    expect(parsed.hosts.map(hostMetricsMissing)).toEqual([false, true, true]);
    expect(fleetCapacityHostNote(parsed)).toBe("Host metrics not measured yet on 2 of 3 VPSs: their runners have not reported host counters in the window, so their steal, busy cores, overhead, usable capacity and servers at once show — even where their servers' own needs are measured.");
    expect(fleetCapacityHostNote(parseFleetCapacity(withHost({}))!)).toBeNull();
    // Either host figure missing counts.
    expect(hostMetricsMissing({ steal: host.steal, busyCores: null })).toBe(true);
    expect(hostMetricsMissing({ steal: null, busyCores: host.busyCores })).toBe(true);
    // Before any sample arrives the empty-state note covers every VPS on its own.
    expect(fleetCapacityHostNote(parseFleetCapacity(blank)!)).toBeNull();
    // While the fleet is still short of running data, both notes show.
    const sparse = parseFleetCapacity({ ...withDemand({ runningServerHours: 3.25 }), hosts: [host, unmeasured] })!;
    expect(fleetCapacityDataNote(sparse)).not.toBeNull();
    expect(fleetCapacityHostNote(sparse)).toMatch(/^Host metrics not measured yet on 1 of 2 VPSs:/u);
});

it("decodes hourly hex oldest first, with hours without data as null", () => {
    const values = decodeHourly(host.stealHourly);
    expect(values).toHaveLength(168);
    expect(values.slice(0, 3)).toEqual([null, null, 4]);
    expect(values[68]).toBe(255);
    expect(decodeHourly("--".repeat(168)).every((value) => value === null)).toBe(true);
});

it("shades steal on its permille bands and busy by tenths", () => {
    expect([0, 4, 5, 9, 10, 20, 30, 50, 75, 100, 150, 199, 200, 255].map(stealBand)).toEqual([0, 0, 1, 1, 2, 3, 4, 5, 6, 7, 8, 8, 9, 9]);
    expect([0, 9, 10, 45, 89, 90, 100].map(busyBand)).toEqual([0, 0, 1, 4, 8, 9, 9]);
});

it("labels hours and the window in UTC, minutes included for a window off the hour", () => {
    expect(capacityHourLabel("2026-10-12T00:00:00.000Z", 68)).toBe("Wed 14 Oct 20:00 UTC");
    expect(capacityHourLabel("2026-10-12T19:30:00.000Z", 5)).toBe("Tue 13 Oct 00:30 UTC");
    expect(capacityWindowLabel(capacity)).toBe("12 Oct 00:00 – 19 Oct 00:00 UTC");
    expect(capacityWindowLabel({ windowStartedAt: "2026-10-12T19:30:00.000Z", windowEndedAt: "2026-10-19T19:30:00.000Z" })).toBe("12 Oct 19:30 – 19 Oct 19:30 UTC");
});

it("groups VPSs by provider then region, without a region last, and VPSs without data last in their group", () => {
    const quiet = { ...spare, serviceName: "vps-de-quiet", regionKeys: ["germany"] };
    const contabo = { ...host, serviceName: "vmi123456.contaboserver.net", provider: "contabo-vps" };
    const uk = { ...host, serviceName: "vps-uk", regionKeys: ["united-kingdom"] };
    const parsed = parseFleetCapacity({ ...capacity, hosts: [spare, quiet, uk, host, contabo] })!;
    expect(fleetCapacityHostGroups(parsed.hosts).map((group) => [group.label, group.hosts.map((entry) => entry.serviceName)])).toEqual([
        ["Contabo · Germany", ["vmi123456.contaboserver.net"]],
        ["OVHcloud · Germany", ["vps-1a2b3c4d.vps.ovh.net", "vps-de-quiet"]],
        ["OVHcloud · United Kingdom", ["vps-uk"]],
        ["OVHcloud · No region", ["vps-spare"]],
    ]);
});

it("compares modelled servers with today's slots", () => {
    expect(modelledVerdict(1, 2)).toEqual({ kind: "risk", label: "At risk −1", description: "1 fewer than its 2 slots: at risk when every slot's server runs at once." });
    expect(modelledVerdict(5, 3)).toEqual({ kind: "headroom", label: "Headroom +2", description: "2 more than its 3 slots: room for more servers." });
    expect(modelledVerdict(3, 3).kind).toBe("match");
    expect(modelledVerdict(null, 3).kind).toBe("unknown");
    expect(staticSlots(6, model)).toBe(3);
    expect(staticSlots(7, model)).toBe(3);
    expect(staticSlots(1, model)).toBe(0);
});

it("compares the fleet's needs with the static rule, or says there is not enough data", () => {
    expect(staticRuleComparison(parseFleetCapacity(capacity)!)).toBe("Today's static rule reserves 2 vCPU · 3 GiB per server. A running server uses 0.85 cores at p50 (43% of 2 vCPU) and 1.80 GiB at p95 (60% of 3 GiB). Every online server is planned to burst to 1.6 vCPU at once, or to its VPS's measured peak where higher. The fleet's highest peak is 1.950 cores, so VPSs plan from 1.600 cores to 1.950 cores per server (98% of 2 vCPU at most); each VPS's own is in its per-server column.");
    expect(staticRuleComparison(parseFleetCapacity({ ...capacity, model: { ...model, cpuPercentile: 99 } })!)).toContain("1.60 cores at p99 (80% of 2 vCPU)");
    // Without a memory burst target: no CPU peak above the target, and one exactly at it, plan the target everywhere.
    const currentAt = (max: number) => asParsed({ ...capacity, fleet: { ...capacity.fleet, demand: { ...demand, cpuCores: { ...demand.cpuCores, max } } } });
    expect(staticRuleComparison(currentAt(1.2))).toContain("No peak is above the target (the fleet's highest is 1.200 cores), so every VPS plans 1.600 cores per server (80% of 2 vCPU).");
    expect(staticRuleComparison(currentAt(1.6))).toContain("so every VPS plans 1.600 cores per server");
});

it("bounds each VPS's planned CPU and memory by the fleet's peaks with a memory burst target", () => {
    const uses = "Today's static rule reserves 2 vCPU · 3 GiB per server. A running server uses 0.60 cores at p50 (30% of 2 vCPU) and 1.50 GiB at p95 (50% of 3 GiB).";
    const burst = "Every online server is planned to burst to 1.6 vCPU and 2.5 GiB at once, or to its VPS's measured peaks where higher;";
    // The control plane's own example: neither peak is above its target, so every VPS plans both targets.
    expect(staticRuleComparison(parseFleetCapacity(example)!)).toBe(`${uses} ${burst} no CPU peak is above its target (the fleet's highest is 1.200 cores), so every VPS plans 1.600 cores per server (80% of 2 vCPU), and no memory peak is above its target (the fleet's highest is 1.50 GiB), so every VPS plans 2.50 GiB per server (83% of 3 GiB).`);
    const withPeaks = (cpuMax: number, memoryMax: number) => staticRuleComparison(parseFleetCapacity({ ...example, fleet: { ...example.fleet, demand: {
        ...exampleDemand, cpuCores: { ...exampleDemand.cpuCores, max: cpuMax }, memoryBytes: { ...exampleDemand.memoryBytes, max: memoryMax } } } })!);
    // A memory peak above its target ranges the plans from the target to that peak; one exactly at it plans the target.
    expect(withPeaks(1.2, 2.75 * GIB)).toContain("no CPU peak is above its target (the fleet's highest is 1.200 cores), so every VPS plans 1.600 cores per server (80% of 2 vCPU), and the fleet's highest memory peak is 2.75 GiB, so VPSs plan from 2.50 GiB to 2.75 GiB per server (92% of 3 GiB at most); each VPS's own is in its per-server column.");
    // A peak a few MiB above the target shows as the same two decimals, so it reads as at the target, never as a range
    // from 2.50 to 2.50; one that shows differently is above it.
    expect(withPeaks(1.2, 2.5 * GIB + 1)).toContain("and no memory peak is above its target (the fleet's highest is 2.50 GiB), so every VPS plans 2.50 GiB per server (83% of 3 GiB).");
    expect(withPeaks(1.2, 2.5 * GIB + 5 * 2 ** 20)).not.toContain("from 2.50 GiB to 2.50 GiB");
    expect(withPeaks(1.2, 2.5 * GIB + 16 * 2 ** 20)).toContain("the fleet's highest memory peak is 2.52 GiB, so VPSs plan from 2.50 GiB to 2.52 GiB per server");
    expect(withPeaks(1.2, 2.5 * GIB)).toContain("and no memory peak is above its target (the fleet's highest is 2.50 GiB), so every VPS plans 2.50 GiB per server (83% of 3 GiB).");
    // A CPU peak above its target alone, and both.
    expect(withPeaks(1.95, 2 * GIB)).toContain("the fleet's highest CPU peak is 1.950 cores, so VPSs plan from 1.600 cores to 1.950 cores per server (98% of 2 vCPU at most), and no memory peak is above its target (the fleet's highest is 2.00 GiB), so every VPS plans 2.50 GiB per server (83% of 3 GiB); each VPS's own is in its per-server column.");
    expect(withPeaks(1.95, 2.75 * GIB)).toContain("(98% of 2 vCPU at most), and the fleet's highest memory peak is 2.75 GiB, so VPSs plan from 2.50 GiB to 2.75 GiB per server (92% of 3 GiB at most); each VPS's own is in its per-server column.");
    // Nothing is planned until the fleet has run long enough.
    const sparse = { ...example, fleet: { ...example.fleet, demand: { ...exampleDemand, runningServerHours: 3.25 } } };
    expect(staticRuleComparison(parseFleetCapacity(sparse)!)).not.toContain("burst");
    expect(staticRuleComparison(parseFleetCapacity(blank)!)).toBe("Today's static rule reserves 2 vCPU · 3 GiB per server. There is not enough data yet to compare it with what servers use.");
});

it("says when there is no data or not enough yet", () => {
    expect(fleetCapacityDataState(parseFleetCapacity(blank)!)).toBe("empty");
    expect(fleetCapacityDataNote(parseFleetCapacity(blank)!)).toMatch(/^Not enough data yet: no resource samples have arrived\./u);
    const sparse = parseFleetCapacity(withDemand({ runningServerHours: 3.25 }))!;
    expect(fleetCapacityDataState(sparse)).toBe("sparse");
    // Nothing is planned yet, so the summary says what servers use and plans nothing.
    expect(staticRuleComparison(sparse)).toBe("Today's static rule reserves 2 vCPU · 3 GiB per server. A running server uses 0.85 cores at p50 (43% of 2 vCPU) and 1.80 GiB at p95 (60% of 3 GiB).");
    expect(staticRuleComparison(parseFleetCapacity(withDemand({ runningServerHours: 6 }))!)).toContain("so VPSs plan from 1.600 cores to 1.950 cores per server");
    expect(fleetCapacityDataNote(sparse)).toBe("Not enough data yet: the fleet has 3.3 server-h of running data, and the model plans with a VPS's own servers', an instance type's or the whole fleet's figures only once it has 6.0 server-h. Until then no VPS is modelled, and figures without data show —.");
    expect(fleetCapacityDataState(parseFleetCapacity(capacity)!)).toBe("ready");
    expect(fleetCapacityDataNote(parseFleetCapacity(capacity)!)).toBeNull();
});

it("reads a clock of 0 MHz as unknown", () => {
    expect([null, 0, 2400].map(knownMhz)).toEqual([null, null, 2400]);
});

it("explains busy cores and modelled servers as the control plane computes them", () => {
    const hints = fleetCapacityHints(parseFleetCapacity(capacity)!.model);
    // Busy is user + nice + system + irq + softirq time.
    expect(hints.busyCores).toContain("(user, nice, system and interrupt time)");
    // Nothing is modelled while the VPS's servers, the type and the fleet are under minimumRunningHours.
    expect(hints.modelled).toContain("unknown until its steal, overhead and memory are measured and its own servers, its instance type or the fleet have enough running data.");
    // Each server bursts to the 1.6 vCPU target, or its peak, at once; servers online together, not on the VPS.
    expect(hints.modelled).toContain("if each bursts to 1.6 vCPU (or its peak where higher) at once, with p95 memory");
    expect(hints.modelled).toContain("It counts servers online together, not servers on the VPS");
    expect(hints.cpuP50).toContain("a server's stable CPU use, shown for comparison. The model plans CPU from the 1.6 vCPU burst target and the peak");
    // The CPU peak is a 5-minute interval's mean, and what the model plans at above the target.
    expect(hints.cpuMax).toContain("Each interval averages about 5 minutes, so shorter spikes are averaged in.");
    expect(hints.cpuMax).toContain("Each VPS plans every online server at the 1.6 vCPU burst target, or at the peak of its own demand source");
    expect(hints.cpuMax).toContain("no source peaks above this");
    expect(hints.max).toBe("The highest interval in the week.");
    expect(hints.p50).not.toContain("stable");
    // Without a memory burst target memory is planned at its p95.
    expect(hints.p95).toContain("The model sizes servers at this level");
    expect(hints.memory).not.toContain("burst");
    expect(hints.perServer).toContain("and its p95 memory.");
});

it("explains memory as the burst target or the peak, with the p95 for comparison, once there is a memory burst target", () => {
    const hints = fleetCapacityHints(memoryModel);
    expect(hints.memory).toBe("Memory one server used (its working set) at the end of each running interval of about 5 minutes, in GiB. The model plans memory at the 2.5 GiB burst target, or the peak where higher.");
    expect(hints.p95).toBe("p95: 95% of the intervals were at or below this, shown for comparison; the model does not plan memory from it.");
    expect(hints.max).toBe("The highest interval in the week. Each VPS plans the peak of its own demand source (its own servers, its instance type or the fleet) where that is above the 2.5 GiB target, as its per-server column shows; no source peaks above this.");
    expect(hints.p50).toBe("p50: the median. Half of the intervals were at or below this.");
    expect(hints.perServer).toBe("Per server: what one server is modelled to need on this VPS when every server on it bursts at once: 1.6 vCPU and 2.5 GiB, or the peak CPU and memory of the source shown where higher.");
    expect(hints.modelled).toContain("if each bursts to 1.6 vCPU and 2.5 GiB (or its peaks where higher) at once: floor(min(usable cores ÷ per-server cores, usable memory ÷ per-server memory))");
    // The CPU hints are those without a memory burst target.
    const current = fleetCapacityHints({ ...memoryModel, memoryBurstBytes: null });
    expect([hints.cpuP50, hints.cpuP95, hints.cpuMax]).toEqual([current.cpuP50, current.cpuP95, current.cpuMax]);
});

it("formats a sliver of a percent and explains failed reads", () => {
    expect([0, 0.04, 0.05, 1.25, 25.5].map(formatPercent)).toEqual(["0.0%", "<0.1%", "0.1%", "1.3%", "25.5%"]);
    expect(fleetCapacityErrorMessage(new ControlPlaneAdminError("rate_limited", "Too many.", true))).toBe("You can read fleet capacity six times every five minutes. Wait a few minutes, then refresh.");
    expect(fleetCapacityErrorMessage(new ControlPlaneAdminError("invalid_request", "Invalid.", false))).toBe("This control plane does not report fleet capacity yet.");
    expect(fleetCapacityErrorMessage(new ControlPlaneAdminError("unsupported_operation", "Unsupported.", false))).toBe("This control plane does not report fleet capacity yet.");
    expect(fleetCapacityErrorMessage(new ControlPlaneAdminError("capacity_unavailable", "Capacity history is unavailable.", true))).toBe("Capacity history is unavailable.");
    expect(fleetCapacityErrorMessage("boom")).toBe("Fleet capacity could not be loaded.");
});

// A control plane that fits on typical demand (#550), in model-v2 §4's shape. Its VPS's servers usually need 1.2 cores
// (p95), so it fits each at the 1.6 vCPU target; less the 0.3% steal p50 and its overhead, 5.632 usable cores run 3 at
// once, limited by CPU, as many as its slots, with 1 server co-online. Bursting to its 1.95-core peak, 2 could.
const typicalModel = { ...memoryModel, cpuTypicalPercentile: 95, stealPercentile: 50, stealFloorThresholdPercent: 5, concurrentBusyFraction: 0.5, concurrentHourShare: 0.01 };
const typicalSteal = { samples: 2016, mean: 0.4, p50: 0.3, p95: 1.2, max: 6.5 };
const typicalBusy = { samples: 2016, mean: 1.1, p50: 1, p95: 2.4, max: 4.8 };
const typicalHost = {
    ...memoryHost, steal: typicalSteal, busyCores: typicalBusy, effectiveVcpu: 5.982, usableCores: 5.632, typicalCpuCores: 1.2, demandCpuCores: 1.6,
    demandMemoryBytes: 2.5 * GIB, burstCpuCores: 1.95, burstServers: 2, modelledServers: 3, limitedBy: "cpu",
    concurrentServers: 1, concurrentSource: "measured", concurrentCoverage: 0.982, verdict: { kind: "matches", servers: 0 },
};
// No servers, so nothing is modelled and every slot counts as co-online.
const typicalSpare = {
    ...memorySpare, effectiveVcpu: null, typicalCpuCores: null, burstCpuCores: null, burstServers: null,
    concurrentServers: 3, concurrentSource: "slots", concurrentCoverage: 0, verdict: { kind: "unknown", servers: 0 },
};
const typicalType = { ...instanceType, steal: typicalSteal, effectiveVcpu: 5.982, typicalCpuCores: 1.2, burstServers: 2, modelledServers: 3, verdict: { kind: "matches", servers: 0 } };
const typicalProvider = { ...provider, steal: typicalSteal, busyCores: typicalBusy };
const typicalCapacity = { ...capacity, model: typicalModel, providers: [typicalProvider], instanceTypes: [typicalType], hosts: [typicalHost, typicalSpare] };
const withTypicalHost = (changes: Record<string, unknown>) => ({ ...typicalCapacity, hosts: [{ ...typicalHost, ...changes }] });
const sixServers = Array.from({ length: 6 }, (_, index) => ({ ...host.occupants[0]!, serverId: `server-${index}`, displayName: `Server ${index}` }));
// A day/night VPS raised to 6 slots: three servers by day, three by night, so 3 are co-online and it runs 3 at once.
const dayNight = { slots: 6, occupants: sixServers, modelledServers: 3, concurrentServers: 3, verdict: { kind: "matches", servers: 0 } };

it("accepts a read from a control plane that fits on typical demand exactly as it is", () => {
    expect(parseFleetCapacity(typicalCapacity)).toBe(typicalCapacity);
    expect(fleetCapacityTypical(parseFleetCapacity(typicalCapacity)!)).toBe(true);
    expect(fleetCapacityTypical(parseFleetCapacity(memoryCapacity)!)).toBe(false);
    // Each verdict, from N against M and S.
    expect(parseFleetCapacity(withTypicalHost(dayNight))).not.toBeNull();
    expect(parseFleetCapacity(withTypicalHost({ ...dayNight, concurrentServers: 6, verdict: { kind: "at-risk", servers: 3 } }))).not.toBeNull();
    expect(parseFleetCapacity(withTypicalHost({ modelledServers: 4, verdict: { kind: "headroom", servers: 1 } }))).not.toBeNull();
    expect(parseFleetCapacity(withTypicalHost({ modelledServers: null, limitedBy: null, burstServers: null, verdict: { kind: "unknown", servers: 0 } }))).not.toBeNull();
    // Co-online at its worst case, and counted from the slots.
    expect(parseFleetCapacity(withTypicalHost({ ...dayNight, concurrentSource: "worst-case-occupants", concurrentCoverage: 0.5 }))).not.toBeNull();
    expect(parseFleetCapacity(withTypicalHost({ occupants: [], concurrentServers: 3, concurrentSource: "slots", concurrentCoverage: 0 }))).not.toBeNull();
    // Fit at the p95 above the target, and at the cap above that; memory at the cap above it; bursting at the cap.
    expect(parseFleetCapacity(withTypicalHost({ typicalCpuCores: 1.8, demandCpuCores: 1.8 }))).not.toBeNull();
    expect(parseFleetCapacity(withTypicalHost({ typicalCpuCores: 2.15, peakCpuCores: 2.72, demandCpuCores: 2, burstCpuCores: 2 }))).not.toBeNull();
    expect(parseFleetCapacity(withTypicalHost({ peakMemoryBytes: 3.25 * GIB, demandMemoryBytes: 3 * GIB }))).not.toBeNull();
    // Burst headroom of none, a VPS without steal, and an instance type without a source.
    expect(parseFleetCapacity(withTypicalHost({ burstServers: 0 }))).not.toBeNull();
    expect(parseFleetCapacity(withTypicalHost({ steal: null, effectiveVcpu: null }))).not.toBeNull();
    expect(parseFleetCapacity({ ...typicalCapacity, instanceTypes: [{ ...typicalType, demandSource: "none", typicalCpuCores: null, modelledServers: null, burstServers: null, verdict: { kind: "unknown", servers: 0 } }] })).not.toBeNull();
    expect(fitCores(1.2, 1.6, 2)).toBe(1.6);
    expect(fitCores(1.8, 1.6, 2)).toBe(1.8);
    expect(fitCores(2.15, 1.6, 2)).toBe(2);
});

it.each([
    // A read is in one shape throughout: its model's.
    ["a typical model with a VPS in the current shape", { ...typicalCapacity, hosts: [memoryHost] }],
    ["a current model with a VPS in the typical shape", { ...memoryCapacity, hosts: [typicalHost] }],
    ["a typical read with a provider's steal without p50", { ...typicalCapacity, providers: [provider] }],
    ["a current read with a steal p50", { ...memoryCapacity, providers: [typicalProvider] }],
    ["a typical read with an instance type in the current shape", { ...typicalCapacity, instanceTypes: [instanceType] }],
    ["a current read with an instance type in the typical shape", { ...memoryCapacity, instanceTypes: [typicalType] }],
    ["a VPS with an extra key", withTypicalHost({ burstMemoryBytes: GIB })],
    ["a VPS without its verdict", { ...typicalCapacity, hosts: [without(typicalHost, "verdict")] }],
    ["a model without the co-online hour share", { ...typicalCapacity, model: without(typicalModel, "concurrentHourShare") }],
    ["a model with an extra key", { ...typicalCapacity, model: { ...typicalModel, cpuFitPercentile: 95 } }],
    ["a verdict with an extra key", withTypicalHost({ verdict: { kind: "matches", servers: 0, label: "Matches" } })],
    // Planned figures are within the static rule's caps, and effective vCPU within the vCPUs.
    ["a planned CPU above the cap", withTypicalHost({ typicalCpuCores: 2.15, peakCpuCores: 2.72, demandCpuCores: 2.15, burstCpuCores: 2 })],
    ["a planned memory above the cap", withTypicalHost({ peakMemoryBytes: 3.25 * GIB, demandMemoryBytes: 3.25 * GIB })],
    ["a burst CPU at a peak above the cap", withTypicalHost({ peakCpuCores: 2.72, burstCpuCores: 2.72 })],
    ["a steal p50 above its p95", withTypicalHost({ steal: { ...typicalSteal, p50: 1.5 } })],
    ["effective vCPU above the vCPU", withTypicalHost({ effectiveVcpu: 6.5 })],
    ["a negative typical CPU", withTypicalHost({ typicalCpuCores: -0.1 })],
    ["fractional burst headroom", withTypicalHost({ burstServers: 1.5 })],
    ["negative burst headroom", withTypicalHost({ burstServers: -1 })],
    ["fractional co-online servers", withTypicalHost({ concurrentServers: 1.5 })],
    // Co-online is at most the slots, which it is without servers.
    ["co-online above the slots", withTypicalHost({ concurrentServers: 4, verdict: { kind: "at-risk", servers: 1 } })],
    ["co-online from the slots below them", withTypicalHost({ concurrentSource: "slots" })],
    ["an unknown co-online source", withTypicalHost({ concurrentSource: "estimated" })],
    ["coverage above 1", withTypicalHost({ concurrentCoverage: 1.2 })],
    // The verdict follows N, M and S.
    ["matches with N above the slots", withTypicalHost({ modelledServers: 4 })],
    ["headroom by the wrong count", withTypicalHost({ modelledServers: 4, verdict: { kind: "headroom", servers: 2 } })],
    ["at risk while N covers M", withTypicalHost({ verdict: { kind: "at-risk", servers: 1 } })],
    ["unknown with N", withTypicalHost({ verdict: { kind: "unknown", servers: 0 } })],
    ["the day/night VPS's verdict against its slots", withTypicalHost({ ...dayNight, verdict: { kind: "at-risk", servers: 3 } })],
    ["an instance type's verdict that is not against its static slots", { ...typicalCapacity, instanceTypes: [{ ...typicalType, verdict: { kind: "headroom", servers: 1 } }] }],
    ["an instance type's effective vCPU above its vCPU", { ...typicalCapacity, instanceTypes: [{ ...typicalType, effectiveVcpu: 6.5 }] }],
    ["a negative steal floor threshold", { ...typicalCapacity, model: { ...typicalModel, stealFloorThresholdPercent: -1 } }],
    ["a busy fraction above 1", { ...typicalCapacity, model: { ...typicalModel, concurrentBusyFraction: 1.5 } }],
])("rejects %s, in the typical shape", (_case, value) => {
    expect(parseFleetCapacity(value)).toBeNull();
});

it("accepts typical-shape figures without working them out again from the control plane's formulas", () => {
    // Planned CPU, typical CPU, burst headroom and effective vCPU are the control plane's to compute: a change in a
    // formula or its rounding must not reject the read. Only their ranges, the static rule's caps and the verdict are checked.
    for (const changes of [
        { demandCpuCores: 1.95 }, { demandCpuCores: 1.2 }, { typicalCpuCores: 2, demandCpuCores: 2 }, { typicalCpuCores: 0.8 },
        { typicalCpuCores: null }, { burstServers: 4 }, { steal: null }, { effectiveVcpu: null }, { demandMemoryBytes: 2 * GIB },
        { burstCpuCores: 1.5 }, { modelledServers: null, limitedBy: null, verdict: { kind: "unknown", servers: 0 } },
    ]) expect(parseFleetCapacity(withTypicalHost(changes))).not.toBeNull();
    expect(parseFleetCapacity({ ...typicalCapacity, hosts: [{ ...typicalSpare, burstCpuCores: 1.6 }] })).not.toBeNull();
    expect(parseFleetCapacity({ ...typicalCapacity, instanceTypes: [{ ...typicalType, demandSource: "none" }] })).not.toBeNull();
    // At the caps, within the control plane's rounding.
    expect(parseFleetCapacity(withTypicalHost({ typicalCpuCores: 2.15, peakCpuCores: 2.72, demandCpuCores: 2.0005, burstCpuCores: 2 }))).not.toBeNull();
    expect(parseFleetCapacity(withTypicalHost({ peakMemoryBytes: 3.25 * GIB, demandMemoryBytes: 3 * GIB }))).not.toBeNull();
    // The current control plane's planned figures are still checked against its burst targets, as before.
    expect(parseFleetCapacity({ ...memoryCapacity, hosts: [{ ...memoryHost, demandCpuCores: 1.6 }] })).toBeNull();
});

it("shows the read's verdict of what a VPS can run at once against its co-online servers and slots", () => {
    const shown = (changes: Record<string, unknown>) => {
        const entry = parseFleetCapacity(withTypicalHost(changes))!.hosts[0]!;
        return { summary: capacityAtOnceSummary(entry), verdict: capacityVerdict(entry, entry.slots) };
    };
    expect(shown({})).toEqual({ summary: "Can run 3 at once · co-online 1 · slots 3",
        verdict: { kind: "match", label: "Matches", description: "It can run 3 at once: enough for its 1 co-online, and no more than its 3 slots." } });
    // The day/night VPS runs its three co-online servers, though it has 6 slots: it matches.
    expect(shown(dayNight)).toEqual({ summary: "Can run 3 at once · co-online 3 · slots 6",
        verdict: { kind: "match", label: "Matches", description: "It can run 3 at once: enough for its 3 co-online, and no more than its 6 slots." } });
    // All six online together: at risk by the three it cannot run.
    expect(shown({ ...dayNight, concurrentServers: 6, verdict: { kind: "at-risk", servers: 3 } })).toEqual({ summary: "Can run 3 at once · co-online 6 · slots 6",
        verdict: { kind: "risk", label: "At risk −3", description: "3 servers more online together than it can run at once: up to 6 co-online, 3 at once." } });
    expect(shown({ modelledServers: 4, verdict: { kind: "headroom", servers: 1 } })).toEqual({ summary: "Can run 4 at once · co-online 1 · slots 3",
        verdict: { kind: "headroom", label: "Headroom +1", description: "1 more than its 3 slots: room for more servers even with every slot's server online at once." } });
    // Its worst case named: servers without enough samples count as always online, and a VPS without servers counts its slots.
    expect(shown({ ...dayNight, concurrentSource: "worst-case-occupants" }).summary).toBe("Can run 3 at once · co-online 3 (some servers counted as always online) · slots 6");
    expect(shown({ occupants: [], concurrentServers: 3, concurrentSource: "slots", concurrentCoverage: 0 }).summary).toBe("Can run 3 at once · co-online unmeasured, using slots · slots 3");
    expect(shown({ modelledServers: null, limitedBy: null, burstServers: null, verdict: { kind: "unknown", servers: 0 } })).toEqual({ summary: "Not modelled yet · co-online 1 · slots 3",
        verdict: { kind: "unknown", label: "Not modelled yet", description: "Not enough data yet to model this." } });
    // An instance type's verdict is against its static slots.
    const type = parseFleetCapacity(typicalCapacity)!.instanceTypes[0]!;
    expect(capacityVerdict(type, staticSlots(type.vCpu, typicalModel)).label).toBe("Matches");
    // From the current control plane, today's N against its slots and wording.
    const current = parseFleetCapacity(memoryCapacity)!.hosts[0]!;
    expect(capacityAtOnceSummary(current)).toBe("2 / 3 slots");
    expect(capacityVerdict(current, current.slots)).toEqual(modelledVerdict(2, 3));
});

it("never lets burst headroom change a verdict", () => {
    const base = parseFleetCapacity(withTypicalHost(dayNight))!.hosts[0]!;
    // Only the peak, the burst CPU it sets and the burst headroom change: the badge stays.
    for (const changes of [{ burstServers: 0 }, { burstServers: 3 }, { peakCpuCores: 2.72, burstCpuCores: 2, burstServers: 1 }, { peakCpuCores: 1.3, burstCpuCores: 1.6, burstServers: 3 }]) {
        const entry = parseFleetCapacity(withTypicalHost({ ...dayNight, ...changes }))!.hosts[0]!;
        expect(capacityVerdict(entry, entry.slots)).toEqual(capacityVerdict(base, base.slots));
        expect(capacityAtOnceSummary(entry)).toBe(capacityAtOnceSummary(base));
    }
});

it("labels what each VPS is fitted at, its burst headroom, steal and effective vCPU in the typical shape", () => {
    const parsed = parseFleetCapacity(typicalCapacity)!;
    const label = (changes: Record<string, unknown>) => perServerSourceLabel({ ...parsed.hosts[0]!, ...changes }, parsed.model);
    // Its p95 under the 1.6 vCPU target, which it is fitted at; then its p95; then the cap above it.
    expect(label({})).toBe("This VPS · 1.6 vCPU target (p95 1.200) · 2.5 GiB memory target · peaks 1.950 cores, 2.00 GiB");
    expect(label({ typicalCpuCores: 1.8 })).toBe("This VPS · p95 1.800 · 2.5 GiB memory target · peaks 1.950 cores, 2.00 GiB");
    expect(label({ typicalCpuCores: 2.15, peakCpuCores: 2.72, peakMemoryBytes: 3.25 * GIB })).toBe("This VPS · p95 2.150 capped at 2 vCPU · 3 GiB memory cap · peaks 2.720 cores, 3.25 GiB");
    // A memory peak between the target and the cap is planned as it is.
    expect(label({ peakMemoryBytes: 2.75 * GIB })).toBe("This VPS · 1.6 vCPU target (p95 1.200) · peaks 1.950 cores, 2.75 GiB");
    expect(perServerSourceLabel(parsed.hosts[1]!, parsed.model)).toBe("None yet");
    expect(burstHeadroomLabel(parsed.hosts[0]!)).toBe("Burst headroom: 2 could burst at once (1.950 cores each)");
    expect(burstHeadroomLabel(parsed.instanceTypes[0]!)).toBe("Burst headroom: 2 could burst at once");
    expect(burstHeadroomLabel(parsed.hosts[1]!)).toBeNull();
    expect(burstHeadroomLabel(parseFleetCapacity(memoryCapacity)!.hosts[0]!)).toBeNull();
    expect(stealFigures(typicalSteal)).toBe("0.3% · 1.2% · 6.5%");
    expect(stealFigures(steal)).toBe("0.4% · 1.2% · 6.5%");
    expect(effectiveVcpuLabel(5.982)).toBe("5.982 effective vCPU");
    expect(occupantDemandLabel(demand, parsed.model)).toBe("0.85 cores stable (p50), p95 1.20, peak 1.95 · 1.80 GiB at p95, peak 2.00");
});

it("summarises a typical fit at what servers usually need, with bursting only as headroom", () => {
    expect(staticRuleComparison(parseFleetCapacity(typicalCapacity)!)).toBe("Today's static rule reserves 2 vCPU · 3 GiB per server. A running server uses 0.85 cores at p50 (43% of 2 vCPU) and 1.80 GiB at p95 (60% of 3 GiB). Each VPS is fitted at what its servers usually need, not at their peaks: CPU at the 1.6 vCPU target, or the p95 of its demand source where higher, at most 2 vCPU (the fleet's p95 is 1.200 cores, which fits at 1.600 cores per server, 80% of 2 vCPU), and memory at 2.5 GiB or the peak where higher, at most 3 GiB; no memory peak is above its target (the fleet's highest is 2.00 GiB), so every VPS plans 2.50 GiB per server (83% of 3 GiB). Bursting to 1.6 vCPU, or the peak where higher, at most 2 vCPU, is shown as burst headroom and never decides a verdict. Each VPS's own figures are in its per-server column.");
    const withFleet = (cores: Record<string, number>, bytes: Record<string, number>) => staticRuleComparison(parseFleetCapacity({ ...typicalCapacity,
        fleet: { ...typicalCapacity.fleet, demand: { ...demand, cpuCores: { ...demand.cpuCores, ...cores }, memoryBytes: { ...demand.memoryBytes, ...bytes } } } })!);
    expect(withFleet({ p95: 1.8, p99: 1.9 }, {})).toContain("(the fleet's p95 is 1.800 cores, which fits at 1.800 cores per server, 90% of 2 vCPU)");
    expect(withFleet({ p95: 2.15, p99: 2.2, max: 2.72 }, {})).toContain("(the fleet's p95 is 2.150 cores, which fits at 2.000 cores per server, 100% of 2 vCPU)");
    expect(withFleet({}, { max: 3.25 * GIB })).toContain("the fleet's highest memory peak is 3.25 GiB, so VPSs plan from 2.50 GiB to 3.00 GiB per server (100% of 3 GiB at most).");
});

it("explains the typical fit, steal p50, co-online servers, verdict and burst headroom in the typical shape's tooltips", () => {
    const hints = fleetCapacityHints(typicalModel);
    expect(hints.cpuP95).toBe("p95: 95% of the intervals were at or below this: what a server usually needs. The model fits each VPS's servers at the 1.6 vCPU target, or the p95 CPU of its demand source where higher, at most 2 vCPU, so a rare burst above it is allowed.");
    expect(hints.cpuMax).toBe("The highest interval in the week. Each interval averages about 5 minutes, so shorter spikes are averaged in. The model does not fit servers at their peak: burst headroom counts how many could burst at once to 1.6 vCPU, or their source's peak where higher, at most 2 vCPU, and never decides a verdict.");
    expect(hints.memory).toBe("Memory one server used (its working set) at the end of each running interval of about 5 minutes, in GiB. The model plans memory at 2.5 GiB, or the peak where higher, at most 3 GiB.");
    expect(hints.perServer).toBe("Per server: what one server is fitted at on this VPS, what servers there usually need: the 1.6 vCPU target, or the p95 CPU of the source shown where higher, at most 2 vCPU, and 2.5 GiB of memory, or its peak where higher, at most 3 GiB.");
    expect(hints.stealP50).toBe("Steal p50: the median steal of the VPS's intervals of about 5 minutes. Steal lowers the VPS's effective vCPU, which the model fits servers on: vCPU × (1 − steal p50 ÷ 100).");
    expect(hints.usable).toBe("Usable: what is left for game servers, never below 0. Cores are effective vCPU − overhead cores, where effective vCPU is vCPU × (1 − steal p50 ÷ 100); memory is RAM − overhead memory.");
    expect(hints.modelled).toBe("Servers at once (N): how many servers the VPS can run together at what they usually need: floor(min(usable cores ÷ per-server cores, usable memory ÷ per-server memory)), but never fewer than the static floor, min(floor(vCPU ÷ 2), floor(RAM ÷ 3 GiB)), where steal lowers the vCPU only once its p50 reaches 5%; unknown until its steal, overhead and memory are measured and its own servers, its instance type or the fleet have enough running data. It is compared with how many of its servers are online together (co-online, M) and with its slots (S): at risk −(M − N) when it can run fewer than are co-online, headroom +(N − S) when it can run more than its slots, matches otherwise. An instance type is compared with its static slots, 2 vCPU · 3 GiB per server, as if every one ran at once. Burst headroom, how many could burst at once, is information only and never changes the verdict.");
    expect(hints.concurrent).toBe("Co-online (M): how many of its current servers are online together at most, leaving under 1% of the week's hours with more, a server counting as online in an hour it ran at least half of, or had no samples in. Some servers counted as always online: a server with too few hours of samples counts as online in every hour, the worst case for it. Unmeasured, using slots: a VPS with no servers counts every slot. Coverage is the share of the week's hours in which every current server has samples.");
    expect(hints.burst).toBe("Burst headroom: how many of its servers could burst at once, each to 1.6 vCPU, or its source's peak where higher, at most 2 vCPU, with the same memory per server. Information only: it never changes the verdict.");
    expect(hints.limitedBy).toBe("Whether CPU or memory runs out first at what servers usually need; where the static rule's floor sets servers at once, the one that limits the floor.");
    // The current control plane's tooltips stay as they were, with no text for figures it lacks.
    const current = fleetCapacityHints(memoryModel);
    expect(current.modelled).toContain("if each bursts to 1.6 vCPU and 2.5 GiB (or its peaks where higher) at once");
    expect([current.stealP50, current.concurrent, current.burst]).toEqual(["", "", ""]);
    expect(Object.values(current).join(" ")).not.toMatch(/co-online|usually need|effective vCPU/u);
});

it("reads model-v2 §4's example VPS and instance type, the full 3/3 6-vCPU host, as matching", () => {
    // §4's fragments, shaped like vps-7e1cbd42: fitted at the 1.6 vCPU target over its 1.418 p95, 5.703 usable cores run 3.
    const exampleSteal = { samples: 2015, mean: 0.948, p50: 0.61, p95: 3.811, max: 7.785 };
    const exampleHost = {
        ...typicalHost, memoryBytes: 12_251_394_212, steal: exampleSteal, effectiveVcpu: 5.963, usableCores: 5.703,
        stableCpuCores: 1.322, peakCpuCores: 2.72, peakMemoryBytes: 1535115264, typicalCpuCores: 1.418, demandCpuCores: 1.6,
        demandMemoryBytes: 2684354560, burstCpuCores: 2, burstServers: 2, modelledServers: 3, limitedBy: "cpu",
        concurrentServers: 3, concurrentSource: "measured", concurrentCoverage: 0.982, verdict: { kind: "matches", servers: 0 },
    };
    const exampleType = { ...typicalType, steal: exampleSteal, effectiveVcpu: 5.998, typicalCpuCores: 1.418, burstServers: 2, modelledServers: 3, verdict: { kind: "matches", servers: 0 } };
    const parsed = parseFleetCapacity({ ...typicalCapacity, instanceTypes: [exampleType], hosts: [exampleHost] })!;
    expect(parsed).not.toBeNull();
    const vps = parsed.hosts[0]!;
    expect(capacityAtOnceSummary(vps)).toBe("Can run 3 at once · co-online 3 · slots 3");
    expect(capacityVerdict(vps, vps.slots).label).toBe("Matches");
    expect(burstHeadroomLabel(vps)).toBe("Burst headroom: 2 could burst at once (2.000 cores each)");
    expect(perServerSourceLabel(vps, parsed.model)).toBe("This VPS · 1.6 vCPU target (p95 1.418) · 2.5 GiB memory target · peaks 2.720 cores, 1.43 GiB");
    expect(stealFigures(vps.steal!)).toBe("0.6% · 3.8% · 7.8%");
    const type = parsed.instanceTypes[0]!;
    expect(capacityVerdict(type, staticSlots(type.vCpu, parsed.model)).label).toBe("Matches");
    // Its verdict is checked against N, M and S: a matches read with N above its slots is rejected.
    expect(parseFleetCapacity({ ...typicalCapacity, hosts: [{ ...exampleHost, modelledServers: 4 }] })).toBeNull();
    // What the copy says of the fit: the 1.6 vCPU target over a lower p95, the p95 above it, and the cap above 2.
    const fitLabel = (typicalCpuCores: number) => perServerSourceLabel({ ...vps, typicalCpuCores }, parsed.model).split(" · ")[1];
    expect([fitLabel(1.418), fitLabel(1.8), fitLabel(2.15)]).toEqual(["1.6 vCPU target (p95 1.418)", "p95 1.800", "p95 2.150 capped at 2 vCPU"]);
    expect(staticRuleComparison(parsed)).toContain("CPU at the 1.6 vCPU target, or the p95 of its demand source where higher, at most 2 vCPU");
    expect(fleetCapacityHints(parsed.model).perServer).toContain("the 1.6 vCPU target, or the p95 CPU of the source shown where higher, at most 2 vCPU");
});
