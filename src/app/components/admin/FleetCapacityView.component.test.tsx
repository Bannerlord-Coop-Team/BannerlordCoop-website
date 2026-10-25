import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import { fleetCapacityHints } from "@/app/lib/control-plane/fleet-capacity";
import { VPS_PROVIDERS } from "@/app/lib/control-plane/vps-providers";
import type {
    HostingAdminFleetCapacity,
    HostingAdminSlotSizing,
    HostingFleetCapacityDemand,
    HostingFleetCapacityHost,
    HostingFleetCapacityInstanceType,
} from "@/app/lib/control-plane/types";
import { FleetCapacityView } from "./FleetCapacityView";

// The slot sizing pane reads its own operation; `request` answers fleet capacity and `sizing` slot sizing.
const mocks = vi.hoisted(() => ({ request: vi.fn(), sizing: vi.fn(), session: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (original) => ({
    ...await original<typeof import("@/app/lib/control-plane/client")>(),
    requestControlPlaneAdmin: (request: { operation: string }) => request.operation === "slot-sizing" ? mocks.sizing(request) : mocks.request(request),
}));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));

const GIB = 1024 ** 3;
const week = <T,>(value: (hour: number) => T) => Array.from({ length: 168 }, (_, hour) => value(hour));
/** Hourly values as the control plane encodes them: two hex digits, `--` without data. */
const hex = (values: Array<number | null>) => values.map((value) => value === null ? "--" : value.toString(16).padStart(2, "0")).join("");
/** The busiest hour of the fixtures: Wed 14 Oct 20:00 UTC. */
const PEAK = 2 * 24 + 20;

const noDemand: HostingFleetCapacityDemand = { runningServerHours: 0, samples: 0, cpuCores: null, memoryBytes: null, throttledShare: null, cpuPressureShare: null };
/** A server's demand from its p95 CPU cores and memory bytes. */
const demandOf = (cores: number, bytes: number | null): HostingFleetCapacityDemand => ({
    runningServerHours: 120, samples: 1440,
    cpuCores: { p50: cores / 2, p90: cores, p95: cores, p99: cores, max: cores },
    memoryBytes: bytes === null ? null : { p50: Math.round(bytes / 2), p95: bytes, max: bytes },
    throttledShare: 0, cpuPressureShare: 0,
});
const fleetDemand: HostingFleetCapacityDemand = {
    runningServerHours: 412.5, samples: 4950,
    cpuCores: { p50: 0.85, p90: 1.1, p95: 1.2, p99: 1.6, max: 1.95 },
    memoryBytes: { p50: 1_503_238_553, p95: 1_932_735_283, max: 2 * GIB },
    throttledShare: 0.012, cpuPressureShare: 0.034,
};
const model: HostingAdminFleetCapacity["model"] = {
    cpuPercentile: 50, cpuBurstVcpu: 1.6, memoryBurstBytes: 2.5 * GIB, memoryPercentile: 95, minimumRunningHours: 6, staticBurstVcpuPerServer: 2,
    staticBurstMemoryBytesPerServer: 3 * GIB,
};
const HASWELL = "Intel Core Processor (Haswell, no TSX)";
const EPYC = "AMD EPYC 7282 16-Core Processor";
// Instance type keys: provider, vCPUs, whole GiB, CPU model and MHz rounded to 100.
const SIX_KEY = `ovhcloud-vps|6|12|${HASWELL}|2400`;
const FOUR_KEY = `ovhcloud-vps|4|4|${HASWELL}|2400`;
const MATCH_KEY = `ovhcloud-vps|4|8|${HASWELL}|2400`;
const CONTABO_KEY = `contabo-vps|8|16|${EPYC}|2800`;
// The same types as their row headers describe them.
const SIX_TYPE = `OVHcloud · 6 vCPU · 12.00 GiB · ${HASWELL} · 2,400 MHz`;
const FOUR_TYPE = `OVHcloud · 4 vCPU · 3.82 GiB · ${HASWELL} · 2,400 MHz`;
const CONTABO_TYPE = `Contabo · 8 vCPU · 16.00 GiB · ${EPYC} · 2,795 MHz`;

const empty: Omit<HostingFleetCapacityHost, "serviceName" | "provider" | "regionKeys" | "vCpu" | "slots"> = {
    memoryBytes: null, cpuModel: null, cpuMhz: null, instanceTypeKey: null, occupants: [], steal: null, busyCores: null, cpuPressureShare: null,
    overheadCores: null, overheadMemoryBytes: null, usableCores: null, usableMemoryBytes: null, stableCpuCores: null, peakCpuCores: null, peakMemoryBytes: null,
    demandCpuCores: null, demandMemoryBytes: null, demandSource: "none", modelledServers: null, limitedBy: null, samples: 0, stealHourly: "--".repeat(168), busyHourly: "--".repeat(168),
};
// Listed first in the read but without any samples, so it comes last in its group.
const quiet: HostingFleetCapacityHost = { ...empty, serviceName: "vps-de-quiet.vps.ovh.net", provider: "ovhcloud-vps", regionKeys: ["germany"], vCpu: 4, slots: 2 };
// Room for one more server than its slots; its steal peaks over the cap on Wed 14 Oct 20:00 UTC.
const roomy: HostingFleetCapacityHost = {
    serviceName: "vps-1a2b3c4d.vps.ovh.net", provider: "ovhcloud-vps", regionKeys: ["germany"], vCpu: 6, memoryBytes: 12 * GIB,
    cpuModel: HASWELL, cpuMhz: 2399.996, instanceTypeKey: SIX_KEY, slots: 3,
    occupants: [
        { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Calradia Company", demand: demandOf(1.1, 1_771_674_010) },
        { serverId: "33333333-3333-4333-8333-333333333333", displayName: "Sturgia Nights", demand: noDemand },
        { serverId: "55555555-5555-4555-8555-555555555555", displayName: "Vlandia Rising", demand: demandOf(0.9, null) },
    ],
    steal: { samples: 2016, mean: 0.4, p95: 1.2, max: 6.5 }, busyCores: { samples: 2016, mean: 1.1, p95: 2.4, max: 4.8 }, cpuPressureShare: 0.02,
    overheadCores: 0.35, overheadMemoryBytes: 1_181_116_006, usableCores: 5.58, usableMemoryBytes: 11_703_786_240,
    // Its type's servers peaked at 1.45 cores and 2 GiB, under both burst targets, which it plans.
    stableCpuCores: 0.723, peakCpuCores: 1.45, peakMemoryBytes: 2 * GIB, demandCpuCores: 1.6, demandMemoryBytes: 2.5 * GIB, demandSource: "type",
    modelledServers: 4, limitedBy: "cpu",
    samples: 2016,
    // The first two hours have no data.
    stealHourly: hex(week((hour) => hour < 2 ? null : hour === PEAK ? 255 : 4)),
    busyHourly: hex(week((hour) => hour < 2 ? null : hour === PEAK ? 85 : 30)),
};
// High steal leaves room for fewer servers than its slots.
const risky: HostingFleetCapacityHost = {
    serviceName: "vps-de-risk.vps.ovh.net", provider: "ovhcloud-vps", regionKeys: ["germany"], vCpu: 4, memoryBytes: 4 * GIB,
    cpuModel: HASWELL, cpuMhz: 2399.996, instanceTypeKey: FOUR_KEY, slots: 2,
    occupants: [
        { serverId: "77777777-7777-4777-8777-777777777777", displayName: "Battania Woods", demand: demandOf(1.5, 2.5 * GIB) },
        { serverId: "88888888-8888-4888-8888-888888888888", displayName: "Khuzait Plains", demand: demandOf(1.3, 2 * GIB) },
    ],
    steal: { samples: 2016, mean: 1.8, p95: 3.4, max: 12.5 }, busyCores: { samples: 2016, mean: 2.1, p95: 3.1, max: 3.9 }, cpuPressureShare: 0.1,
    overheadCores: 0.4, overheadMemoryBytes: 858_993_459, usableCores: 3.46, usableMemoryBytes: 3_435_973_837,
    stableCpuCores: 0.723, peakCpuCores: 1.45, peakMemoryBytes: 2 * GIB, demandCpuCores: 1.6, demandMemoryBytes: 2.5 * GIB, demandSource: "fleet",
    modelledServers: 1,
    limitedBy: "memory", samples: 2016,
    stealHourly: hex(week(() => 60)), busyHourly: hex(week(() => 70)),
};
const matching: HostingFleetCapacityHost = {
    ...risky, serviceName: "vps-uk-match.vps.ovh.net", regionKeys: ["united-kingdom"], memoryBytes: 8 * GIB, instanceTypeKey: MATCH_KEY,
    occupants: [{ serverId: "44444444-4444-4444-8444-444444444444", displayName: "Lone Wolf", demand: demandOf(0.6, GIB) }],
    steal: { samples: 2016, mean: 0.1, p95: 0.2, max: 0.9 }, demandSource: "type", modelledServers: 2, limitedBy: "cpu",
    stealHourly: hex(week(() => 1)), busyHourly: hex(week(() => 20)),
};
// Its first observation with counters has arrived, but no interval yet, so it is not modelled.
const contabo: HostingFleetCapacityHost = {
    ...empty, serviceName: "vmi123456.contaboserver.net", provider: "contabo-vps", regionKeys: ["germany"], vCpu: 8, slots: 4,
    memoryBytes: 16 * GIB, cpuModel: EPYC, cpuMhz: 2794.748, instanceTypeKey: CONTABO_KEY,
    occupants: [{ serverId: "99999999-9999-4999-8999-999999999999", displayName: "Aserai Sands", demand: demandOf(1.4, 2 * GIB) }],
    samples: 1,
};
const spare: HostingFleetCapacityHost = { ...empty, serviceName: "vps-spare", provider: "ovhcloud-vps", regionKeys: [], vCpu: 4, slots: 2 };

const ovhSix: HostingFleetCapacityInstanceType = {
    key: SIX_KEY, provider: "ovhcloud-vps", vCpu: 6, memoryBytes: 12 * GIB, cpuModel: HASWELL, cpuMhz: 2399.996,
    hosts: 3, servers: 4, demand: fleetDemand, steal: { samples: 6048, mean: 0.4, p95: 1.2, max: 6.5 }, modelledServers: 4, demandSource: "type",
};
// Its MemTotal, the median of its VPSs', is not a whole GiB, as a real VPS's never is.
const ovhFour: HostingFleetCapacityInstanceType = {
    ...ovhSix, key: FOUR_KEY, vCpu: 4, memoryBytes: Math.round(3.82 * GIB), hosts: 1, servers: 2, demand: demandOf(1.5, 2.5 * GIB),
    steal: { samples: 2016, mean: 1.8, p95: 3.4, max: 12.5 }, modelledServers: 1, demandSource: "fleet",
};
const contaboEight: HostingFleetCapacityInstanceType = {
    key: CONTABO_KEY, provider: "contabo-vps", vCpu: 8, memoryBytes: 16 * GIB, cpuModel: EPYC, cpuMhz: 2794.748,
    hosts: 1, servers: 1, demand: noDemand, steal: null, modelledServers: null, demandSource: "none",
};

const capacity: HostingAdminFleetCapacity = {
    generatedAt: "2026-10-19T00:07:31.552Z", windowStartedAt: "2026-10-12T00:00:00.000Z", windowEndedAt: "2026-10-19T00:00:00.000Z", hours: 168,
    model,
    fleet: { hosts: 6, servers: 7, demand: fleetDemand },
    providers: [
        { provider: "ovhcloud-vps", hosts: 5, servers: 6, demand: fleetDemand, steal: { samples: 10_080, mean: 0.4, p95: 1.2, max: 6.5 }, busyCores: { samples: 10_080, mean: 1.1, p95: 2.4, max: 4.8 } },
        { provider: "contabo-vps", hosts: 1, servers: 1, demand: demandOf(1.4, 2 * GIB), steal: null, busyCores: null },
    ],
    instanceTypes: [ovhSix, ovhFour, contaboEight],
    hosts: [quiet, roomy, risky, matching, contabo, spare],
};
// The first read after the backend deploys: VPSs and servers, and nothing measured yet.
const blank: HostingAdminFleetCapacity = {
    ...capacity,
    fleet: { hosts: 2, servers: 0, demand: noDemand },
    providers: [{ provider: "ovhcloud-vps", hosts: 2, servers: 0, demand: noDemand, steal: null, busyCores: null }],
    instanceTypes: [{ ...ovhSix, hosts: 2, servers: 0, demand: noDemand, steal: null, modelledServers: null, demandSource: "none" }],
    hosts: [quiet, spare],
};
const hints = fleetCapacityHints(model);
/** Slot sizing for two of the VPSs: one grows, one is unmeasured. */
const sizing: HostingAdminSlotSizing = {
    generatedAt: "2026-10-19T00:07:40.123Z",
    model: { cpuShortageBudgetCoreHoursPerWeek: 1, memoryOverflowShare: 0.01, cpuBurstVcpu: 1.6, memoryBurstBytes: 2.5 * GIB, historyDays: 28, halfLifeDays: 14,
        minimumObservedDays: 7, maximumSlots: 32, typicalWeeklyOnlineHours: 41.37, capacityErrorCode: null },
    hosts: [
        { serviceName: "vps-1a2b3c4d.vps.ovh.net", provider: "ovhcloud-vps", regionKeys: ["germany"], vCpu: 6, slots: 3, occupants: 3, acceptsRelocations: true,
            usableCores: 5.58, coresSource: "measured", usableMemoryBytes: 11_703_786_240, memorySource: "measured", memoryBytesPerServer: 2.5 * GIB,
            recommendedSlots: 5, reason: "cpu", expectedShortageCoreHoursPerWeek: 0.842, withinCpuBudget: true, memoryOverflowShare: 0.0021,
            withinMemoryBudget: true, serversToMove: 0, freeRecommendedSlots: 2 },
        { serviceName: "vps-spare", provider: "ovhcloud-vps", regionKeys: [], vCpu: 4, slots: 2, occupants: 0, acceptsRelocations: true, usableCores: null,
            coresSource: "none", usableMemoryBytes: null, memorySource: "none", memoryBytesPerServer: 2.5 * GIB, recommendedSlots: null, reason: "unmeasured",
            expectedShortageCoreHoursPerWeek: null, withinCpuBudget: null, memoryOverflowShare: null, withinMemoryBudget: null, serversToMove: 0,
            freeRecommendedSlots: 0 },
    ],
    regions: [{ regionKey: "germany", serversToMove: 0, freeRecommendedSlots: 2, shortfallServers: 0 }],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    mocks.request.mockResolvedValue(capacity);
    mocks.sizing.mockResolvedValue(sizing);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

/** Opens the view and lets its read on opening finish. */
async function open() {
    await act(async () => root.render(<FleetCapacityView />));
    await settle();
}

async function settle() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function calls() {
    return mocks.request.mock.calls.map(([request]) => request as { operation: string; input: unknown });
}

function button(text: string, scope: ParentNode = container) {
    return [...scope.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;
}

/** The capacity read's own panes: every section but slot sizing, which has its own read. */
function capacityPanes() {
    return container.querySelectorAll('section:not([aria-label="Slot sizing"])');
}

function pane(title: string) {
    return [...container.querySelectorAll("section")].find((section) => section.querySelector("h2")?.textContent === title)!;
}

/** A table row by the start of its row header, and its data cells' text. */
function tableRow(title: string, name: string) {
    return [...pane(title).querySelectorAll("tbody tr")].find((row) => row.querySelector('th[scope="row"]')?.textContent?.startsWith(name))!;
}

function cellTexts(row: Element) {
    return [...row.querySelectorAll(":scope > td")].map((cell) => cell.textContent);
}

/** An instance type's row by its description, which titles its row header. */
function typeRow(description: string) {
    return [...pane("Instance types").querySelectorAll("tbody tr")].find((row) => row.querySelector('th[scope="row"]')?.getAttribute("title") === description)!;
}

/** Every title and ARIA attribute value on the tab. */
function describingAttributes() {
    return [container, ...container.querySelectorAll("*")].flatMap((element) =>
        [...element.attributes].filter((attribute) => attribute.name === "title" || attribute.name.startsWith("aria-")).map((attribute) => attribute.value));
}

/** A VPS row by its short name. */
function hostRow(name: string) {
    return [...pane("VPSs").querySelectorAll("tbody tr")].find((row) => row.querySelector('th[scope="row"] p')?.textContent === name)!;
}

/** A VPS's steal and busy strips, and their cells. */
function strips(name: string) {
    const [steal, busy] = [...hostRow(name).querySelectorAll<HTMLElement>('[role="img"]')];
    const cells = (strip: HTMLElement) => [...strip.querySelectorAll<HTMLElement>(":scope > span > span")];
    return { steal: steal!, busy: busy!, stealCells: cells(steal!), busyCells: cells(busy!) };
}

function tooltipOf(trigger: HTMLElement) {
    return document.getElementById(trigger.getAttribute("aria-describedby")!)!;
}

const NO_DATA = "—No data yet";

it("reads fleet capacity once when it opens and says what it measured", async () => {
    await open();
    expect(calls()).toEqual([expect.objectContaining({ operation: "fleet-capacity", input: {}, accessToken: "test-only" })]);
    const header = pane("Fleet capacity");
    expect(header.textContent).toContain("Measured over the last 7 days");
    expect(header.textContent).toContain("How much CPU and memory a game server needs while it runs");
    expect(header.textContent).toContain("Measured 12 Oct 00:00 – 19 Oct 00:00 UTC · 7 servers on 6 VPSs · generated");
    expect(header.querySelector('time[datetime="2026-10-19T00:07:31.552Z"]')).not.toBeNull();
    expect(header.textContent).not.toContain("Not enough data yet");
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual(["Fleet capacity", "What a server needs", "Providers", "Instance types", "Slot sizing", "VPSs"]);
    // Kept while the tab stays open: nothing reads it again by itself.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(calls()).toHaveLength(1);
});

it("shows what a server needs and compares it with the static rule", async () => {
    await open();
    const needs = pane("What a server needs");
    const tiles = [...needs.querySelectorAll("dl > div")].map((tile) => [tile.querySelector("dt button")!.textContent, tile.querySelector("dd")!.textContent]);
    expect(tiles).toEqual([
        ["CPU p50", "0.85 cores"], ["CPU p95", "1.20 cores"], ["CPU max", "1.95 cores"], ["Running server-hours", "412.5 server-h"],
        ["Memory p50", "1.40 GiB"], ["Memory p95", "1.80 GiB"], ["Memory max", "2.00 GiB"], ["Throttled", "1.2%"],
    ]);
    expect(needs.textContent).toContain("Today's static rule reserves 2 vCPU · 3 GiB per server. A running server uses 0.85 cores at p50 (43% of 2 vCPU) and 1.80 GiB at p95 (60% of 3 GiB). Every online server is planned to burst to 1.6 vCPU and 2.5 GiB at once, or to its VPS's measured peaks where higher; the fleet's highest CPU peak is 1.950 cores, so VPSs plan from 1.600 cores to 1.950 cores per server (98% of 2 vCPU at most), and no memory peak is above its target (the fleet's highest is 2.00 GiB), so every VPS plans 2.50 GiB per server (83% of 3 GiB); each VPS's own is in its per-server column.");
});

it("compares providers' steal and per-server needs", async () => {
    await open();
    expect(cellTexts(tableRow("Providers", "OVHcloud"))).toEqual(["5", "6", "0.4%", "1.2%", "6.5%", "0.85 cores", "1.20 cores", "1.80 GiB"]);
    expect(cellTexts(tableRow("Providers", "Contabo"))).toEqual(["1", "1", NO_DATA, NO_DATA, NO_DATA, "0.70 cores", "1.40 cores", "2.00 GiB"]);
});

it("models each instance type against its static slots", async () => {
    await open();
    expect([...pane("Instance types").querySelectorAll('tbody th[scope="row"]')].map((name) => [name.textContent, name.getAttribute("title")])).toEqual([
        ["OVHcloud", SIX_TYPE], ["OVHcloud", FOUR_TYPE], ["Contabo", CONTABO_TYPE],
    ]);
    expect(cellTexts(typeRow(SIX_TYPE))).toEqual(["6", "12.00 GiB", HASWELL, "2,400 MHz", "3", "4", "0.85 cores", "1.20 cores", "1.80 GiB", "1.2%", "4 / 3 slotsHeadroom +1", "Type"]);
    expect(cellTexts(typeRow(FOUR_TYPE))).toEqual(["4", "3.82 GiB", HASWELL, "2,400 MHz", "1", "2", "0.75 cores", "1.50 cores", "2.50 GiB", "3.4%", "1 / 2 slotsAt risk −1", "Fleet"]);
    // A row's title says its RAM, CPU model and MHz exactly as its cells do, even for RAM that is not a whole GiB.
    for (const row of pane("Instance types").querySelectorAll("tbody tr")) {
        const [, , memory, model, mhz] = row.querySelector('th[scope="row"]')!.getAttribute("title")!.split(" · ");
        expect([memory, model, mhz]).toEqual(cellTexts(row).slice(1, 4));
    }
    expect(cellTexts(typeRow(CONTABO_TYPE))).toEqual(["8", "16.00 GiB", EPYC, "2,795 MHz", "1", "1", NO_DATA, NO_DATA, NO_DATA, NO_DATA, `${NO_DATA} / 4 slots`, "None yet"]);
});

it("groups VPSs by provider then region, with VPSs without data last", async () => {
    await open();
    const vpss = pane("VPSs");
    expect([...vpss.querySelectorAll('th[scope="rowgroup"]')].map((heading) => heading.textContent)).toEqual(["Contabo · Germany", "OVHcloud · Germany", "OVHcloud · United Kingdom", "OVHcloud · No region"]);
    expect([...vpss.querySelectorAll('tbody th[scope="row"] > div > p:first-child')].map((name) => name.textContent)).toEqual([
        "vmi123456.contaboserver.net", "vps-1a2b3c4d", "vps-de-risk", "vps-de-quiet", "vps-uk-match", "vps-spare",
    ]);
    expect(hostRow("vps-1a2b3c4d").querySelector("th p")!.getAttribute("title")).toBe("vps-1a2b3c4d.vps.ovh.net");
    expect(hostRow("vps-de-quiet").querySelector("th")!.textContent).toContain("0 servers · 2 slots · no data yet");
    expect(hostRow("vps-spare").querySelector("th")!.textContent).toContain(`4 vCPU · RAM unknownCPU model unknown${NO_DATA}`);
    // One observation with counters but no interval yet: listed with the measured VPSs, its strips still hatched.
    expect(hostRow("vmi123456.contaboserver.net").querySelector("th")!.textContent).not.toContain("no data yet");
    expect(strips("vmi123456.contaboserver.net").steal.getAttribute("aria-label")).toBe("vmi123456.contaboserver.net steal by hour: no data yet");
});

it("shows each VPS's figures and its servers' own needs", async () => {
    await open();
    const row = hostRow("vps-1a2b3c4d");
    const name = row.querySelector("th")!;
    expect(name.textContent).toContain("6 vCPU · 12.0 GiB RAM");
    expect(name.textContent).toContain(`${HASWELL}2,400 MHz`);
    expect(name.textContent).toContain("3 servers · 3 slots");
    expect([...name.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
        "Calradia Company0.55 cores stable (p50), peak 1.10 · 1.65 GiB at p95, peak 1.65", "Sturgia Nightsno data yet",
        "Vlandia Rising0.45 cores stable (p50), peak 0.90 · memory —",
    ]);
    expect(cellTexts(row).slice(0, 7)).toEqual(["4 / 3 slotsHeadroom +1", "CPU", "0.4% · 1.2% · 6.5%", "2.40 coresof 6 vCPU", "0.35 cores1.10 GiB", "5.58 cores10.90 GiB",
        "1.600 cores2.50 GiBType · 1.6 vCPU, 2.5 GiB burst · peaks 1.450 cores, 2.00 GiB"]);
    expect(cellTexts(hostRow("vps-de-risk")).slice(0, 3)).toEqual(["1 / 2 slotsAt risk −1", "Memory", "1.8% · 3.4% · 12.5%"]);
    expect(cellTexts(hostRow("vps-spare")).slice(0, 7)).toEqual([`${NO_DATA} / 2 slots`, NO_DATA, NO_DATA, `${NO_DATA}of 4 vCPU`, `${NO_DATA}${NO_DATA}`, `${NO_DATA}${NO_DATA}`, `${NO_DATA}${NO_DATA}None yet`]);
});

it("shows a clock of 0 MHz as unknown on a VPS and an instance type", async () => {
    mocks.request.mockResolvedValueOnce({
        ...capacity,
        instanceTypes: [{ ...ovhSix, key: `ovhcloud-vps|6|12|${HASWELL}|0`, cpuMhz: 0 }, ovhFour, contaboEight],
        hosts: capacity.hosts.map((host) => host === roomy ? { ...roomy, cpuMhz: 0, instanceTypeKey: `ovhcloud-vps|6|12|${HASWELL}|0` } : host),
    });
    await open();
    expect(cellTexts(typeRow(`OVHcloud · 6 vCPU · 12.00 GiB · ${HASWELL} · MHz unknown`))[3]).toBe(NO_DATA);
    const name = hostRow("vps-1a2b3c4d").querySelector("th")!.textContent!;
    expect(name).toContain(`${HASWELL}${NO_DATA}`);
    expect(name).not.toContain("0 MHz");
    // A known clock still reads in MHz.
    expect(cellTexts(typeRow(FOUR_TYPE))[3]).toBe("2,400 MHz");
    expect(hostRow("vps-de-risk").querySelector("th")!.textContent).toContain(`${HASWELL}2,400 MHz`);
});

it("says which VPSs lack host metrics, with a header note, even when the fleet has enough demand data", async () => {
    // contabo reports its servers' counters but no host interval yet; quiet and spare report nothing.
    await open();
    const header = pane("Fleet capacity");
    const notes = [...header.querySelectorAll("p.border-l-2")].map((note) => note.textContent);
    expect(notes).toEqual(["Host metrics not measured yet on 3 of 6 VPSs: their runners have not reported host counters in the window, so their steal, busy cores, overhead, usable capacity and servers at once show — even where their servers' own needs are measured."]);
    const missing = (name: string) => hostRow(name).querySelector("th")!.textContent!.includes("Host metrics not measured yet");
    expect(["vmi123456.contaboserver.net", "vps-de-quiet", "vps-spare"].map(missing)).toEqual([true, true, true]);
    expect(["vps-1a2b3c4d", "vps-de-risk", "vps-uk-match"].map(missing)).toEqual([false, false, false]);
    expect(cellTexts(hostRow("vmi123456.contaboserver.net")).slice(0, 6)).toEqual([`${NO_DATA} / 4 slots`, NO_DATA, NO_DATA, `${NO_DATA}of 8 vCPU`, `${NO_DATA}${NO_DATA}`, `${NO_DATA}${NO_DATA}`]);

    // With host metrics everywhere there is no host note and no per-VPS line.
    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.request.mockResolvedValueOnce({ ...capacity, hosts: [roomy, risky, matching] });
    await open();
    expect(pane("Fleet capacity").querySelectorAll("p.border-l-2")).toHaveLength(0);
    expect(pane("VPSs").textContent).not.toContain("Host metrics not measured yet");
});

it("names every provider the control plane knows, the manual-entry ones included", async () => {
    const hosthatch: HostingFleetCapacityHost = { ...matching, serviceName: "hh-ams-1", provider: "hosthatch-vps", regionKeys: ["netherlands"], instanceTypeKey: null,
        occupants: [{ serverId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Dutch Courage", demand: demandOf(0.8, GIB) }] };
    const vpstc: HostingFleetCapacityHost = { ...matching, serviceName: "vpstc-ist-1", provider: "vpstc-vps", regionKeys: ["turkiye"], instanceTypeKey: null,
        occupants: [{ serverId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", displayName: "Bosphorus", demand: demandOf(0.8, GIB) }] };
    mocks.request.mockResolvedValueOnce({
        ...capacity,
        providers: [...capacity.providers, ...(["hosthatch-vps", "vpstc-vps"] as const).map((provider) => ({ ...capacity.providers[0]!, provider, hosts: 1, servers: 1 }))],
        instanceTypes: [...capacity.instanceTypes, ...(["hosthatch-vps", "vpstc-vps"] as const).map((provider) => ({ ...ovhFour, key: `${provider}|4|8|${HASWELL}|2400`, provider }))],
        hosts: [...capacity.hosts, hosthatch, vpstc],
    });
    await open();
    expect([...pane("Providers").querySelectorAll('tbody th[scope="row"]')].map((name) => name.textContent)).toEqual(["OVHcloud", "Contabo", "HostHatch", "VPS.TC"]);
    expect(typeRow(`HostHatch · 4 vCPU · 3.82 GiB · ${HASWELL} · 2,400 MHz`).querySelector("th")!.textContent).toBe("HostHatch");
    expect(typeRow(`VPS.TC · 4 vCPU · 3.82 GiB · ${HASWELL} · 2,400 MHz`).querySelector("th")!.textContent).toBe("VPS.TC");
    const groups = [...pane("VPSs").querySelectorAll('th[scope="rowgroup"]')].map((heading) => heading.textContent);
    expect(groups).toContain("HostHatch · Netherlands");
    expect(groups).toContain("VPS.TC · Türkiye");
    // No raw provider id anywhere on the tab: not in its text, nor in any title or ARIA attribute, hints included.
    const attributes = describingAttributes();
    expect(attributes.length).toBeGreaterThan(1000);
    for (const id of VPS_PROVIDERS) {
        expect(container.textContent).not.toContain(id);
        expect(attributes.filter((value) => value.includes(id))).toEqual([]);
    }
});

it("rejects a read with a provider the website does not know yet", async () => {
    mocks.request.mockResolvedValueOnce({ ...capacity, hosts: [{ ...roomy, provider: "unknown-provider" }] });
    await open();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("The control plane returned an unexpected fleet capacity. Retry");
});

it("rejects a read with more VPSs than the tab will draw", async () => {
    const hosts = Array.from({ length: 257 }, (_, index) => ({ ...spare, serviceName: `vps-${index}` }));
    mocks.request.mockResolvedValueOnce({ ...capacity, hosts });
    await open();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("The control plane returned an unexpected fleet capacity. Retry");
    expect(capacityPanes()).toHaveLength(1);
});

it("marks VPSs with room for fewer servers than slots apart from those with headroom, not by colour alone", async () => {
    await open();
    const badge = (name: string) => hostRow(name).querySelector("td span[title]");
    expect(hostRow("vps-de-risk").querySelector("th")!.classList.contains("border-l-crimson")).toBe(true);
    expect(badge("vps-de-risk")!.textContent).toBe("At risk −1");
    expect(badge("vps-de-risk")!.getAttribute("title")).toBe("1 fewer than its 2 slots: at risk when every slot's server runs at once.");
    expect(badge("vps-de-risk")!.querySelector("svg")).not.toBeNull();
    expect(hostRow("vps-1a2b3c4d").querySelector("th")!.classList.contains("border-l-emerald-500/60")).toBe(true);
    expect(badge("vps-1a2b3c4d")!.textContent).toBe("Headroom +1");
    expect(badge("vps-uk-match")!.textContent).toBe("Matches");
    expect(hostRow("vps-uk-match").querySelector("th")!.classList.contains("border-l-transparent")).toBe(true);
    // Not modelled yet: no cue at all.
    expect(hostRow("vps-spare").querySelector(".border-crimson\\/40, .border-emerald-500\\/30")).toBeNull();
});

it("draws a week of steal and busy hours per VPS, hatching hours without data", async () => {
    await open();
    const { steal, busy, stealCells, busyCells } = strips("vps-1a2b3c4d");
    expect(stealCells).toHaveLength(168);
    expect(busyCells).toHaveLength(168);
    expect(stealCells[0]!.getAttribute("title")).toBe("Mon 12 Oct 00:00 UTC · no data");
    expect(stealCells[0]!.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(stealCells[0]!.className).not.toMatch(/bg-gold/u);
    expect(stealCells[2]!.getAttribute("title")).toBe("Mon 12 Oct 02:00 UTC · steal 0.4%");
    expect(stealCells[2]!.classList.contains("bg-gold/10")).toBe(true);
    expect(stealCells[2]!.style.backgroundImage).toBe("");
    expect(stealCells[PEAK]!.getAttribute("title")).toBe("Wed 14 Oct 20:00 UTC · steal 25.5% or more");
    expect(stealCells[PEAK]!.classList.contains("bg-gold")).toBe(true);
    expect(busyCells[2]!.getAttribute("title")).toBe("Mon 12 Oct 02:00 UTC · busy 30%");
    expect(busyCells[2]!.classList.contains("bg-gold/40")).toBe(true);
    expect(busyCells[PEAK]!.getAttribute("title")).toBe("Wed 14 Oct 20:00 UTC · busy 85%");
    expect(busyCells[PEAK]!.classList.contains("bg-gold/90")).toBe(true);
    expect(steal.getAttribute("aria-label")).toBe("vps-1a2b3c4d steal by hour: highest 25.5% or more at Wed 14 Oct 20:00 UTC; mean 0.6% over 166 of 168 hours measured");
    expect(busy.getAttribute("aria-label")).toBe("vps-1a2b3c4d busy by hour: highest 85% at Wed 14 Oct 20:00 UTC; mean 30% over 166 of 168 hours measured");
    // 6% steal falls in the 5–7.5% band; a VPS without data is hatched throughout and says so.
    expect(strips("vps-de-risk").stealCells[100]!.classList.contains("bg-gold/60")).toBe(true);
    const spare = strips("vps-spare");
    expect(spare.steal.getAttribute("aria-label")).toBe("vps-spare steal by hour: no data yet");
    expect([...spare.stealCells, ...spare.busyCells].every((cell) => cell.style.backgroundImage.includes("repeating-linear-gradient"))).toBe(true);
    expect(pane("VPSs").textContent).toContain("One cell per UTC hour, oldest first. Steal:0%20% or moreBusy:0%90% or moreNo data");
});

it.each([
    ["00:00", ["Mon 12 Oct", "Tue 13 Oct", "Wed 14 Oct", "Thu 15 Oct", "Fri 16 Oct", "Sat 17 Oct", "Sun 18 Oct"]],
    ["19:00", ["12", "Tue 13 Oct", "Wed 14 Oct", "Thu 15 Oct", "Fri 16 Oct", "Sat 17 Oct", "Sun 18 Oct", "Mon 19 Oct"]],
] as const)("labels the window's real UTC dates over each group's strips from %s", async (start, labels) => {
    mocks.request.mockResolvedValueOnce({ ...capacity, windowStartedAt: `2026-10-12T${start}:00.000Z`, windowEndedAt: `2026-10-19T${start}:00.000Z` });
    await open();
    const axis = pane("VPSs").querySelector("tbody tr td")!;
    expect([...axis.querySelectorAll("span[title]")].map((day) => day.textContent)).toEqual(labels);
    expect(strips("vps-1a2b3c4d").stealCells[0]!.getAttribute("title")).toBe(`Mon 12 Oct ${start} UTC · no data`);
});

it("explains each figure in a tooltip that keyboard and pointer users can reach", async () => {
    await open();
    const providers = pane("Providers");
    const tooltips = [...container.querySelectorAll<HTMLElement>('[role="tooltip"]')];
    expect(tooltips.length).toBeGreaterThan(20);
    expect(tooltips.every((tooltip) => tooltip.hidden)).toBe(true);

    const stealHint = button("Steal p95", providers);
    expect(tooltipOf(stealHint).textContent).toBe(hints.stealP95);
    await act(async () => stealHint.focus());
    expect(tooltipOf(stealHint).hidden).toBe(false);
    // In an upper-case table header the hint still reads as a sentence.
    expect(tooltipOf(stealHint).classList.contains("normal-case")).toBe(true);
    await act(async () => { stealHint.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(tooltipOf(stealHint).hidden).toBe(true);

    // A tap opens one, and opening another closes it.
    const mean = button("Steal mean", providers);
    await act(async () => mean.click());
    expect(tooltipOf(mean).hidden).toBe(false);
    expect(tooltipOf(mean).textContent).toBe(hints.steal);
    const throttled = button("Throttled", pane("What a server needs"));
    await act(async () => throttled.click());
    expect(tooltipOf(throttled).hidden).toBe(false);
    expect(tooltipOf(mean).hidden).toBe(true);
    // A resize leaves a hint away from its label, so it closes.
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(tooltipOf(throttled).hidden).toBe(true);

    const vpss = pane("VPSs");
    for (const [label, hint] of [
        ["Servers at once", `${hints.modelled} ${hints.slots}`], ["Busy p95", hints.busyCores], ["Overhead", hints.overhead], ["Usable", hints.usable],
        ["Per server", `${hints.perServer} ${hints.demandSource}`], ["Limited by", hints.limitedBy],
    ] as const) {
        expect(tooltipOf(button(label, vpss)).textContent).toBe(hint);
    }
    // An instance type is never planned from one VPS, so its tooltip names only its own sources.
    expect(tooltipOf(button("Demand source", pane("Instance types"))).textContent).toBe(hints.typeDemandSource);
    expect(hints.typeDemandSource).toContain("Type uses its own servers once they have run 6.0 server-h in the week; Fleet uses the whole fleet's once it has");
    expect(hints.typeDemandSource).not.toContain("This VPS");
    expect(hints.demandSource).toContain("This VPS uses the servers that ran on this VPS once they have run 6.0 server-h there in the week");
    expect(tooltipOf(button("CPU p95", pane("What a server needs"))).textContent).toBe(`${hints.cpu} ${hints.cpuP95}`);
    // Memory is planned at its burst target or its peak, and its p95 shown for comparison; it has no stable use.
    expect(tooltipOf(button("Memory p50", pane("What a server needs"))).textContent).toBe(`${hints.memory} ${hints.p50}`);
    expect(tooltipOf(button("Memory p95", pane("What a server needs"))).textContent).toBe(`${hints.memory} ${hints.p95}`);
    expect(tooltipOf(button("Memory p95", pane("Providers"))).textContent).toBe(`${hints.memory} ${hints.p95}`);
    expect(`${hints.p50} ${hints.p95}`).not.toContain("stable");
    expect(hints.memory).toContain("The model plans memory at the 2.5 GiB burst target, or the peak where higher.");
    expect(hints.p95).toContain("shown for comparison; the model does not plan memory from it");
    expect(hints.max).toContain("Each VPS plans the peak of its own demand source (its own servers, its instance type or the fleet) where that is above the 2.5 GiB target");
    expect(tooltipOf(button("Per server", pane("VPSs"))).textContent).toContain("1.6 vCPU and 2.5 GiB, or the peak CPU and memory of the source shown where higher.");
    expect(tooltipOf(button("CPU p50", pane("What a server needs"))).textContent).toContain("a server's stable CPU use, shown for comparison");
    // The CPU peak is what the model plans above the target, and says it is a 5-minute mean; memory's is plain.
    expect(tooltipOf(button("CPU max", pane("What a server needs"))).textContent).toBe(`${hints.cpu} ${hints.cpuMax}`);
    expect(hints.cpuMax).toContain("so shorter spikes are averaged in");
    expect(tooltipOf(button("Memory max", pane("What a server needs"))).textContent).toBe(`${hints.memory} ${hints.max}`);
});

it("plans each VPS from its own servers when they have run long enough, at their peak above the target", async () => {
    const own: HostingFleetCapacityHost = { ...roomy, demandSource: "vps", stableCpuCores: 0.9, peakCpuCores: 1.9, demandCpuCores: 1.9 };
    mocks.request.mockResolvedValue({ ...capacity, hosts: [own] });
    await open();
    expect(cellTexts(hostRow("vps-1a2b3c4d"))[6]).toBe("1.900 cores2.50 GiBThis VPS · 2.5 GiB burst · peaks 1.900 cores, 2.00 GiB");
    // A working set that peaked above the memory target plans that peak.
    const heavy: HostingFleetCapacityHost = { ...own, peakMemoryBytes: 2.75 * GIB, demandMemoryBytes: 2.75 * GIB };
    mocks.request.mockResolvedValue({ ...capacity, hosts: [heavy] });
    await act(async () => button("Refresh").click());
    await settle();
    expect(cellTexts(hostRow("vps-1a2b3c4d"))[6]).toBe("1.900 cores2.75 GiBThis VPS · peaks 1.900 cores, 2.75 GiB");
});

it("still shows the current control plane's read, which plans memory at its p95 without a memory burst target", async () => {
    // Its model has no memoryBurstBytes and its VPSs no peakMemoryBytes, and each VPS plans its source's p95 working set.
    const currentModel: Partial<HostingAdminFleetCapacity["model"]> = { ...model };
    delete currentModel.memoryBurstBytes;
    const currentHosts = capacity.hosts.map((entry) => {
        const copy: Partial<HostingFleetCapacityHost> = { ...entry, demandMemoryBytes: entry.demandSource === "none" ? null : 1_932_735_283 };
        delete copy.peakMemoryBytes;
        return copy;
    });
    mocks.request.mockResolvedValue({ ...capacity, model: currentModel, hosts: currentHosts });
    await open();
    const needs = pane("What a server needs");
    expect(needs.textContent).toContain("Every online server is planned to burst to 1.6 vCPU at once, or to its VPS's measured peak where higher. The fleet's highest peak is 1.950 cores, so VPSs plan from 1.600 cores to 1.950 cores per server (98% of 2 vCPU at most); each VPS's own is in its per-server column.");
    expect(needs.textContent).not.toContain("2.5 GiB");
    const row = hostRow("vps-1a2b3c4d");
    expect([...row.querySelector("th")!.querySelectorAll("li")].map((item) => item.textContent)[0]).toBe("Calradia Company0.55 cores stable (p50), peak 1.10 · 1.65 GiB at p95");
    expect(cellTexts(row)[6]).toBe("1.600 cores1.80 GiBType · 1.6 vCPU burst · peak 1.450");
    // Its memory tooltips say that the p95 is planned.
    const p95 = tooltipOf(button("Memory p95", needs)).textContent;
    expect(p95).toContain("The model sizes servers at this level");
    expect(p95).not.toContain("burst target");
});

it("no longer shows a read from before the CPU burst target, which no control plane sends now", async () => {
    const earlierModel: Partial<HostingAdminFleetCapacity["model"]> = { ...model, cpuPercentile: 95 };
    delete earlierModel.cpuBurstVcpu;
    delete earlierModel.memoryBurstBytes;
    const earlierHosts = capacity.hosts.map((entry) => {
        const copy: Partial<HostingFleetCapacityHost> = { ...entry };
        delete copy.stableCpuCores;
        delete copy.peakCpuCores;
        delete copy.peakMemoryBytes;
        return copy;
    });
    mocks.request.mockResolvedValue({ ...capacity, model: earlierModel, hosts: earlierHosts });
    await open();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("The control plane returned an unexpected fleet capacity. Retry");
});

it("says there is not enough data yet instead of looking broken before the first samples", async () => {
    mocks.request.mockResolvedValueOnce(blank);
    await open();
    expect(pane("Fleet capacity").textContent).toContain("Not enough data yet: no resource samples have arrived.");
    expect([...pane("Fleet capacity").querySelectorAll("p.border-l-2")]).toHaveLength(1);
    const needs = pane("What a server needs");
    expect([...needs.querySelectorAll("dd")].map((value) => value.textContent)).toEqual([NO_DATA, NO_DATA, NO_DATA, "0.0 server-h", NO_DATA, NO_DATA, NO_DATA, NO_DATA]);
    expect(needs.textContent).toContain("There is not enough data yet to compare it with what servers use.");
    expect(cellTexts(tableRow("Providers", "OVHcloud"))).toEqual(["2", "0", NO_DATA, NO_DATA, NO_DATA, NO_DATA, NO_DATA, NO_DATA]);
    expect(cellTexts(tableRow("Instance types", "OVHcloud")).slice(-2)).toEqual([`${NO_DATA} / 3 slots`, "None yet"]);
    // No verdict on the capacity panes; slot sizing has its own badges.
    expect([...capacityPanes()].some((section) => section.querySelector(".border-crimson\\/40, .border-emerald-500\\/30") !== null)).toBe(false);
    expect(strips("vps-de-quiet").busy.getAttribute("aria-label")).toBe("vps-de-quiet busy by hour: no data yet");
});

it("says while the fleet has less running data than an instance type needs", async () => {
    mocks.request.mockResolvedValueOnce({ ...capacity, fleet: { ...capacity.fleet, demand: { ...fleetDemand, runningServerHours: 3.25 } } });
    await open();
    expect(pane("Fleet capacity").textContent).toContain("Not enough data yet: the fleet has 3.3 server-h of running data, and the model plans with a VPS's own servers', an instance type's or the whole fleet's figures only once it has 6.0 server-h. Until then no VPS is modelled");
    expect(pane("What a server needs").textContent).toContain("1.20 cores");
});

it("says when the control plane reports no VPSs", async () => {
    mocks.request.mockResolvedValueOnce({ ...blank, fleet: { hosts: 0, servers: 0, demand: noDemand }, providers: [], instanceTypes: [], hosts: [] });
    await open();
    expect(pane("VPSs").textContent).toContain("The control plane reports no VPSs.");
    expect(pane("Providers").textContent).toContain("No provider has VPSs in the read yet.");
    expect(pane("Instance types").textContent).toContain("No instance types in the read yet.");
});

it("shows a loading state, then refreshes on request without stacking reads", async () => {
    let finish: ((value: unknown) => void) | null = null;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await open();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Loading fleet capacity…");
    expect(button("Refresh").disabled).toBe(true);
    expect(capacityPanes()).toHaveLength(1);
    await act(async () => finish!(capacity));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(button("Refresh").disabled).toBe(false);

    let finishRefresh: ((value: unknown) => void) | null = null;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    await act(async () => button("Refresh").click());
    // What it showed stays while the refresh is under way, and a second Refresh starts nothing.
    expect(button("Refresh").disabled).toBe(true);
    expect(hostRow("vps-1a2b3c4d")).toBeDefined();
    await act(async () => button("Refresh").click());
    expect(calls()).toHaveLength(2);
    await act(async () => finishRefresh!(capacity));
    expect(button("Refresh").disabled).toBe(false);
    expect(hostRow("vps-1a2b3c4d")).toBeDefined();
});

it.each([
    [new ControlPlaneAdminError("rate_limited", "Too many requests.", true), "You can read fleet capacity six times every five minutes. Wait a few minutes, then refresh."],
    [new ControlPlaneAdminError("invalid_request", "Invalid request.", false), "This control plane does not report fleet capacity yet."],
    [new ControlPlaneAdminError("capacity_history_unavailable", "Capacity history is unavailable.", true), "Capacity history is unavailable."],
] as const)("explains a failed read and retries it: %s", async (error, message) => {
    mocks.request.mockRejectedValueOnce(error);
    await open();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(`${message} Retry`);
    expect(capacityPanes()).toHaveLength(1);
    await act(async () => button("Retry").click());
    await settle();
    expect(calls()).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(hostRow("vps-1a2b3c4d")).toBeDefined();
});

it("keeps what it showed when a refresh fails, and rejects a malformed read", async () => {
    await open();
    mocks.request.mockRejectedValueOnce(new ControlPlaneAdminError("rate_limited", "Too many requests.", true));
    await act(async () => button("Refresh").click());
    await settle();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("six times every five minutes");
    expect(hostRow("vps-1a2b3c4d")).toBeDefined();

    mocks.request.mockResolvedValueOnce({ ...capacity, hours: 24 });
    await act(async () => button("Retry").click());
    await settle();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("The control plane returned an unexpected fleet capacity. Retry");
    expect(hostRow("vps-1a2b3c4d")).toBeDefined();
});

it("reads slot sizing beside fleet capacity and shows it just above the VPSs, with its own reads", async () => {
    await open();
    expect(mocks.sizing.mock.calls.map(([request]) => request)).toEqual([expect.objectContaining({ operation: "slot-sizing", input: {}, accessToken: "test-only" })]);
    expect(calls()).toHaveLength(1);
    const sections = [...container.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"));
    expect(sections.slice(-2)).toEqual(["Slot sizing", "VPSs"]);
    const slotSizing = container.querySelector('section[aria-label="Slot sizing"]')!;
    expect(slotSizing.textContent).toContain("Recommendations only · nothing is applied");
    expect(slotSizing.querySelector("tbody tr th[scope=\"row\"] p")!.textContent).toBe("vps-1a2b3c4d");
    // Refreshing the capacity read leaves slot sizing, with its own budget, alone.
    await act(async () => button("Refresh").click());
    await settle();
    expect(calls()).toHaveLength(2);
    expect(mocks.sizing).toHaveBeenCalledTimes(1);
});

it("keeps the rest of the tab working on a control plane without slot sizing", async () => {
    // Control plane main rejects the operation it does not know as an invalid request.
    mocks.sizing.mockRejectedValue(new ControlPlaneAdminError("invalid_request", "The control plane request is invalid.", false));
    await open();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('section[aria-label="Slot sizing"]')!.textContent).toContain("Slot sizing is not available on this control plane yet.");
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual(["Fleet capacity", "What a server needs", "Providers", "Instance types", "Slot sizing", "VPSs"]);
    expect(hostRow("vps-1a2b3c4d")).toBeDefined();
    expect(pane("Fleet capacity").textContent).not.toContain("not available");
});

it("still shows slot sizing when the capacity read fails", async () => {
    mocks.request.mockRejectedValueOnce(new ControlPlaneAdminError("capacity_history_unavailable", "Capacity history is unavailable.", true));
    await open();
    expect(pane("Fleet capacity").querySelector('[role="alert"]')!.textContent).toBe("Capacity history is unavailable. Retry");
    expect(capacityPanes()).toHaveLength(1);
    expect(container.querySelector('section[aria-label="Slot sizing"] table')).not.toBeNull();
});

// A control plane that fits on typical demand (#550), in model-v2 §4's shape.
const typicalModel: HostingAdminFleetCapacity["model"] = {
    ...model, cpuTypicalPercentile: 95, stealPercentile: 50, stealFloorThresholdPercent: 5, concurrentBusyFraction: 0.5, concurrentHourShare: 0.01,
};
// Its type's servers usually need 1.2 cores (p95), under the 1.6 vCPU target, which it is fitted at. Less its 0.3% steal
// p50 and overhead, 5.632 usable cores run 3 at once, its slots; Sturgia Nights has no data, so it counts as always online.
const typicalRoomy: HostingFleetCapacityHost = {
    ...roomy, steal: { ...roomy.steal!, p50: 0.3 }, busyCores: { ...roomy.busyCores!, p50: 1 }, effectiveVcpu: 5.982, usableCores: 5.632,
    typicalCpuCores: 1.2, demandCpuCores: 1.6, burstCpuCores: 1.6, burstServers: 3, modelledServers: 3, limitedBy: "cpu",
    concurrentServers: 3, concurrentSource: "worst-case-occupants", concurrentCoverage: 0.6, verdict: { kind: "matches", servers: 0 },
};
// Its memory holds one server at 2.5 GiB, the static floor too, while both of its servers are online together.
const typicalRisky: HostingFleetCapacityHost = {
    ...risky, steal: { ...risky.steal!, p50: 1.8 }, busyCores: { ...risky.busyCores!, p50: 2 }, effectiveVcpu: 3.928, usableCores: 3.528,
    typicalCpuCores: 1.2, demandCpuCores: 1.6, burstCpuCores: 1.6, burstServers: 1, modelledServers: 1, limitedBy: "memory",
    concurrentServers: 2, concurrentSource: "measured", concurrentCoverage: 1, verdict: { kind: "at-risk", servers: 1 },
};
// Raised to 6 slots and full: three servers by day and three by night, so 3 are co-online and it runs 3 at once.
const dayNightHost: HostingFleetCapacityHost = {
    ...typicalRoomy, serviceName: "vps-de-daynight.vps.ovh.net", slots: 6,
    occupants: Array.from({ length: 6 }, (_, index) => ({ serverId: `server-${index}`, displayName: `Shift ${index}`, demand: demandOf(1.1, 1_771_674_010) })),
    concurrentServers: 3, concurrentSource: "measured", concurrentCoverage: 0.98,
};
const typicalSpare: HostingFleetCapacityHost = {
    ...spare, effectiveVcpu: null, typicalCpuCores: null, burstCpuCores: null, burstServers: null,
    concurrentServers: 2, concurrentSource: "slots", concurrentCoverage: 0, verdict: { kind: "unknown", servers: 0 },
};
const typicalSix: HostingFleetCapacityInstanceType = {
    ...ovhSix, steal: { ...ovhSix.steal!, p50: 0.3 }, effectiveVcpu: 5.982, typicalCpuCores: 1.2, burstServers: 3, modelledServers: 3, verdict: { kind: "matches", servers: 0 },
};
const typicalRead: HostingAdminFleetCapacity = {
    ...capacity, model: typicalModel,
    providers: capacity.providers.map((entry) => ({
        ...entry,
        steal: entry.steal === null ? null : { ...entry.steal, p50: 0.3 },
        busyCores: entry.busyCores === null ? null : { ...entry.busyCores, p50: 1 },
    })),
    instanceTypes: [typicalSix], hosts: [typicalRoomy, typicalRisky, dayNightHost, typicalSpare],
};
const typicalHints = fleetCapacityHints(typicalModel);

it("does not relabel an absent nested p99 as p99 when only p95 is available", async () => {
    mocks.request.mockResolvedValue({ ...typicalRead, model: { ...typicalModel, memoryPercentile: 99 } });
    await open();
    for (const title of ["Providers", "Instance types"]) {
        const table = pane(title).querySelector("table")!;
        const headers = [...table.querySelectorAll("thead th")];
        const index = headers.findIndex(header => header.textContent?.includes("Memory p99"));
        expect(index).toBeGreaterThanOrEqual(0);
        for (const row of table.querySelectorAll("tbody tr")) {
            expect(row.children[index]?.textContent).toBe("—");
        }
    }
});

it("shows a control plane's typical fit: what each VPS can run at once against its co-online servers, with burst headroom as information", async () => {
    mocks.request.mockResolvedValue(typicalRead);
    await open();
    expect(pane("What a server needs").textContent).toContain("Each VPS is fitted at what its servers usually need, not at their peaks: CPU at the 1.6 vCPU target, or the p95 of its demand source where higher, at most 2 vCPU (the fleet's p95 is 1.200 cores, which fits at 1.600 cores per server, 80% of 2 vCPU), and memory at 2.5 GiB or the peak where higher, at most 3 GiB;");
    expect(cellTexts(hostRow("vps-1a2b3c4d")).slice(0, 7)).toEqual([
        "Can run 3 at onceco-online 3 (some servers counted as always online) · slots 3MatchesBurst headroom: 3 could burst at once (1.600 cores each)",
        "CPU", "0.3% · 1.2% · 6.5%", "2.40 coresof 6 vCPU", "0.35 cores1.10 GiB", "5.63 cores10.90 GiB5.982 effective vCPU",
        "1.600 cores2.50 GiBType · 1.6 vCPU target (p95 1.200) · 2.5 GiB memory target · peaks 1.450 cores, 2.00 GiB",
    ]);
    expect([...hostRow("vps-1a2b3c4d").querySelector("th")!.querySelectorAll("li")].map((item) => item.textContent)[0])
        .toBe("Calradia Company0.55 cores stable (p50), p95 1.10, peak 1.10 · 1.65 GiB at p95, peak 1.65");
    // The day/night VPS runs its three co-online servers though it has 6 slots: it matches.
    expect(cellTexts(hostRow("vps-de-daynight"))[0]).toBe("Can run 3 at onceco-online 3 · slots 6MatchesBurst headroom: 3 could burst at once (1.600 cores each)");
    expect(cellTexts(hostRow("vps-de-risk"))[0]).toBe("Can run 1 at onceco-online 2 · slots 2At risk −1Burst headroom: 1 could burst at once (1.600 cores each)");
    expect(hostRow("vps-de-risk").querySelector("th")!.classList.contains("border-l-crimson")).toBe(true);
    expect(cellTexts(hostRow("vps-spare"))[0]).toBe("Not modelled yetco-online unmeasured, using slots · slots 2");
    // Steal at its p50, which the model takes off, beside its p95; an instance type's effective vCPU and verdict against its static slots.
    expect(button("Steal p50 · p95 · max", pane("VPSs"))).toBeDefined();
    expect(cellTexts(tableRow("Providers", "OVHcloud")).slice(2, 5)).toEqual(["0.3%", "1.2%", "6.5%"]);
    expect(button("Steal p50", pane("Providers"))).toBeDefined();
    expect(cellTexts(typeRow(SIX_TYPE))).toEqual(["65.982 effective vCPU", "12.00 GiB", HASWELL, "2,400 MHz", "3", "4", "0.85 cores", "1.20 cores", "1.80 GiB", "0.3% · 1.2%",
        "Can run 3 at oncestatic slots 3MatchesBurst headroom: 3 could burst at once", "Type"]);
    expect(tooltipOf(button("Servers at once", pane("VPSs"))).textContent).toBe(`${typicalHints.modelled} ${typicalHints.slots} ${typicalHints.concurrent} ${typicalHints.burst}`);
    expect(tooltipOf(button("Steal p50 · p95 · max", pane("VPSs"))).textContent).toBe(`${typicalHints.steal} ${typicalHints.stealP50} ${typicalHints.stealP95}`);
    expect(tooltipOf(button("Usable", pane("VPSs"))).textContent).toBe(typicalHints.usable);
    expect(tooltipOf(button("Per server", pane("VPSs"))).textContent).toBe(`${typicalHints.perServer} ${typicalHints.demandSource}`);

    // Burst headroom is information: with none, the badge stays.
    mocks.request.mockResolvedValue({ ...typicalRead, hosts: [{ ...dayNightHost, burstServers: 0 }] });
    await act(async () => button("Refresh").click());
    await settle();
    expect(cellTexts(hostRow("vps-de-daynight"))[0]).toBe("Can run 3 at onceco-online 3 · slots 6MatchesBurst headroom: 0 could burst at once (1.600 cores each)");

    // A control plane from before typical demand renders as it does today.
    mocks.request.mockResolvedValue(capacity);
    await act(async () => button("Refresh").click());
    await settle();
    expect(cellTexts(hostRow("vps-1a2b3c4d")).slice(0, 7)).toEqual(["4 / 3 slotsHeadroom +1", "CPU", "0.4% · 1.2% · 6.5%", "2.40 coresof 6 vCPU", "0.35 cores1.10 GiB", "5.58 cores10.90 GiB",
        "1.600 cores2.50 GiBType · 1.6 vCPU, 2.5 GiB burst · peaks 1.450 cores, 2.00 GiB"]);
    expect(button("Steal mean · p95 · max", pane("VPSs"))).toBeDefined();
    expect(pane("What a server needs").textContent).toContain("Every online server is planned to burst to 1.6 vCPU and 2.5 GiB at once, or to its VPS's measured peaks where higher;");
    expect(pane("What a server needs").textContent).not.toContain("usually need");
    expect(tooltipOf(button("Servers at once", pane("VPSs"))).textContent).toBe(`${hints.modelled} ${hints.slots}`);
    expect(pane("VPSs").textContent).not.toMatch(/Burst headroom|co-online|effective vCPU/u);
});
