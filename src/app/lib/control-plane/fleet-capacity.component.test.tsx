import { expect, it } from "vitest";
import { ControlPlaneAdminError } from "./client";
import {
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
    fleetCapacityHints,
    fleetCapacityHostNote,
    formatPercent,
    hostMetricsMissing,
    knownMhz,
    modelledVerdict,
    parseFleetCapacity,
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
    usableCores: 5.58, usableMemoryBytes: 11_703_786_240, demandCpuCores: 1.2, demandMemoryBytes: 1_932_735_283,
    demandSource: "type", modelledServers: 4, limitedBy: "cpu", samples: 2016,
    stealHourly: hex(week((hour) => hour < 2 ? null : hour === 68 ? 255 : 4)),
    busyHourly: hex(week((hour) => hour < 2 ? null : 30)),
};
const spare = {
    ...host, serviceName: "vps-spare", regionKeys: [], memoryBytes: null, cpuModel: null, cpuMhz: null, instanceTypeKey: null, occupants: [],
    steal: null, busyCores: null, cpuPressureShare: null, overheadCores: null, overheadMemoryBytes: null, usableCores: null, usableMemoryBytes: null,
    demandCpuCores: null, demandMemoryBytes: null, demandSource: "none", modelledServers: null, limitedBy: null, samples: 0,
    stealHourly: "--".repeat(168), busyHourly: "--".repeat(168),
};
const instanceType = {
    key: SIX_KEY, provider: "ovhcloud-vps" as const, vCpu: 6, memoryBytes: 12 * GIB, cpuModel: "Intel Core Processor (Haswell, no TSX)", cpuMhz: 2399.996,
    hosts: 1, servers: 1, demand, steal, modelledServers: 4, demandSource: "type",
};
const provider = { provider: "ovhcloud-vps", hosts: 2, servers: 1, demand, steal, busyCores: busy };
const model = { cpuPercentile: 95, memoryPercentile: 95, minimumRunningHours: 6, staticBurstVcpuPerServer: 2, staticBurstMemoryBytesPerServer: 3 * GIB };
const capacity = {
    generatedAt: "2026-10-19T00:07:31.552Z", windowStartedAt: "2026-10-12T00:00:00.000Z", windowEndedAt: "2026-10-19T00:00:00.000Z", hours: 168,
    model, fleet: { hosts: 2, servers: 1, demand }, providers: [provider], instanceTypes: [instanceType], hosts: [host, spare],
};
// The first read after the backend deploys: nothing measured yet, every figure null.
const blank = {
    ...capacity, fleet: { hosts: 1, servers: 0, demand: noDemand },
    providers: [{ ...provider, hosts: 1, servers: 0, demand: noDemand, steal: null, busyCores: null }],
    instanceTypes: [{ ...instanceType, demand: noDemand, steal: null, modelledServers: null, demandSource: "none" }],
    hosts: [spare],
};

const withHost = (changes: Record<string, unknown>) => ({ ...capacity, hosts: [{ ...host, ...changes }] });
const withDemand = (changes: Record<string, unknown>) => ({ ...capacity, fleet: { ...capacity.fleet, demand: { ...demand, ...changes } } });

it("accepts the fleet-capacity read exactly as the contract describes it", () => {
    expect(parseFleetCapacity(capacity)).toBe(capacity);
    expect(parseFleetCapacity({ ...capacity, providers: [], instanceTypes: [], hosts: [] })).not.toBeNull();
});

it("accepts the sparse first read, with every figure null", () => {
    expect(parseFleetCapacity(blank)).toBe(blank);
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
    model: { cpuPercentile: 95, memoryPercentile: 95, minimumRunningHours: 6, staticBurstVcpuPerServer: 2, staticBurstMemoryBytesPerServer: 3221225472 },
    fleet: { hosts: 1, servers: 2, demand: exampleDemand },
    providers: [{ provider: "ovhcloud-vps", hosts: 1, servers: 2, demand: exampleDemand, steal: exampleSteal, busyCores: { samples: 2015, mean: 2.1, p95: 2.1, max: 2.1 } }],
    instanceTypes: [{
        key: exampleKey, provider: "ovhcloud-vps", vCpu: 6, memoryBytes: 12884901888, cpuModel: "Intel Core Processor (Haswell, no TSX)", cpuMhz: 2400,
        hosts: 1, servers: 2, demand: exampleDemand, steal: exampleSteal, modelledServers: 4, demandSource: "type",
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
        demandCpuCores: 1.2, demandMemoryBytes: 1610612736, demandSource: "type",
        modelledServers: 4, limitedBy: "cpu", samples: 4032,
        stealHourly: "32".repeat(168), busyHourly: "23".repeat(168),
    }],
};

it("accepts the control plane's documented example", () => {
    expect(parseFleetCapacity(example)).toBe(example);
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
    expect(parseFleetCapacity(withHost({ instanceTypeKey: "not-in-the-read", demandSource: "none", demandCpuCores: 1.2 }))).not.toBeNull();
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
    expect(fleetCapacityTypeLabel(instanceType)).toBe("OVHcloud · 6 vCPU · 12 GiB · Intel Core Processor (Haswell, no TSX) · 2,400 MHz");
    expect(fleetCapacityTypeLabel({ ...instanceType, provider: "hosthatch-vps", memoryBytes: null, cpuModel: null, cpuMhz: 0 })).toBe("HostHatch · 6 vCPU · RAM unknown · CPU model unknown · MHz unknown");
    expect(fleetCapacityTypeLabel({ ...instanceType, provider: "contabo-vps", cpuMhz: null })).toBe("Contabo · 6 vCPU · 12 GiB · Intel Core Processor (Haswell, no TSX) · MHz unknown");
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
    expect(staticRuleComparison(parseFleetCapacity(capacity)!)).toBe("Today's static rule reserves 2 vCPU · 3 GiB per server. A running server uses 1.20 cores at p95 (60% of 2 vCPU) and 1.80 GiB at p95 (60% of 3 GiB).");
    expect(staticRuleComparison(parseFleetCapacity({ ...capacity, model: { ...model, cpuPercentile: 99 } })!)).toContain("1.60 cores at p99 (80% of 2 vCPU)");
    expect(staticRuleComparison(parseFleetCapacity(blank)!)).toBe("Today's static rule reserves 2 vCPU · 3 GiB per server. There is not enough data yet to compare it with what servers use.");
});

it("says when there is no data or not enough yet", () => {
    expect(fleetCapacityDataState(parseFleetCapacity(blank)!)).toBe("empty");
    expect(fleetCapacityDataNote(parseFleetCapacity(blank)!)).toMatch(/^Not enough data yet: no resource samples have arrived\./u);
    const sparse = parseFleetCapacity(withDemand({ runningServerHours: 3.25 }))!;
    expect(fleetCapacityDataState(sparse)).toBe("sparse");
    expect(fleetCapacityDataNote(sparse)).toBe("Not enough data yet: the fleet has 3.3 server-h of running data, and the model plans with an instance type's or the whole fleet's figures only once it has 6.0 server-h. Until then no VPS is modelled, and figures without data show —.");
    expect(fleetCapacityDataState(parseFleetCapacity(capacity)!)).toBe("ready");
    expect(fleetCapacityDataNote(parseFleetCapacity(capacity)!)).toBeNull();
});

it("reads a clock of 0 MHz as unknown", () => {
    expect([null, 0, 2400].map(knownMhz)).toEqual([null, null, 2400]);
});

it("explains busy cores and modelled servers as the control plane computes them", () => {
    const hints = fleetCapacityHints(model);
    // Busy is user + nice + system + irq + softirq time.
    expect(hints.busyCores).toContain("(user, nice, system and interrupt time)");
    // Nothing is modelled while the type and the fleet are under minimumRunningHours.
    expect(hints.modelled).toContain("unknown until its steal, overhead and memory are measured and its instance type or the fleet has enough running data.");
});

it("formats a sliver of a percent and explains failed reads", () => {
    expect([0, 0.04, 0.05, 1.25, 25.5].map(formatPercent)).toEqual(["0.0%", "<0.1%", "0.1%", "1.3%", "25.5%"]);
    expect(fleetCapacityErrorMessage(new ControlPlaneAdminError("rate_limited", "Too many.", true))).toBe("You can read fleet capacity six times every five minutes. Wait a few minutes, then refresh.");
    expect(fleetCapacityErrorMessage(new ControlPlaneAdminError("invalid_request", "Invalid.", false))).toBe("This control plane does not report fleet capacity yet.");
    expect(fleetCapacityErrorMessage(new ControlPlaneAdminError("unsupported_operation", "Unsupported.", false))).toBe("This control plane does not report fleet capacity yet.");
    expect(fleetCapacityErrorMessage(new ControlPlaneAdminError("capacity_unavailable", "Capacity history is unavailable.", true))).toBe("Capacity history is unavailable.");
    expect(fleetCapacityErrorMessage("boom")).toBe("Fleet capacity could not be loaded.");
});
