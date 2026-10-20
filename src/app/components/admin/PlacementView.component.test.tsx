import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import {
    formatPlacementChange,
    formatPlacementGain,
    formatPlacementWindow,
    heatmapSummary,
    parsePlacementHeatmap,
    placementMoveStatuses,
    placementPlanErrorMessage,
    placementPlanInput,
    sortPlacementHosts,
    sortPlacementServers,
} from "@/app/lib/control-plane/placement";
import type {
    HostingAdminPlacementPlan,
    HostingAdminVpsHost,
    HostingJob,
    HostingPlacementContention,
    HostingPlacementHost,
    HostingPlacementMove,
    HostingPlacementServer,
    HostingPlacementWindow,
    ManagedServer,
    PlacementViewData,
} from "@/app/lib/control-plane/types";
import { PlacementView } from "./PlacementView";

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (original) => ({ ...await original<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const catalog = [{ region: "united-kingdom", placement: { countryCodes: ["GB"] } }];
const quiet: HostingPlacementWindow = { weekday: "sunday", startsAtUtc: "23:00", durationMinutes: 120, onlineProbability: 0.04, nextStartsAt: "2026-10-18T23:00:00.000Z" };
const weekendHeatmap = "0".repeat(24 * 5) + "9".repeat(24) + "5".repeat(24);

function contention(pairHoursPerWeek: number, contendedHoursPerWeek = pairHoursPerWeek, saturatedHoursPerWeek = 0): HostingPlacementContention {
    return { pairHoursPerWeek, contendedHoursPerWeek, saturatedHoursPerWeek, observedPairHoursPerWeek: pairHoursPerWeek / 2 };
}

function planServer(serverId: string, displayName: string, serviceName: string, proposedServiceName: string, extra: Partial<HostingPlacementServer> = {}): HostingPlacementServer {
    return {
        serverId, displayName, region: "united-kingdom", serviceName, proposedServiceName, pinnedReason: null,
        observedDays: 28, weeklyOnlineHours: 40.25, heatmap: weekendHeatmap, quietWindow: quiet, ...extra,
    };
}

function planHost(serviceName: string, slots: number, freeSlots: number, current: string[], proposed: string[], pairHours: number, proposedPairHours: number): HostingPlacementHost {
    return {
        serviceName, regionKeys: ["united-kingdom"], vCpu: slots * 2, slots, freeSlots, acceptsRelocations: true,
        current: { ...contention(pairHours), serverIds: current, peakExpectedOnline: current.length },
        proposed: { ...contention(proposedPairHours), serverIds: proposed, peakExpectedOnline: proposed.length },
    };
}

function move(step: number, serverId: string, displayName: string, fromServiceName: string, toServiceName: string, gainPairHoursPerWeek: number, staging = false): HostingPlacementMove {
    return { step, serverId, displayName, fromServiceName, toServiceName, targetRegion: "united-kingdom", staging, gainPairHoursPerWeek, window: quiet };
}

const plan: HostingAdminPlacementPlan = {
    dryRun: true,
    generatedAt: "2026-10-18T12:00:00.000Z",
    options: { historyDays: 28, halfLifeDays: 14, maximumMoves: 8, minimumGainHours: 1, alwaysOnTargets: "none" },
    model: { historyStartedAt: "2026-09-20T12:00:00.000Z", binMinutes: 30, timeZone: "UTC", minimumObservedDays: 7, samples: 80_640, searchEvaluations: 1_250_000 },
    current: contention(30.5, 20, 4),
    proposed: contention(12.25, 9, 0),
    relocations: 2,
    servers: [
        planServer("gang", "The Gang", "vps-uk-a", "vps-uk-b"),
        planServer("knights", "Calradian Knights", "vps-uk-a", "vps-uk-b"),
        // An older control plane omits alwaysOn; it reads as false.
        planServer("boys", "Dem Boys", "vps-uk-a", "vps-uk-a", { pinnedReason: "insufficient-history", observedDays: 3, heatmap: "bad" }),
        planServer("march", "March", "vps-uk-c", "vps-uk-c", { alwaysOn: true, pinnedReason: "always-on" }),
    ],
    hosts: [
        planHost("vps-uk-b", 3, 3, [], ["gang", "knights"], 0, 6),
        planHost("vps-uk-a", 3, 0, ["gang", "knights", "boys"], ["boys"], 30.5, 0),
        planHost("vps-uk-c", 2, 1, ["march"], ["march"], 0, 0),
    ],
    moves: [
        move(3, "knights", "Calradian Knights", "vps-uk-c", "vps-uk-b", 9.5),
        move(1, "gang", "The Gang", "vps-uk-a", "vps-uk-b", 12),
        move(2, "knights", "Calradian Knights", "vps-uk-a", "vps-uk-c", -0.4, true),
    ],
    unsequencedServerIds: [],
};

function managedServer(serverId: string, displayName: string): ManagedServer {
    return {
        serverId, displayName, friendlyRegion: "united-kingdom", ownerDiscordUserId: "123456789012345678", ownerAccountId: null,
        provider: "ovhcloud-vps", providerResourceId: null, providerLocationId: null, desiredState: "running",
        observedVmState: "running", observedGameState: "running", operationState: "running", releaseChannel: "stable",
        installedBuildId: null, desiredBuildId: null, pinnedBuildId: null, maintenanceSlot: "sunday-0400", activeSaveId: null,
        connectionHostname: null, connectionIp: null, gamePorts: [], deletionDueAt: null, lastHealthCheckAt: null,
        lastErrorCode: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-18T12:30:00.000Z",
    };
}

function host(name: string, availableServers: number, occupied: Array<[string, number]>): HostingAdminVpsHost {
    return {
        provider: "ovhcloud-vps", name, countryCode: "GB", locationId: "uk-1", region: null, totalSlots: 3, runningServers: occupied.length,
        availableServers, cost: null, expirationDate: null, autoRenew: null, providerCheckedAt: null, resources: null, runnerOnboarding: null,
        occupiedSlots: occupied.map(([serverId, slotIndex]) => ({
            serverId, slotIndex, gamePort: 4200 + slotIndex, displayName: serverId, ownerDiscordUserId: "123456789012345678", operationState: "running",
        })),
    };
}

function job(serverId: string, action: string): HostingJob {
    return {
        jobId: `${serverId}-${action}`, serverId, action, state: "running", authority: "administrator", attemptCount: 1, maximumAttempts: 3,
        progressStage: "running", errorCode: null, runAt: "2026-10-18T12:00:00.000Z", createdAt: "2026-10-18T12:00:00.000Z", updatedAt: "2026-10-18T12:00:00.000Z",
    };
}

const data: PlacementViewData = {
    inventory: {
        hosts: [host("vps-uk-a", 0, [["gang", 0], ["knights", 1], ["boys", 2]]), host("vps-uk-b", 3, []), host("vps-uk-c", 1, [["march", 0]])],
        controlPlaneHost: null, availableHosts: [],
    },
    regionCatalog: catalog,
    activeJobs: [],
};

// One measured shared VPS, so the tab's first pane has something to draw.
const measuredOverlap = {
    generatedAt: "2026-10-19T00:07:31.552Z", windowStartedAt: "2026-10-12T00:00:00.000Z", windowEndedAt: "2026-10-19T00:00:00.000Z", hours: 168,
    hosts: [{
        serviceName: "vps-uk-a", regionKeys: ["united-kingdom"], vCpu: 4, memoryBytes: 8_138_963_026, slots: 2, burstServers: 2,
        occupants: [{ serverId: "gang", displayName: "The Gang", hoursWithData: 168 }, { serverId: "knights", displayName: "Calradian Knights", hoursWithData: 168 }],
        online: Array.from({ length: 168 }, () => 0.5), overBurst: "0".repeat(168), overBurstHours: 0, measuredPairHours: 0, coverage: 1,
    }],
};

const executor = {
    settings: { enabled: false, minimumGainHours: 20, alwaysOnPolicy: "single-slot", noticeLeadHours: 1, updatedBy: null, reason: null, updatedAt: null },
    relocations: [],
};

// Requests the view sent for one operation; the executor panel also reads its settings on mount.
function calls(operation: string) {
    return mocks.request.mock.calls.map(([request]) => request as { operation: string; input: Record<string, unknown> }).filter((request) => request.operation === operation);
}

function status(prefix: string) {
    return [...container.querySelectorAll('[role="status"]')].find((item) => item.textContent?.startsWith(prefix)) ?? null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    mocks.request.mockImplementation(async ({ operation, input }: { operation: string; input: { serverId?: string } }) => {
        if (operation === "placement-executor") return executor;
        if (operation === "placement-overlap") return measuredOverlap;
        if (operation === "placement-plan") return plan;
        if (operation === "server-dashboard") return { dashboard: { server: managedServer(input.serverId!, "The Gang"), activeJob: null } };
        return { outcome: "enqueued", job: job("gang", "migrate-region") };
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

function button(scope: ParentNode, text: string) {
    return [...scope.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;
}

function row(name: string, scope: ParentNode = container) {
    return [...scope.querySelectorAll("tbody tr")].find((item) => item.textContent?.includes(name))!;
}

function moveRow(step: number) {
    const table = [...container.querySelectorAll("table")].find((item) => item.textContent?.includes("Quiet window"))!;
    return [...table.querySelectorAll("tbody tr")].find((item) => item.querySelector("td")?.textContent === String(step))!;
}

async function type(element: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function select(element: HTMLSelectElement, value: string) {
    await act(async () => {
        element.value = value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

async function runPlan() {
    await act(async () => button(container, "Run dry run").click());
}

it("validates the plan options and leaves the default always-on choice out of the request", () => {
    const form = { historyDays: "28", halfLifeDays: "14", maximumMoves: "16", minimumGainHours: "1.5", alwaysOnTargets: "any" };
    expect(placementPlanInput(form)).toEqual({ input: { historyDays: 28, halfLifeDays: 14, maximumMoves: 16, minimumGainHours: 1.5 } });
    expect(placementPlanInput({ ...form, alwaysOnTargets: "single-slot" })).toEqual({ input: { historyDays: 28, halfLifeDays: 14, maximumMoves: 16, minimumGainHours: 1.5, alwaysOnTargets: "single-slot" } });
    expect(placementPlanInput({ ...form, historyDays: "13" })).toEqual({ error: "History days must be a whole number from 14 to 90." });
    expect(placementPlanInput({ ...form, maximumMoves: "2.5" })).toEqual({ error: "Maximum moves must be a whole number from 0 to 64." });
    expect(placementPlanInput({ ...form, minimumGainHours: "" })).toEqual({ error: "Minimum gain must be a number from 0 to 168." });
    expect(placementPlanInput({ ...form, alwaysOnTargets: "sometimes" })).toEqual({ error: "Choose where always-on servers may move." });
});

it("formats windows, changes and gains, and parses the hourly heatmap", () => {
    expect(formatPlacementWindow(quiet)).toBe("Sunday 23:00–01:00 UTC");
    expect(formatPlacementWindow({ weekday: "monday", startsAtUtc: "02:30", durationMinutes: 120 })).toBe("Monday 02:30–04:30 UTC");
    expect(formatPlacementChange(30.5, 12.25)).toBe("−18.2");
    expect(formatPlacementChange(1, 1.04)).toBe("0.0");
    expect(formatPlacementGain(-0.4)).toBe("−0.4");
    expect(formatPlacementGain(12)).toBe("+12.0");
    // A move made only for the CPU shortage it removes saves no pair-hours.
    expect(formatPlacementGain(0)).toBe("0.0");
    const rows = parsePlacementHeatmap(weekendHeatmap)!;
    expect(rows).toHaveLength(7);
    expect(rows.every((day) => day.length === 24)).toBe(true);
    expect(rows[5]![0]).toBe(9);
    expect(rows[6]![23]).toBe(5);
    expect(parsePlacementHeatmap("12")).toBeNull();
    expect(parsePlacementHeatmap("a".repeat(168))).toBeNull();
    expect(heatmapSummary(rows, 40.25)).toBe("Online probability by hour, Monday to Sunday UTC; about 40.3 hours a week online. Busiest Saturday 00:00 UTC: 90–100% online; quietest Monday 00:00 UTC: 0–10% online.");
});

it("explains rate limits and a busy planner with retry text", () => {
    expect(placementPlanErrorMessage(new ControlPlaneAdminError("rate_limited", "Too many requests.", true))).toBe("You can run six dry runs every five minutes. Wait a few minutes, then run it again.");
    expect(placementPlanErrorMessage(new ControlPlaneAdminError("placement_plan_busy", "Busy.", true))).toBe("Another dry run with different options is still running. Try again in a few seconds.");
    expect(placementPlanErrorMessage(new ControlPlaneAdminError("placement_history_unavailable", "Placement history could not be read.", true))).toBe("Placement history could not be read.");
});

it("sorts moving servers and contended hosts first", () => {
    expect(sortPlacementServers(plan.servers).map((server) => server.serverId)).toEqual(["knights", "gang", "boys", "march"]);
    expect(sortPlacementHosts(plan.hosts).map((item) => item.serviceName)).toEqual(["vps-uk-a", "vps-uk-b", "vps-uk-c"]);
});

it("runs steps in order and follows a staging hop through the server's later step", () => {
    const statuses = (hosts: Record<string, string>, jobs: Record<string, string> = {}, queued: number[] = []) => Object.fromEntries([...placementMoveStatuses(
        plan.moves, plan.servers, new Map(Object.entries(hosts)), new Map(Object.entries(jobs).map(([serverId, action]) => [serverId, { action }])), new Set(queued),
    )].map(([step, status]) => [step, status.kind === "blocked" ? status.reason : status.kind]));

    expect(statuses({ gang: "vps-uk-a", knights: "vps-uk-a" })).toEqual({
        1: "ready",
        2: "Run step 1 first; this step can need the slot it frees.",
        3: "Waiting for this server's earlier step.",
    });
    expect(statuses({ gang: "vps-uk-a", knights: "vps-uk-a" }, {}, [1])[1]).toBe("relocating");
    expect(statuses({ gang: "vps-uk-b", knights: "vps-uk-a" }, { knights: "backup" })).toMatchObject({ 1: "done", 2: "Waiting for the backup job to finish." });
    expect(statuses({ gang: "vps-uk-b", knights: "vps-uk-a" }, { knights: "migrate-region" })).toMatchObject({ 1: "done", 2: "relocating", 3: "Waiting for this server's earlier step." });
    expect(statuses({ gang: "vps-uk-b", knights: "vps-uk-c" })).toEqual({ 1: "done", 2: "done", 3: "ready" });
    expect(statuses({ gang: "vps-uk-b", knights: "vps-uk-b" })).toEqual({ 1: "done", 2: "done", 3: "done" });
    expect(statuses({ gang: "vps-uk-d", knights: "vps-uk-a" })[1]).toBe("This server is on vps-uk-d, not vps-uk-a. Run a new dry run.");
});

it("runs the dry run only when asked, with progress, and renders the plan", async () => {
    let resolvePlan: (value: unknown) => void = () => undefined;
    const respond = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((request: { operation: string }) => request.operation === "placement-plan"
        ? new Promise((resolve) => { resolvePlan = resolve; })
        : respond(request));
    await act(async () => root.render(<PlacementView data={data} />));
    expect(calls("placement-plan")).toHaveLength(0);
    expect(container.textContent).toContain("Run a dry run to see the proposed placement.");

    await type(container.querySelector<HTMLInputElement>('input[name="maximumMoves"]')!, "8");
    await select(container.querySelector<HTMLSelectElement>('select[name="alwaysOnTargets"]')!, "none");
    await runPlan();

    expect(calls("placement-plan")).toHaveLength(1);
    expect(calls("placement-plan")[0]).toMatchObject({
        accessToken: "test-only",
        operation: "placement-plan",
        input: { historyDays: 28, halfLifeDays: 14, maximumMoves: 8, minimumGainHours: 1, alwaysOnTargets: "none" },
    });
    expect(status("Planning")?.textContent).toBe("Planning from reconcile history… 0 s");
    expect(button(container, "Running").disabled).toBe(true);

    await act(async () => resolvePlan(plan));

    expect(status("Planning")).toBeNull();
    expect(row("Co-online pair-hours").textContent).toContain("30.5");
    expect(row("Co-online pair-hours").textContent).toContain("12.3");
    expect(row("Co-online pair-hours").textContent).toContain("−18.2");
    expect(row("Hours with 3+ online").textContent).toContain("4.0");
    expect(container.textContent).toContain("3 (1 staging)");
    expect(container.textContent).toContain("always-on: nowhere (pin them)");
    expect(container.textContent).toContain("Sunday 23:00–01:00 UTC");

    const steps = [...[...container.querySelectorAll("table")].find((item) => item.textContent?.includes("Quiet window"))!.querySelectorAll("tbody tr")].map((item) => item.querySelector("td")?.textContent);
    expect(steps).toEqual(["1", "2", "3"]);
    expect(moveRow(2).textContent).toContain("Staging");
    expect(moveRow(2).textContent).toContain("−0.4");
    // A step that saves no pair-hours can enable a later step or relieve a CPU shortage; the gain counts pair-hours only.
    expect(moveRow(2).querySelectorAll("td")[4]!.getAttribute("title")).toBe("This step saves no pair-hours on its own: it enables a later step, such as one leg of a swap, or relieves a CPU shortage.");
    expect(moveRow(1).querySelectorAll("td")[4]!.hasAttribute("title")).toBe(false);
    expect(container.querySelector('th[title^="Co-online pair-hours per week this step saves"]')!.getAttribute("title"))
        .toBe("Co-online pair-hours per week this step saves on its own, in step order. Steps are ordered by pair-hours and CPU shortage removed together.");
    expect(container.querySelector('[title^="Model: expected pair-hours per week"]')!.getAttribute("title"))
        .toBe("Model: expected pair-hours per week that two servers on one VPS are online together. The planner minimizes this and, where measured, the expected CPU shortage.");
    expect(container.querySelector('[title^="Pair-hours per week each relocation step"]')!.getAttribute("title"))
        .toBe("Pair-hours per week each relocation step must be worth, staging hops included; 1 core-hour a week of CPU shortage removed counts as 20.");
    expect(button(moveRow(1), "Relocate").disabled).toBe(false);
    expect(moveRow(1).textContent).toContain("Next");
    expect(button(moveRow(2), "Relocate").disabled).toBe(true);
    expect(button(moveRow(2), "Relocate").title).toBe("Run step 1 first; this step can need the slot it frees.");

    const heatmap = container.querySelector('[role="img"][aria-label^="The Gang:"]')!;
    expect(heatmap.getAttribute("aria-label")).toContain("Busiest Saturday 00:00 UTC: 90–100% online");
    expect(heatmap.querySelectorAll("[title$='online']")).toHaveLength(168);
    expect(heatmap.querySelector("[title$='online']")?.getAttribute("title")).toBe("Monday 00:00 UTC: 0–10% online");
    expect(row("Dem Boys").textContent).toContain("Fewer than seven days of history");
    expect(row("Dem Boys").textContent).toContain("Unavailable");
    expect(row("Dem Boys").textContent).not.toContain("Always on");
    expect(row("March").textContent).toContain("Always on");
    const hostRow = [...container.querySelectorAll("tbody tr")].find((item) => item.querySelector("td")?.textContent?.startsWith("vps-uk-a"))!;
    expect(hostRow.textContent).toContain("The Gang, Calradian Knights, Dem Boys");
    expect(hostRow.textContent).toContain("→ Dem Boys");
});

it("shows the measured overlap first, then automatic placement, then the dry run", async () => {
    await act(async () => root.render(<PlacementView data={data} />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const overlap = container.querySelector('section[aria-label="Host overlap"]')!;
    const executorPanel = container.querySelector('section[aria-labelledby="placement-executor-heading"]')!;
    const dryRun = container.querySelector('form[aria-labelledby="placement-plan-heading"]')!;
    expect(overlap.compareDocumentPosition(executorPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(executorPanel.compareDocumentPosition(dryRun) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The measured read needs no dry run.
    expect(calls("placement-overlap")).toHaveLength(1);
    expect(calls("placement-plan")).toHaveLength(0);
    expect(overlap.querySelector('[role="img"][aria-label^="vps-uk-a:"]')).not.toBeNull();
});

it("no longer shows a modelled host overlap in the dry run's results", async () => {
    await act(async () => root.render(<PlacementView data={data} />));
    await runPlan();
    const sections = [...container.querySelectorAll("section[aria-label]")].map((section) => section.getAttribute("aria-label"));
    expect(sections.filter((label) => label === "Host overlap")).toHaveLength(1);
    expect(sections.slice(sections.indexOf("Servers"))).toEqual(["Servers", "VPS hosts"]);
    expect(container.textContent).not.toContain("After plan");
    expect(container.querySelector('[aria-label="Placement shown"]')).toBeNull();
});

it("explains a rate-limited dry run and keeps the form usable", async () => {
    const respond = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (request: { operation: string }) => {
        if (request.operation === "placement-plan") throw new ControlPlaneAdminError("rate_limited", "Too many requests.", true);
        return respond(request);
    });
    await act(async () => root.render(<PlacementView data={data} />));
    await runPlan();

    expect(container.querySelector('form[aria-labelledby="placement-plan-heading"] [role="alert"]')?.textContent).toBe("You can run six dry runs every five minutes. Wait a few minutes, then run it again.");
    expect(button(container, "Run dry run").disabled).toBe(false);
});

it("opens a step's relocation on the planned VPS with the server's current generation", async () => {
    await act(async () => root.render(<PlacementView data={data} />));
    await runPlan();
    await act(async () => button(moveRow(1), "Relocate").click());

    expect(calls("server-dashboard")).toEqual([expect.objectContaining({ input: { serverId: "gang" } })]);
    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("Step 1 of the dry run: vps-uk-a → vps-uk-b.");
    expect(dialog.textContent).toContain("players need the new address and game port to join");
    const [regionSelect, hostSelect] = dialog.querySelectorAll("select");
    expect(regionSelect!.value).toBe("united-kingdom");
    expect(hostSelect!.value).toBe("vps-uk-b");

    await act(async () => button(dialog, "Relocate").click());

    expect(calls("relocate-server")[0]).toMatchObject({
        operation: "relocate-server",
        input: { serverId: "gang", expectedUpdatedAt: "2026-10-18T12:30:00.000Z", targetRegion: "united-kingdom", targetServiceName: "vps-uk-b", reason: "Placement plan step 1" },
    });
    expect(container.querySelector("dialog")).toBeNull();
    expect(moveRow(1).textContent).toContain("Relocating");
    expect(button(moveRow(1), "Relocate").disabled).toBe(true);
    expect(mocks.refresh).toHaveBeenCalled();

    // A fresh dry run starts from its own steps; what was queued from the last one no longer applies.
    mocks.request.mockResolvedValueOnce(structuredClone(plan));
    await runPlan();
    expect(moveRow(1).textContent).not.toContain("Relocating");
    expect(button(moveRow(1), "Relocate").disabled).toBe(false);
});

it("does not open a step while the server has another active job", async () => {
    mocks.request.mockImplementation(async ({ operation, input }: { operation: string; input: { serverId?: string } }) => operation === "placement-executor"
        ? executor
        : operation === "placement-plan" ? plan : { dashboard: { server: managedServer(input.serverId!, "The Gang"), activeJob: { ...job("gang", "backup") } } });
    await act(async () => root.render(<PlacementView data={data} />));
    await runPlan();
    await act(async () => button(moveRow(1), "Relocate").click());

    expect(container.querySelector("dialog")).toBeNull();
    expect(moveRow(1).querySelector('[role="alert"]')?.textContent).toBe("Waiting for the backup job to finish.");
});

it("keeps a planned VPS that is full from being submitted", async () => {
    const full: PlacementViewData = { ...data, inventory: { ...data.inventory, hosts: [data.inventory.hosts[0]!, host("vps-uk-b", 0, []), data.inventory.hosts[2]!] } };
    await act(async () => root.render(<PlacementView data={full} />));
    await runPlan();
    await act(async () => button(moveRow(1), "Relocate").click());

    const dialog = container.querySelector("dialog")!;
    expect(dialog.textContent).toContain("vps-uk-b has no free slot right now.");
    expect(button(dialog, "Relocate").disabled).toBe(true);
});
