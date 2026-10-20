import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import { fleetCapacityHints } from "@/app/lib/control-plane/fleet-capacity";
import type {
    HostingAdminFleetCapacity,
    HostingFleetCapacityDemand,
    HostingFleetCapacityHost,
    HostingFleetCapacityInstanceType,
} from "@/app/lib/control-plane/types";
import { FleetCapacityView } from "./FleetCapacityView";

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (original) => ({ ...await original<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: mocks.request }));
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
const model: HostingAdminFleetCapacity["model"] = { cpuPercentile: 95, memoryPercentile: 95, minimumRunningHours: 24, staticBurstVcpuPerServer: 2, staticBurstMemoryBytesPerServer: 3 * GIB };
const HASWELL = "Intel Core Processor (Haswell, no TSX)";

const empty: Omit<HostingFleetCapacityHost, "serviceName" | "provider" | "regionKeys" | "vCpu" | "slots"> = {
    memoryBytes: null, cpuModel: null, cpuMhz: null, instanceTypeKey: null, occupants: [], steal: null, busyCores: null, cpuPressureShare: null,
    overheadCores: null, overheadMemoryBytes: null, usableCores: null, usableMemoryBytes: null, demandCpuCores: null, demandMemoryBytes: null,
    demandSource: "none", modelledServers: null, limitedBy: null, samples: 0, stealHourly: "--".repeat(168), busyHourly: "--".repeat(168),
};
// Listed first in the read but without any samples, so it comes last in its group.
const quiet: HostingFleetCapacityHost = { ...empty, serviceName: "vps-de-quiet.vps.ovh.net", provider: "ovhcloud-vps", regionKeys: ["germany"], vCpu: 4, slots: 2 };
// Room for one more server than its slots; its steal peaks over the cap on Wed 14 Oct 20:00 UTC.
const roomy: HostingFleetCapacityHost = {
    serviceName: "vps-1a2b3c4d.vps.ovh.net", provider: "ovhcloud-vps", regionKeys: ["germany"], vCpu: 6, memoryBytes: 12 * GIB,
    cpuModel: HASWELL, cpuMhz: 2399.996, instanceTypeKey: "ovh-6-12-haswell", slots: 3,
    occupants: [
        { serverId: "22222222-2222-4222-8222-222222222222", displayName: "Calradia Company", demand: demandOf(1.1, 1_771_674_010) },
        { serverId: "33333333-3333-4333-8333-333333333333", displayName: "Sturgia Nights", demand: noDemand },
        { serverId: "55555555-5555-4555-8555-555555555555", displayName: "Vlandia Rising", demand: demandOf(0.9, null) },
    ],
    steal: { samples: 2016, mean: 0.4, p95: 1.2, max: 6.5 }, busyCores: { samples: 2016, mean: 1.1, p95: 2.4, max: 4.8 }, cpuPressureShare: 0.02,
    overheadCores: 0.35, overheadMemoryBytes: 1_181_116_006, usableCores: 5.58, usableMemoryBytes: 11_703_786_240,
    demandCpuCores: 1.2, demandMemoryBytes: 1_932_735_283, demandSource: "type", modelledServers: 4, limitedBy: "cpu", samples: 2016,
    // The first two hours have no data.
    stealHourly: hex(week((hour) => hour < 2 ? null : hour === PEAK ? 255 : 4)),
    busyHourly: hex(week((hour) => hour < 2 ? null : hour === PEAK ? 85 : 30)),
};
// High steal leaves room for fewer servers than its slots.
const risky: HostingFleetCapacityHost = {
    serviceName: "vps-de-risk.vps.ovh.net", provider: "ovhcloud-vps", regionKeys: ["germany"], vCpu: 4, memoryBytes: 4 * GIB,
    cpuModel: HASWELL, cpuMhz: 2399.996, instanceTypeKey: "ovh-4-4-haswell", slots: 2,
    occupants: [
        { serverId: "77777777-7777-4777-8777-777777777777", displayName: "Battania Woods", demand: demandOf(1.5, 2.5 * GIB) },
        { serverId: "88888888-8888-4888-8888-888888888888", displayName: "Khuzait Plains", demand: demandOf(1.3, 2 * GIB) },
    ],
    steal: { samples: 2016, mean: 1.8, p95: 3.4, max: 12.5 }, busyCores: { samples: 2016, mean: 2.1, p95: 3.1, max: 3.9 }, cpuPressureShare: 0.1,
    overheadCores: 0.4, overheadMemoryBytes: 858_993_459, usableCores: 3.46, usableMemoryBytes: 3_435_973_837,
    demandCpuCores: 1.2, demandMemoryBytes: 1_932_735_283, demandSource: "fleet", modelledServers: 1, limitedBy: "memory", samples: 2016,
    stealHourly: hex(week(() => 60)), busyHourly: hex(week(() => 70)),
};
const matching: HostingFleetCapacityHost = {
    ...risky, serviceName: "vps-uk-match.vps.ovh.net", regionKeys: ["united-kingdom"], memoryBytes: 8 * GIB, instanceTypeKey: "ovh-4-8-haswell",
    occupants: [{ serverId: "44444444-4444-4444-8444-444444444444", displayName: "Lone Wolf", demand: demandOf(0.6, GIB) }],
    steal: { samples: 2016, mean: 0.1, p95: 0.2, max: 0.9 }, demandSource: "type", modelledServers: 2, limitedBy: "cpu",
    stealHourly: hex(week(() => 1)), busyHourly: hex(week(() => 20)),
};
// RAM unknown, so it is not modelled.
const contabo: HostingFleetCapacityHost = {
    ...empty, serviceName: "vmi123456.contaboserver.net", provider: "contabo-vps", regionKeys: ["germany"], vCpu: 8, slots: 4, instanceTypeKey: "contabo-8",
    occupants: [{ serverId: "99999999-9999-4999-8999-999999999999", displayName: "Aserai Sands", demand: demandOf(1.4, 2 * GIB) }],
    busyCores: { samples: 2016, mean: 0.8, p95: 1, max: 2.2 }, samples: 2016, busyHourly: hex(week(() => 15)),
};
const spare: HostingFleetCapacityHost = { ...empty, serviceName: "vps-spare", provider: "ovhcloud-vps", regionKeys: [], vCpu: 4, slots: 2 };

const ovhSix: HostingFleetCapacityInstanceType = {
    key: "ovh-6-12-haswell", provider: "ovhcloud-vps", vCpu: 6, memoryBytes: 12 * GIB, cpuModel: HASWELL, cpuMhz: 2399.996,
    hosts: 3, servers: 4, demand: fleetDemand, steal: { samples: 6048, mean: 0.4, p95: 1.2, max: 6.5 }, modelledServers: 4, demandSource: "type",
};
const ovhFour: HostingFleetCapacityInstanceType = {
    ...ovhSix, key: "ovh-4-4-haswell", vCpu: 4, memoryBytes: 4 * GIB, hosts: 1, servers: 2, demand: demandOf(1.5, 2.5 * GIB),
    steal: { samples: 2016, mean: 1.8, p95: 3.4, max: 12.5 }, modelledServers: 1, demandSource: "fleet",
};
const contaboEight: HostingFleetCapacityInstanceType = {
    key: "contabo-8", provider: "contabo-vps", vCpu: 8, memoryBytes: null, cpuModel: null, cpuMhz: null,
    hosts: 1, servers: 1, demand: noDemand, steal: null, modelledServers: null, demandSource: "none",
};

const capacity: HostingAdminFleetCapacity = {
    generatedAt: "2026-10-19T00:07:31.552Z", windowStartedAt: "2026-10-12T00:00:00.000Z", windowEndedAt: "2026-10-19T00:00:00.000Z", hours: 168,
    model,
    fleet: { hosts: 6, servers: 7, demand: fleetDemand },
    providers: [
        { provider: "ovhcloud-vps", hosts: 5, servers: 6, demand: fleetDemand, steal: { samples: 10_080, mean: 0.4, p95: 1.2, max: 6.5 }, busyCores: { samples: 10_080, mean: 1.1, p95: 2.4, max: 4.8 } },
        { provider: "contabo-vps", hosts: 1, servers: 1, demand: demandOf(1.4, 2 * GIB), steal: null, busyCores: { samples: 2016, mean: 0.8, p95: 1, max: 2.2 } },
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    mocks.request.mockResolvedValue(capacity);
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
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual(["Fleet capacity", "What a server needs", "Providers", "Instance types", "VPSs"]);
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
    expect(needs.textContent).toContain("Today's static rule reserves 2 vCPU · 3 GiB per server. A running server uses 1.20 cores at p95 (60% of 2 vCPU) and 1.80 GiB at p95 (60% of 3 GiB).");
});

it("compares providers' steal and per-server needs", async () => {
    await open();
    expect(cellTexts(tableRow("Providers", "OVHcloud"))).toEqual(["5", "6", "0.4%", "1.2%", "6.5%", "0.85 cores", "1.20 cores", "1.80 GiB"]);
    expect(cellTexts(tableRow("Providers", "Contabo"))).toEqual(["1", "1", NO_DATA, NO_DATA, NO_DATA, "0.70 cores", "1.40 cores", "2.00 GiB"]);
});

it("models each instance type against its static slots", async () => {
    await open();
    expect(tableRow("Instance types", "OVHcloud").querySelector("th")!.textContent).toBe("OVHcloudovh-6-12-haswell");
    expect(cellTexts(tableRow("Instance types", "OVHcloudovh-6"))).toEqual(["6", "12.00 GiB", HASWELL, "2,400 MHz", "3", "4", "0.85 cores", "1.20 cores", "1.80 GiB", "1.2%", "4 / 3 slotsHeadroom +1", "Type"]);
    expect(cellTexts(tableRow("Instance types", "OVHcloudovh-4"))).toEqual(["4", "4.00 GiB", HASWELL, "2,400 MHz", "1", "2", "0.75 cores", "1.50 cores", "2.50 GiB", "3.4%", "1 / 2 slotsAt risk −1", "Fleet"]);
    expect(cellTexts(tableRow("Instance types", "Contabo"))).toEqual(["8", NO_DATA, NO_DATA, NO_DATA, "1", "1", NO_DATA, NO_DATA, NO_DATA, NO_DATA, `${NO_DATA} / 4 slots`, "None yet"]);
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
});

it("shows each VPS's figures and its servers' own needs", async () => {
    await open();
    const row = hostRow("vps-1a2b3c4d");
    const name = row.querySelector("th")!;
    expect(name.textContent).toContain("6 vCPU · 12.0 GiB RAM");
    expect(name.textContent).toContain(`${HASWELL}2,400 MHz`);
    expect(name.textContent).toContain("3 servers · 3 slots");
    expect([...name.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
        "Calradia Company1.10 cores · 1.65 GiB at p95", "Sturgia Nightsno data yet", "Vlandia Rising0.90 cores · memory — at p95",
    ]);
    expect(cellTexts(row).slice(0, 7)).toEqual(["4 / 3 slotsHeadroom +1", "CPU", "0.4% · 1.2% · 6.5%", "2.40 coresof 6 vCPU", "0.35 cores1.10 GiB", "5.58 cores10.90 GiB", "1.20 cores1.80 GiBType p95"]);
    expect(cellTexts(hostRow("vps-de-risk")).slice(0, 3)).toEqual(["1 / 2 slotsAt risk −1", "Memory", "1.8% · 3.4% · 12.5%"]);
    expect(cellTexts(hostRow("vps-spare")).slice(0, 7)).toEqual([`${NO_DATA} / 2 slots`, NO_DATA, NO_DATA, `${NO_DATA}of 4 vCPU`, `${NO_DATA}${NO_DATA}`, `${NO_DATA}${NO_DATA}`, `${NO_DATA}${NO_DATA}None yet`]);
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
    expect(tooltipOf(button("Demand source", pane("Instance types"))).textContent).toContain("Type uses the instance type's own figures once it has 24.0 server-h of running data");
    expect(tooltipOf(button("CPU p95", pane("What a server needs"))).textContent).toBe(`${hints.cpu} ${hints.p95}`);
});

it("says there is not enough data yet instead of looking broken before the first samples", async () => {
    mocks.request.mockResolvedValueOnce(blank);
    await open();
    expect(pane("Fleet capacity").textContent).toContain("Not enough data yet: no samples have arrived.");
    const needs = pane("What a server needs");
    expect([...needs.querySelectorAll("dd")].map((value) => value.textContent)).toEqual([NO_DATA, NO_DATA, NO_DATA, "0.0 server-h", NO_DATA, NO_DATA, NO_DATA, NO_DATA]);
    expect(needs.textContent).toContain("There is not enough data yet to compare it with what servers use.");
    expect(cellTexts(tableRow("Providers", "OVHcloud"))).toEqual(["2", "0", NO_DATA, NO_DATA, NO_DATA, NO_DATA, NO_DATA, NO_DATA]);
    expect(cellTexts(tableRow("Instance types", "OVHcloud")).slice(-2)).toEqual([`${NO_DATA} / 3 slots`, "None yet"]);
    expect(container.querySelector(".border-crimson\\/40, .border-emerald-500\\/30")).toBeNull();
    expect(strips("vps-de-quiet").busy.getAttribute("aria-label")).toBe("vps-de-quiet busy by hour: no data yet");
});

it("says while the fleet has less running data than an instance type needs", async () => {
    mocks.request.mockResolvedValueOnce({ ...capacity, fleet: { ...capacity.fleet, demand: { ...fleetDemand, runningServerHours: 3.25 } } });
    await open();
    expect(pane("Fleet capacity").textContent).toContain("Not enough data yet: the fleet has 3.3 server-h of running data, and an instance type needs 24.0 server-h before its own figures are used.");
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
    expect(container.querySelectorAll("section")).toHaveLength(1);
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
    expect(container.querySelectorAll("section")).toHaveLength(1);
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
