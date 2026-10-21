import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import { SLOT_SIZING_UNAVAILABLE, slotSizingHints } from "@/app/lib/control-plane/slot-sizing";
import type { HostingAdminSlotSizing, HostingSlotSizingHost } from "@/app/lib/control-plane/types";
import { SlotSizingView } from "./SlotSizingView";

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (original) => ({ ...await original<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));

const GIB = 1024 ** 3;
const BURST = 2_684_354_560;
const model: HostingAdminSlotSizing["model"] = {
    cpuShortageBudgetCoreHoursPerWeek: 1, memoryOverflowShare: 0.01, cpuBurstVcpu: 1.6, memoryBurstBytes: BURST, historyDays: 28,
    halfLifeDays: 14, minimumObservedDays: 7, maximumSlots: 32, typicalWeeklyOnlineHours: 41.37, capacityErrorCode: null,
};
const ovh = { provider: "ovhcloud-vps", acceptsRelocations: true, memoryBytesPerServer: BURST, serversToMove: 0 } as const;
// Three part-time owners, rarely online together: two more slots.
const grows: HostingSlotSizingHost = { ...ovh, serviceName: "vps-de-part.vps.ovh.net", regionKeys: ["germany"], vCpu: 6, slots: 3, occupants: 3,
    usableCores: 5.58, coresSource: "measured", usableMemoryBytes: 11_703_786_240, memorySource: "measured", recommendedSlots: 5, reason: "cpu",
    expectedShortageCoreHoursPerWeek: 0.842, withinCpuBudget: true, memoryOverflowShare: 0.0021, withinMemoryBudget: true, freeRecommendedSlots: 2 };
const full: HostingSlotSizingHost = { ...grows, serviceName: "vps-de-always.vps.ovh.net", recommendedSlots: 3, expectedShortageCoreHoursPerWeek: 0.004,
    memoryOverflowShare: 0, freeRecommendedSlots: 0 };
// Its two servers break both budgets, but a VPS keeps its floor.
const floored: HostingSlotSizingHost = { ...grows, serviceName: "vps-pl-steal.vps.ovh.net", regionKeys: ["poland"], vCpu: 4, slots: 2, occupants: 2,
    usableCores: 2.9, usableMemoryBytes: 3_435_973_837, recommendedSlots: 2, reason: "floor", expectedShortageCoreHoursPerWeek: 1.853,
    withinCpuBudget: false, memoryOverflowShare: 0.0412, withinMemoryBudget: false, freeRecommendedSlots: 0 };
// Down to its floor of three, which keep both budgets.
const drained: HostingSlotSizingHost = { ...grows, serviceName: "vps-us-busy.vps.ovh.net", regionKeys: ["us-east"], slots: 5, occupants: 5,
    usableCores: 5.5, usableMemoryBytes: 11_274_289_152, recommendedSlots: 3, reason: "drain", expectedShortageCoreHoursPerWeek: 0.95,
    memoryOverflowShare: 0.0003, serversToMove: 2, freeRecommendedSlots: 0 };
const borrowed: HostingSlotSizingHost = { ...grows, serviceName: "vmi654321.contaboserver.net", provider: "contabo-vps", vCpu: 8, slots: 4, occupants: 0,
    usableCores: 7.2, coresSource: "type", usableMemoryBytes: 14 * GIB, memorySource: "type", recommendedSlots: 6, expectedShortageCoreHoursPerWeek: 0.677,
    memoryOverflowShare: 0.0011, freeRecommendedSlots: 6 };
// Not onboarded yet: its free slots are not offered to its region.
const onboarding: HostingSlotSizingHost = { ...grows, serviceName: "vps-us-new.vps.ovh.net", regionKeys: ["us-east"], occupants: 0, acceptsRelocations: false,
    usableCores: 5.512, coresSource: "provider-vcpu", usableMemoryBytes: 11_274_289_152, memorySource: "provider-vcpu", recommendedSlots: 4,
    expectedShortageCoreHoursPerWeek: 0.6,
    memoryOverflowShare: 0.0004, freeRecommendedSlots: 4 };
const unmeasured: HostingSlotSizingHost = { ...ovh, serviceName: "vps-sg-spare.vps.ovh.net", regionKeys: ["singapore"], vCpu: 2, slots: 1, occupants: 0,
    usableCores: null, coresSource: "none", usableMemoryBytes: null, memorySource: "none", recommendedSlots: null, reason: "unmeasured",
    expectedShortageCoreHoursPerWeek: null, withinCpuBudget: null, memoryOverflowShare: null, withinMemoryBudget: null, freeRecommendedSlots: 0 };
const sizing: HostingAdminSlotSizing = {
    generatedAt: "2026-10-20T14:05:12.345Z",
    model,
    hosts: [grows, full, floored, drained, borrowed, onboarding, unmeasured],
    regions: [
        { regionKey: "us-east", serversToMove: 2, freeRecommendedSlots: 0, shortfallServers: 2 },
        { regionKey: "germany", serversToMove: 0, freeRecommendedSlots: 8, shortfallServers: 0 },
        { regionKey: "poland", serversToMove: 0, freeRecommendedSlots: 0, shortfallServers: 0 },
        { regionKey: "singapore", serversToMove: 0, freeRecommendedSlots: 0, shortfallServers: 0 },
    ],
};
const hints = slotSizingHints(model);
const UNMEASURED = "—Unmeasured";
const NO_CAPACITY = "UnmeasuredIts usable cores and memory are neither measured nor borrowable, so there is no recommendation.";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    mocks.request.mockResolvedValue(sizing);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

async function open() {
    await act(async () => root.render(<SlotSizingView />));
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

function hostsTable() {
    return container.querySelector<HTMLTableElement>('table[aria-label="Recommended slots per VPS"]');
}

function regionsTable() {
    return container.querySelector<HTMLTableElement>('table[aria-label="Moves and room per region"]');
}

/** A VPS's row by its short name, and its data cells' text. */
function hostRow(name: string) {
    return [...hostsTable()!.querySelectorAll("tbody tr")].find((row) => row.querySelector('th[scope="row"] p')?.textContent === name)!;
}

/** The Over budget marks in the VPS rows, leaving out the column tooltips that explain them. */
function overBudgetMarks() {
    return [...hostsTable()!.querySelectorAll("tbody")].map((body) => body.textContent!.split("Over budget").length - 1).reduce((total, marks) => total + marks, 0);
}

function cellTexts(row: Element) {
    return [...row.querySelectorAll(":scope > td")].map((cell) => cell.textContent);
}

function regionRow(label: string) {
    return [...regionsTable()!.querySelectorAll("tbody tr")].find((row) => row.querySelector('th[scope="row"]')?.textContent === label)!;
}

function tooltipOf(trigger: HTMLElement) {
    return document.getElementById(trigger.getAttribute("aria-describedby")!)!;
}

it("reads slot sizing once when it opens, says it is a recommendation, and offers nothing to apply", async () => {
    await open();
    expect(calls()).toEqual([expect.objectContaining({ operation: "slot-sizing", input: {}, accessToken: "test-only" })]);
    const pane = container.querySelector('section[aria-label="Slot sizing"]')!;
    expect(pane.querySelector("h2")!.textContent).toBe("Slot sizing");
    expect(pane.textContent).toContain("Recommendations only · nothing is applied");
    expect(pane.textContent).toContain("These are recommendations to review: nothing applies them, and no slot count, server or placement changes until automatic sizing is turned on, which does not exist yet. Raising slots by hand in the VPS view stays separate.");
    expect(pane.textContent).toContain("at most 1 core-hour a week of expected CPU shortage, and more servers online at once than its memory holds in under 1% of the week.");
    expect(pane.textContent).toContain("A typical new server needs 1.6 vCPU and 2.5 GiB while online and is online 41.37 hours a week, the mean of servers' weeks over the last 28 days (14-day half-life).");
    expect(pane.querySelector('time[datetime="2026-10-20T14:05:12.345Z"]')).not.toBeNull();
    // Every button is Refresh or a figure's explanation: there is no apply, raise or lower action.
    for (const item of container.querySelectorAll("button")) {
        expect(item.textContent === "Refresh" || item.hasAttribute("aria-describedby")).toBe(true);
    }
    expect(container.textContent).not.toMatch(/\b(?:Apply|Raise slots|Lower)\b/u);
    // Kept while the tab stays open: nothing reads it again by itself.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(calls()).toHaveLength(1);
});

it("shows each VPS's recommendation against its slots, with its reason in plain words", async () => {
    await open();
    expect([...hostsTable()!.querySelectorAll('th[scope="rowgroup"]')].map((heading) => heading.textContent)).toEqual([
        "Contabo · Germany", "OVHcloud · Germany", "OVHcloud · Poland", "OVHcloud · Singapore", "OVHcloud · US-East",
    ]);
    expect(hostRow("vps-de-part").querySelector("th p")!.getAttribute("title")).toBe("vps-de-part.vps.ovh.net");
    expect(cellTexts(hostRow("vps-de-part"))).toEqual(["3", "3", "5+2", "CPU budgetOne more slot would break the CPU budget.", "0.842 core-h", "0.21%", "0", "2",
        "Cores and memory measured5.580 cores, 10.90 GiB usable"]);
    expect(cellTexts(hostRow("vps-de-always")).slice(2, 4)).toEqual(["3same", "CPU budgetOne more slot would break the CPU budget."]);
    expect(cellTexts(hostRow("vps-us-busy"))).toEqual(["5", "5", "3−2",
        "DrainIts 5 servers alone break a budget, so 2 would move, down to its floor of 3 slots (floor(vCPU ÷ 2)), where the 3 that stay keep both budgets.",
        "0.950 core-h", "0.03%", "2", "0", "Cores and memory measured5.500 cores, 10.50 GiB usable"]);
    expect(cellTexts(hostRow("vmi654321.contaboserver.net")).slice(2)).toEqual(["6+2", "CPU budgetOne more slot would break the CPU budget.", "0.677 core-h", "0.11%", "0", "6",
        "Cores and memory borrowed (type)7.200 cores, 14.00 GiB usable"]);
    expect(cellTexts(hostRow("vps-us-new")).at(-1)).toBe("Cores and memory borrowed (provider and vCPU)5.512 cores, 10.50 GiB usable");
    expect(cellTexts(hostRow("vps-sg-spare"))).toEqual(["1", "0", UNMEASURED, NO_CAPACITY, UNMEASURED, UNMEASURED, "0", "0", "Cores and memory unknown"]);
    // The difference is a badge with an icon and its sentence, not colour alone.
    const badge = (name: string) => hostRow(name).querySelector("td span[title]")!;
    expect(badge("vps-de-part").getAttribute("title")).toBe("2 more than its 3 slots now.");
    expect(badge("vps-us-busy").getAttribute("title")).toBe("2 fewer than its 5 slots now.");
    expect(badge("vps-de-always").getAttribute("title")).toBe("As many as its 3 slots now.");
    expect(["vps-de-part", "vps-us-busy", "vps-de-always"].every((name) => badge(name).querySelector("svg") !== null)).toBe(true);
    // A VPS that is not onboarded yet offers its free slots to no region.
    expect(hostRow("vps-us-new").querySelector("th")!.textContent).toBe("vps-us-new6 vCPUTakes no moved servers");
    expect(hostRow("vps-de-part").querySelector("th")!.textContent).toBe("vps-de-part6 vCPU");
});

it("marks figures above their budget, which only floor and drain can have", async () => {
    await open();
    const [, , , , shortage, overflow] = [...hostRow("vps-pl-steal").querySelectorAll(":scope > td")];
    expect(cellTexts(hostRow("vps-pl-steal")).slice(2, 4)).toEqual(["2same",
        "FloorIts 2 servers already break the CPU and memory budgets. A VPS keeps its floor of 2 slots (floor(vCPU ÷ 2)), and this one has no more servers than that, so nothing moves."]);
    expect(shortage!.textContent).toBe("1.853 core-hOver budget");
    expect(overflow!.textContent).toBe("4.12%Over budget");
    expect(shortage!.querySelector("svg")).not.toBeNull();
    expect(overBudgetMarks()).toBe(2);
});

it("takes over-budget marks from the control plane's flags where the rounded figures read as the budget", async () => {
    mocks.request.mockResolvedValueOnce({ ...sizing, hosts: [
        { ...grows, expectedShortageCoreHoursPerWeek: 1, memoryOverflowShare: 0.01 },
        { ...floored, expectedShortageCoreHoursPerWeek: 1, memoryOverflowShare: 0.01, withinMemoryBudget: true },
    ], regions: [] });
    await open();
    expect(cellTexts(hostRow("vps-de-part")).slice(4, 6)).toEqual(["1.000 core-h", "1.00%"]);
    expect(cellTexts(hostRow("vps-pl-steal")).slice(4, 6)).toEqual(["1.000 core-hOver budget", "1.00%"]);
    expect(cellTexts(hostRow("vps-pl-steal"))[3]).toContain("already break the CPU budget.");
    expect(overBudgetMarks()).toBe(1);
});

it("explains a floor with room under it, a drain still short at its floor, and each usable figure's own source", async () => {
    mocks.request.mockResolvedValueOnce({ ...sizing, hosts: [
        // One server on a floor of three: one more typical server fits, and the third slot filled breaks the CPU budget.
        { ...floored, vCpu: 6, slots: 3, occupants: 1, recommendedSlots: 3, expectedShortageCoreHoursPerWeek: 252, memoryOverflowShare: 0,
            withinMemoryBudget: true, freeRecommendedSlots: 1 },
        { ...drained, expectedShortageCoreHoursPerWeek: 218.4, withinCpuBudget: false },
        { ...grows, memorySource: "type" },
        { ...unmeasured, usableCores: 1.5, coresSource: "measured" },
    ], regions: [] });
    await open();
    expect(cellTexts(hostRow("vps-pl-steal"))).toEqual(["3", "1", "3same",
        "FloorBeside its 1 server, 1 more typical server fits within the budgets. A VPS keeps its floor of 3 slots (floor(vCPU ÷ 2)) anyway; filled with typical servers, they would break the CPU budget.",
        "252.000 core-hOver budget", "0.00%", "0", "1", "Cores and memory measured2.900 cores, 3.20 GiB usable"]);
    expect(cellTexts(hostRow("vps-us-busy")).slice(3, 6)).toEqual([
        "DrainIts 5 servers alone break a budget, so 2 would move, down to its floor of 3 slots (floor(vCPU ÷ 2)), where the 3 that stay still break the CPU budget.",
        "218.400 core-hOver budget", "0.03%"]);
    expect(cellTexts(hostRow("vps-de-part")).at(-1)).toBe("Cores measured · memory borrowed (type)5.580 cores, 10.90 GiB usable");
    // Unmeasured for want of memory: its known cores still show, and the missing figure is named.
    expect(cellTexts(hostRow("vps-sg-spare"))).toEqual(["1", "0", UNMEASURED,
        "UnmeasuredIts usable memory is neither measured nor borrowable, so there is no recommendation.", UNMEASURED, UNMEASURED, "0", "0",
        "Cores measured · memory unknown1.500 cores usable"]);
});

it("shows each region's servers to move, free slots and shortfall as the control plane reports them", async () => {
    await open();
    expect(cellTexts(regionRow("US-East"))).toEqual(["2", "0", "2 servers without a slot"]);
    expect(regionRow("US-East").querySelector("svg")).not.toBeNull();
    expect(cellTexts(regionRow("Germany"))).toEqual(["0", "8", "0"]);
    expect([...regionsTable()!.querySelectorAll('tbody th[scope="row"]')].map((cell) => cell.textContent)).toEqual(["US-East", "Germany", "Poland", "Singapore"]);
    // The read gives no VPS count, so the pane invents none.
    expect(container.textContent).not.toMatch(/VPSs? needed/u);
});

it("explains every column in a tooltip", async () => {
    await open();
    const vpss = hostsTable()!;
    for (const [label, hint] of [
        ["Slots", hints.slots], ["Servers", hints.servers], ["Recommended", hints.recommended], ["Reason", hints.reason],
        ["CPU shortage / week", hints.shortage], ["Memory over", hints.overflow], ["To move", hints.toMove], ["Free recommended", hints.free],
        ["Capacity", hints.capacity],
    ] as const) {
        expect(tooltipOf(button(label, vpss)).textContent).toBe(hint);
    }
    const regions = regionsTable()!;
    for (const [label, hint] of [["To move", hints.regionToMove], ["Free recommended", hints.regionFree], ["Shortfall", hints.shortfall]] as const) {
        expect(tooltipOf(button(label, regions)).textContent).toBe(hint);
    }
    const recommended = button("Recommended", vpss);
    await act(async () => recommended.focus());
    expect(tooltipOf(recommended).hidden).toBe(false);
});

it("says when the capacity samples could not be read, so every VPS is unmeasured", async () => {
    mocks.request.mockResolvedValueOnce({
        ...sizing,
        model: { ...model, capacityErrorCode: "fleet_capacity_history_unavailable" },
        hosts: sizing.hosts.map((entry) => ({ ...unmeasured, serviceName: entry.serviceName, provider: entry.provider, regionKeys: entry.regionKeys, vCpu: entry.vCpu, slots: entry.slots, occupants: entry.occupants })),
        regions: sizing.regions.map((entry) => ({ ...entry, serversToMove: 0, freeRecommendedSlots: 0, shortfallServers: 0 })),
    });
    await open();
    expect(container.textContent).toContain("Capacity samples could not be read (fleet_capacity_history_unavailable), so no VPS's usable cores or memory are known: every VPS is unmeasured and has no recommendation.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(cellTexts(hostRow("vps-de-part")).slice(2, 4)).toEqual([UNMEASURED, NO_CAPACITY]);
});

it("says calmly that a control plane without the operation does not offer it yet, and reads again on Refresh", async () => {
    // What control plane main answers: the request fails its operation schema.
    mocks.request.mockRejectedValueOnce(new ControlPlaneAdminError("invalid_request", "The control plane request is invalid.", false));
    await open();
    const pane = container.querySelector('section[aria-label="Slot sizing"]')!;
    expect(pane.textContent).toContain(SLOT_SIZING_UNAVAILABLE);
    expect(pane.textContent).not.toContain("The control plane request is invalid.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(pane.querySelector("h2")!.textContent).toBe("Slot sizing");
    expect(button("Refresh").disabled).toBe(false);
    // Once the control plane has it, Refresh shows it.
    await act(async () => button("Refresh").click());
    await settle();
    expect(calls()).toHaveLength(2);
    expect(pane.textContent).not.toContain(SLOT_SIZING_UNAVAILABLE);
    expect(hostRow("vps-de-part")).toBeDefined();
});

it.each([
    [new ControlPlaneAdminError("rate_limited", "Slot sizing is being requested too frequently. Try again in a few minutes.", true), "You can read slot sizing six times every five minutes. Wait a few minutes, then refresh."],
    [new ControlPlaneAdminError("slot_sizing_unavailable", "Slot sizing needs an enabled VPS provider.", false), "Slot sizing needs an enabled VPS provider."],
    [new ControlPlaneAdminError("control_plane_unavailable", "The control plane could not be reached.", true), "The control plane could not be reached."],
] as const)("explains a failed read and retries it: %s", async (error, message) => {
    mocks.request.mockRejectedValueOnce(error);
    await open();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(`${message} Retry`);
    expect(container.querySelector("table")).toBeNull();
    await act(async () => button("Retry").click());
    await settle();
    expect(calls()).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(hostRow("vps-de-part")).toBeDefined();
});

it("rejects a malformed read, and keeps what it showed when a refresh fails", async () => {
    await open();
    mocks.request.mockResolvedValueOnce({ ...sizing, hosts: [{ ...grows, serversToMove: 1 }] });
    await act(async () => button("Refresh").click());
    await settle();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("The control plane returned an unexpected slot sizing. Retry");
    expect(hostRow("vps-de-part")).toBeDefined();
    mocks.request.mockRejectedValueOnce(new ControlPlaneAdminError("rate_limited", "Too many.", true));
    await act(async () => button("Retry").click());
    await settle();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("six times every five minutes");
    expect(hostRow("vps-de-part")).toBeDefined();
});

it("shows a loading state, then refreshes on request without stacking reads", async () => {
    let finish: ((value: unknown) => void) | null = null;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await open();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Loading slot sizing…");
    expect(button("Refresh").disabled).toBe(true);
    expect(container.querySelector("table")).toBeNull();
    await act(async () => finish!(sizing));
    expect(container.querySelector('[role="status"]')).toBeNull();

    let finishRefresh: ((value: unknown) => void) | null = null;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    await act(async () => button("Refresh").click());
    // What it showed stays while the refresh is under way, and a second Refresh starts nothing.
    expect(button("Refresh").disabled).toBe(true);
    expect(hostRow("vps-de-part")).toBeDefined();
    await act(async () => button("Refresh").click());
    expect(calls()).toHaveLength(2);
    await act(async () => finishRefresh!(sizing));
    expect(button("Refresh").disabled).toBe(false);
});

it("says when there are no VPSs or regions, and names a provider it does not know by its id", async () => {
    mocks.request.mockResolvedValueOnce({ ...sizing, hosts: [], regions: [] });
    await open();
    expect(container.textContent).toContain("The control plane reports no VPSs.");
    expect(container.textContent).toContain("No region has a VPS or a server to move.");

    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.request.mockResolvedValueOnce({ ...sizing, hosts: [{ ...unmeasured, provider: "hetzner-cloud" }], regions: [] });
    await open();
    expect([...hostsTable()!.querySelectorAll('th[scope="rowgroup"]')].map((heading) => heading.textContent)).toEqual(["hetzner-cloud · Singapore"]);
});
