import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import { PLACEMENT_EXECUTOR_DESCRIPTION, PLACEMENT_EXECUTOR_ENABLE_CONFIRMATION, placementExecutorLegacyValues, placementExecutorSwitchInput } from "@/app/lib/control-plane/placement";
import type { HostingAdminPlacementExecutor, HostingPlacementExecutorSettings, HostingPlacementRelocation, HostingPlacementRelocationProgress } from "@/app/lib/control-plane/types";
import { PlacementExecutorPanel } from "./PlacementExecutorPanel";

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), confirm: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (original) => ({ ...await original<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));

const defaults: HostingPlacementExecutorSettings = {
    enabled: false, minimumGainHours: 20, alwaysOnPolicy: "single-slot", noticeLeadHours: 1,
    updatedBy: null, reason: null, updatedAt: null,
};
const saved: HostingPlacementExecutorSettings = {
    ...defaults, enabled: true, updatedBy: "supabase:11111111-1111-4111-8111-111111111111", reason: "Start placement", updatedAt: "2026-10-18T12:00:00.000Z",
};

function relocation(relocationId: string, displayName: string, state: HostingPlacementRelocation["state"], extra: Partial<HostingPlacementRelocation> = {}): HostingPlacementRelocation {
    return {
        relocationId, serverId: `${relocationId}-server`, displayName, fromServiceName: "vps-uk-a", toServiceName: "vps-uk-b", targetRegion: "united-kingdom",
        mode: "offline", state, gainPairHoursPerWeek: 24.5, scheduledAt: "2026-10-18T10:00:00.000Z", announcementNoticeId: null, completionNoticeId: null,
        jobId: null, errorCode: null, createdAt: "2026-10-18T10:00:00.000Z", queuedAt: null, updatedAt: "2026-10-18T10:00:00.000Z", completedAt: null, ...extra,
    };
}

let current: HostingAdminPlacementExecutor;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("confirm", mocks.confirm);
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-only" } } });
    current = {
        settings: defaults,
        relocations: [
            relocation("a", "The Gang", "succeeded", { queuedAt: "2026-10-18T10:00:00.000Z", completedAt: "2026-10-18T10:20:00.000Z", jobId: "job-1" }),
            relocation("b", "March", "failed", { mode: "announced", errorCode: "placement_window_missed" }),
        ],
    };
    mocks.request.mockImplementation(async ({ operation, input }: { operation: string; input: Record<string, unknown> }) => {
        if (operation === "placement-executor") return current;
        const settings: Record<string, unknown> = { ...input };
        delete settings.expectedUpdatedAt;
        return { ...settings, updatedBy: "supabase:me", reason: input.reason ?? null, updatedAt: "2026-10-18T13:00:00.000Z" };
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Reflect.deleteProperty(document, "visibilityState");
});

function calls(operation: string) {
    return mocks.request.mock.calls.map(([request]) => request as { operation: string; input: Record<string, unknown> }).filter((request) => request.operation === operation);
}

function button(text: string) {
    return [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;
}

function automaticPlacement() {
    return container.querySelector<HTMLButtonElement>('button[role="switch"]')!;
}

async function flip() {
    await act(async () => automaticPlacement().click());
}

const ON_REASON = "Switched automatic placement on from the admin panel";
const OFF_REASON = "Switched automatic placement off from the admin panel";
const legacySettings = { maximumRelocationsPerDay: 2, minimumGainHours: 20, noticeLeadHours: 1, alwaysOnPolicy: "single-slot" } as const;

it("builds a switch's input with a fixed reason and the legacy settings as last read", () => {
    expect(placementExecutorSwitchInput(true, null, {})).toEqual({ enabled: true, expectedUpdatedAt: null, reason: ON_REASON });
    expect(placementExecutorSwitchInput(false, saved.updatedAt, legacySettings)).toEqual({ ...legacySettings, enabled: false, expectedUpdatedAt: saved.updatedAt, reason: OFF_REASON });
    expect(placementExecutorLegacyValues({ ...saved, maximumRelocationsPerDay: 2 })).toEqual(legacySettings);
    expect(placementExecutorLegacyValues({ enabled: true, updatedBy: null, reason: null, updatedAt: null })).toEqual({});
    // Each is sent back only as a value the read actually carried.
    expect(placementExecutorLegacyValues({ enabled: true, minimumGainHours: null, noticeLeadHours: undefined, alwaysOnPolicy: "any" })).toEqual({ alwaysOnPolicy: "any" });
    expect(placementExecutorLegacyValues(null)).toEqual({});
    expect(PLACEMENT_EXECUTOR_ENABLE_CONFIRMATION).toBe("Turn on automatic placement? The control plane will start moving servers by itself; "
        + "each move stops the game for a few minutes and changes the server's address and game port.");
});

it("shows one switch and nothing to configure", async () => {
    current = { ...current, settings: { ...saved, maximumRelocationsPerDay: 2 } };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(calls("placement-executor")).toEqual([expect.objectContaining({ input: {} })]);
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(automaticPlacement().getAttribute("aria-checked")).toBe("true");
    expect(automaticPlacement().getAttribute("aria-label")).toBe("Automatic placement");
    expect(container.textContent).toContain(PLACEMENT_EXECUTOR_DESCRIPTION);
    expect(PLACEMENT_EXECUTOR_DESCRIPTION).toBe("When on, the control plane moves servers to quieter VPSs, or to relieve a CPU shortage, by itself, one at a time. "
        + "A stopped server moves at once and stays stopped; a running server gets an hour's warning on its page and in game, then moves and starts again.");
    expect(container.textContent).toContain("On · relocating servers automatically");
    expect(container.textContent).toContain("On since");
    // Neither who switched it nor why, and none of the settings it used to have.
    for (const removed of ["supabase:", "Start placement", "Last changed", "Saved:", "Minimum gain", "Notice lead", "Always-on", "Reason", "pair-h/week", "per day", "Save settings", "Discard changes"]) {
        expect(container.textContent).not.toContain(removed);
    }
    expect(container.textContent).toContain("Live moves");
    const rows = [...container.querySelectorAll("li")].map((row) => row.textContent);
    expect(rows[0]).toContain("The Gang");
    expect(rows[0]).toContain("Moved");
    expect(rows[0]).toContain("+24.5");
    // The gain is pair-hours only; a move made for the CPU shortage it removes can show 0.0.
    expect(container.querySelector("li")!.querySelector('span[title^="Co-online pair-hours"]')!.getAttribute("title"))
        .toBe("Co-online pair-hours per week this move saves. A move made to relieve a CPU shortage can show 0.0.");
    expect(rows[1]).toContain("Announced");
    expect(rows[1]).toContain("Failed");
    expect(rows[1]).toContain("Cancelled because the move could not start within its announced window. placement_window_missed");
});

it("says only that it is off when it was never switched", async () => {
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(automaticPlacement().getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("Off · nothing moves automatically");
    expect(container.textContent).not.toContain("since");
});

it("asks before switching on, then sends the fixed reason and the legacy settings as read", async () => {
    current = { ...current, settings: { ...defaults, maximumRelocationsPerDay: 2 } };
    await act(async () => root.render(<PlacementExecutorPanel />));

    mocks.confirm.mockReturnValueOnce(false);
    await flip();
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(PLACEMENT_EXECUTOR_ENABLE_CONFIRMATION);
    expect(calls("set-placement-executor")).toHaveLength(0);
    expect(automaticPlacement().getAttribute("aria-checked")).toBe("false");

    mocks.confirm.mockReturnValueOnce(true);
    await flip();
    expect(calls("set-placement-executor")).toEqual([expect.objectContaining({ input: { ...legacySettings, enabled: true, expectedUpdatedAt: null, reason: ON_REASON } })]);
    expect(automaticPlacement().getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("On · relocating servers automatically");
    expect(container.querySelector('[role="status"].border-l-2')?.textContent).toBe("Automatic placement is on.");
});

it("switches off at once against the state it read", async () => {
    current = { ...current, settings: saved };
    await act(async () => root.render(<PlacementExecutorPanel />));
    await flip();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(calls("set-placement-executor")).toEqual([expect.objectContaining({
        input: { minimumGainHours: 20, noticeLeadHours: 1, alwaysOnPolicy: "single-slot", enabled: false, expectedUpdatedAt: saved.updatedAt, reason: OFF_REASON },
    })]);
    expect(container.textContent).toContain("Off · nothing moves automatically");
    expect(container.querySelector('[role="status"].border-l-2')?.textContent).toBe("Automatic placement is off.");
});

it("sends no legacy settings when the read had none", async () => {
    // A control plane that ignores the old settings may stop sending them.
    current = { ...current, settings: { enabled: false, updatedBy: null, reason: null, updatedAt: null } };
    await act(async () => root.render(<PlacementExecutorPanel />));
    mocks.confirm.mockReturnValueOnce(true);
    await flip();
    expect(calls("set-placement-executor")[0]?.input).toEqual({ enabled: true, expectedUpdatedAt: null, reason: ON_REASON });
});

it("sends back each legacy setting as the latest read gave it, polls and switches included", async () => {
    vi.useFakeTimers();
    current = { settings: { ...saved, maximumRelocationsPerDay: 2 }, status: { activeRelocationId: "live", queuedInLast24Hours: 1 }, relocations: [live] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    // A poll from a control plane that sends only some of them.
    current = { ...current, settings: { enabled: true, noticeLeadHours: 1, alwaysOnPolicy: "single-slot", updatedBy: null, reason: null, updatedAt: saved.updatedAt } };
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(calls("placement-executor")).toHaveLength(2);
    await flip();
    expect(calls("set-placement-executor")[0]?.input).toEqual({ noticeLeadHours: 1, alwaysOnPolicy: "single-slot", enabled: false, expectedUpdatedAt: saved.updatedAt, reason: OFF_REASON });

    // The switch's own response is the next read: it carries what this request sent.
    mocks.confirm.mockReturnValueOnce(true);
    await flip();
    expect(calls("set-placement-executor")[1]?.input).toEqual({ noticeLeadHours: 1, alwaysOnPolicy: "single-slot", enabled: true, expectedUpdatedAt: "2026-10-18T13:00:00.000Z", reason: ON_REASON });

    // A rollback to a control plane that requires them all reaches the page through a poll.
    current = { ...current, settings: { ...saved, maximumRelocationsPerDay: 2, updatedAt: "2026-10-18T13:00:00.000Z" } };
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    await flip();
    expect(calls("set-placement-executor")[2]?.input).toEqual({ ...legacySettings, enabled: false, expectedUpdatedAt: "2026-10-18T13:00:00.000Z", reason: OFF_REASON });
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
});

it("shows someone else's newer switch when the switch is stale", async () => {
    current = { ...current, settings: saved };
    await act(async () => root.render(<PlacementExecutorPanel />));
    const respond = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (request: { operation: string }) => {
        if (request.operation === "set-placement-executor") {
            current = { ...current, settings: { ...saved, updatedAt: "2026-10-19T15:00:00.000Z" } };
            throw new ControlPlaneAdminError("stale_interaction", "Settings changed.", false, "request");
        }
        return respond(request);
    });
    await flip();

    expect(calls("placement-executor")).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Someone else switched automatic placement meanwhile. Its current state is shown; switch it again if you still want to.");
    expect(automaticPlacement().getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('time[datetime="2026-10-19T15:00:00.000Z"]')).not.toBeNull();
});

it("retries a failed read", async () => {
    mocks.request.mockRejectedValueOnce(new ControlPlaneAdminError("control_plane_unavailable", "The control plane could not be reached.", true));
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("The control plane could not be reached.");
    expect(container.querySelector('button[role="switch"]')).toBeNull();
    await act(async () => button("Retry").click());
    expect(container.textContent).toContain("Off · nothing moves automatically");
});

it("lays a move's stops out as equal columns whose text wraps inside them", async () => {
    const back = relocation("back", "Going Back", "queued", { mode: "announced", progress: { ...restoring, step: null, returning: true } });
    const quest = relocation("quest", "Kofman's Quest", "succeeded", { completedAt: "2026-10-19T10:04:13.000Z", progress: offlineDone });
    current = { settings: saved, status: { activeRelocationId: "back", queuedInLast24Hours: 2 }, relocations: [quest, back] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    for (const [name, columns] of [["Kofman's Quest", 9], ["Going Back", 10]] as const) {
        const list = move(name).querySelector("ol")!;
        // Every stop gets the same share of the row, whatever it holds; a narrow panel scrolls rather than cuts.
        expect(list.className).toContain("grid");
        expect(list.style.gridTemplateColumns).toBe(`repeat(${columns}, minmax(5.5rem, 1fr))`);
        expect(list.parentElement!.className).toContain("overflow-x-auto");
        // The scrolling track itself takes focus, so a keyboard can scroll to later stops.
        expect(list.parentElement!.getAttribute("tabindex")).toBe("0");
        expect(list.parentElement!.getAttribute("role")).toBe("group");
        expect(list.parentElement!.getAttribute("aria-label")).toBe(`${name} move steps`);
        expect(list.parentElement!.className).toContain("focus-visible:outline-2");
        const stops = [...list.children];
        expect(stops).toHaveLength(columns);
        expect(stops.every((stop) => stop.tagName === "LI" && stop.classList.contains("min-w-0") && stop.classList.contains("break-words"))).toBe(true);
        // The separators are drawn in the gap, with no text of their own.
        expect(stops.slice(1).every((stop) => stop.lastElementChild!.getAttribute("aria-hidden") === "true" && stop.lastElementChild!.textContent === "")).toBe(true);
    }
    // A long note is its own line inside the stop, so it wraps instead of widening it.
    const warned = track("Kofman's Quest")[0]!;
    const note = [...warned.querySelectorAll("span.block")].find((line) => line.textContent === "No warning needed: the server was stopped")!;
    expect(note).toBeDefined();
    expect(warned.querySelector("span.flex")!.textContent).toBe("Warned: not needed");
});

// The contract's own example: a running server's move half way through, after both warnings went out.
const restoring: HostingPlacementRelocationProgress = {
    step: "restoring",
    steps: [
        { step: "preparing", reachedAt: "2026-10-19T14:52:10.020Z" },
        { step: "saving-and-stopping", reachedAt: "2026-10-19T14:52:14.611Z" },
        { step: "backing-up", reachedAt: "2026-10-19T14:53:20.104Z" },
        { step: "restoring", reachedAt: "2026-10-19T14:54:02.937Z" },
    ],
    jobState: "running", jobStartedAt: "2026-10-19T14:52:11.302Z", jobCompletedAt: null, restartsGame: true,
    warnings: [{ minutes: 60, state: "succeeded", sentAt: "2026-10-19T13:52:03.415Z" }, { minutes: 10, state: "succeeded", sentAt: "2026-10-19T14:42:04.877Z" }],
};
const offlineDone: HostingPlacementRelocationProgress = {
    step: null,
    steps: (["preparing", "saving-and-stopping", "backing-up", "restoring", "switching-address", "finishing"] as const)
        .map((step, index) => ({ step, reachedAt: new Date(Date.parse("2026-10-19T10:00:01.000Z") + index * 40_000).toISOString() })),
    jobState: "succeeded", jobStartedAt: "2026-10-19T10:00:00.000Z", jobCompletedAt: "2026-10-19T10:04:12.000Z", restartsGame: false, warnings: [],
};
const noJob: HostingPlacementRelocationProgress = { step: null, steps: [], jobState: null, jobStartedAt: null, jobCompletedAt: null, restartsGame: null, warnings: [] };
const live = relocation("live", "Calradia Company", "queued", {
    mode: "announced", fromServiceName: "vps-1a2b3c4d.vps.ovh.net", toServiceName: "vps-5e6f7a8b.vps.ovh.net", targetRegion: "germany",
    jobId: "job-live", queuedAt: "2026-10-19T14:52:10.020Z", progress: restoring,
});
const stoppedMove = relocation("parked", "Parked Server", "succeeded", {
    queuedAt: "2026-10-19T10:00:00.000Z", completedAt: "2026-10-19T10:04:13.000Z", jobId: "job-parked", progress: offlineDone,
});

/** One move's row, by its server's name. */
function move(name: string) {
    return [...container.querySelectorAll("li")].find((item) => item.querySelector("span")?.textContent === name)!;
}

/** A move's track stops, skipping the arrows between them. */
function track(name: string) {
    return [...move(name).querySelectorAll("ol > li:not([aria-hidden])")];
}

let visibility: DocumentVisibilityState = "visible";
async function setVisibility(state: DocumentVisibilityState) {
    visibility = state;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}

it("says what the executor is doing, with an informational count and no cap", async () => {
    current = { settings: saved, status: { activeRelocationId: "live", queuedInLast24Hours: 3 }, relocations: [stoppedMove, live] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(container.textContent).toContain("Moving now: Calradia Company (vps-1a2b3c4d → vps-5e6f7a8b), restoring · 3 moves queued in the last 24 hours");
    expect(container.textContent).not.toMatch(/ of 3|per day|daily|limit/u);
    await act(async () => root.unmount());

    root = createRoot(container);
    current = { settings: saved, status: { activeRelocationId: null, queuedInLast24Hours: 1 }, relocations: [stoppedMove] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(container.textContent).toContain("No move under way · 1 move queued in the last 24 hours");
});

it("follows a running move step by step, marking the current step and when each was reached", async () => {
    current = { settings: saved, status: { activeRelocationId: "live", queuedInLast24Hours: 3 }, relocations: [stoppedMove, live] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    // The move under way comes first although the control plane lists the finished one first.
    expect([...container.querySelectorAll("ul > li")].map((item) => item.querySelector("span")!.textContent)).toEqual(["Calradia Company", "Parked Server"]);
    expect(move("Calradia Company").textContent).toContain("vps-1a2b3c4d → vps-5e6f7a8b");
    expect(move("Calradia Company").textContent).toContain("Germany");
    expect(move("Calradia Company").querySelector("ol")!.getAttribute("aria-label")).toBe("Calradia Company: move steps");

    const stops = track("Calradia Company");
    expect(stops.map((stop) => stop.querySelector("span")!.textContent)).toEqual([
        "Warned: done", "Starting: done", "Saving & stopping: done", "Restore point: done", "Restoring: current step",
        "Switching address: not reached", "Starting game: not reached", "Finishing: not reached", "Done: not reached",
    ]);
    const currentSteps = move("Calradia Company").querySelectorAll('[aria-current="step"]');
    expect(currentSteps).toHaveLength(1);
    expect(currentSteps[0]!.textContent).toContain("Restoring");
    expect(currentSteps[0]!.querySelector("time")!.getAttribute("datetime")).toBe("2026-10-19T14:54:02.937Z");
    expect(stops[1]!.querySelector("time")!.getAttribute("datetime")).toBe("2026-10-19T14:52:10.020Z");
    expect(stops[5]!.querySelector("time")).toBeNull();
    expect(stops[0]!.textContent).toContain("60 min: sent");
    expect(stops[0]!.textContent).toContain("10 min: sent");
    expect([...stops[0]!.querySelectorAll("time")].map((time) => time.getAttribute("datetime"))).toEqual(["2026-10-19T13:52:03.415Z", "2026-10-19T14:42:04.877Z"]);
    expect(move("Calradia Company").textContent).not.toContain("Took");
});

it("shows a finished offline move that left its stopped server stopped", async () => {
    current = { settings: saved, status: { activeRelocationId: null, queuedInLast24Hours: 1 }, relocations: [stoppedMove] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    const stops = track("Parked Server");
    expect(stops[0]!.textContent).toBe("Warned: not neededNo warning needed: the server was stopped");
    expect(stops.map((stop) => stop.querySelector("span")!.textContent)).toContain("Stays stopped: not needed");
    expect(move("Parked Server").textContent).not.toContain("Starting game");
    expect(stops.at(-1)!.querySelector("span")!.textContent).toBe("Done: done");
    expect(stops.at(-1)!.querySelector("time")!.getAttribute("datetime")).toBe("2026-10-19T10:04:13.000Z");
    expect(move("Parked Server").textContent).toContain("Took 4 min 12 s");
    expect(move("Parked Server").querySelector('[aria-current="step"]')).toBeNull();
});

it("shows an announced move waiting on its warnings", async () => {
    const announced = relocation("soon", "Game Night", "announced", {
        mode: "announced", scheduledAt: "2026-10-19T15:51:59.999Z",
        progress: { ...noJob, warnings: [{ minutes: 60, state: "succeeded", sentAt: "2026-10-19T14:52:03.415Z" }, { minutes: 10, state: "queued", sentAt: null }] },
    });
    current = { settings: saved, status: { activeRelocationId: "soon", queuedInLast24Hours: 0 }, relocations: [announced] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(container.textContent).toContain("Announced: Game Night moves");
    const warned = move("Game Night").querySelector('[aria-current="step"]')!;
    expect(warned.querySelector("span")!.textContent).toBe("Warned: current step");
    expect(warned.textContent).toContain("60 min: sent");
    expect(warned.querySelector("time")!.getAttribute("datetime")).toBe("2026-10-19T14:52:03.415Z");
    expect(warned.textContent).toContain("10 min: pending");
    // With no job yet, the game is started only if it is still running when the move begins, and the stop says so in text.
    const starting = track("Game Night").find((stop) => stop.textContent?.startsWith("Starting game"))!;
    expect(starting.textContent).toBe("Starting game: not reachedOnly if the game is running when the move begins");
});

it("explains why a move failed", async () => {
    current = {
        settings: saved, status: { activeRelocationId: null, queuedInLast24Hours: 2 },
        relocations: [
            relocation("lost", "Lost Job", "failed", { errorCode: "placement_job_missing", completedAt: "2026-10-19T15:10:00.000Z", progress: { ...restoring, step: null, jobState: "failed" } }),
            relocation("broke", "Broken Cutover", "failed", { errorCode: "relocation_cutover_failed", completedAt: "2026-10-19T15:20:00.000Z", progress: { ...restoring, step: null, jobState: "failed" } }),
        ],
    };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(move("Lost Job").textContent).toContain("Its relocation job could not be found. placement_job_missing");
    expect(move("Broken Cutover").textContent).toContain("The move ended with an error. relocation_cutover_failed");
    expect(track("Broken Cutover").at(-1)!.querySelector("span")!.textContent).toBe("Failed: failed");
    expect(move("Broken Cutover").querySelector('[aria-current="step"]')).toBeNull();
});

it("still shows moves from an older control plane without progress or status", async () => {
    current = { settings: defaults, relocations: [relocation("a", "The Gang", "succeeded", { completedAt: "2026-10-18T10:20:00.000Z" })] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(move("The Gang").textContent).toContain("Scheduled");
    expect(move("The Gang").querySelector("ol")).toBeNull();
    expect(container.textContent).not.toContain("queued in the last 24 hours");
    expect(container.querySelector('[aria-label="Servers waiting to retry"]')).toBeNull();
    expect(container.textContent).toContain("Off · nothing moves automatically");
});

it("re-reads the executor every 15 seconds while a move is active and the page is visible", async () => {
    vi.useFakeTimers();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    current = { settings: saved, status: { activeRelocationId: "live", queuedInLast24Hours: 3 }, relocations: [live] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(calls("placement-executor")).toHaveLength(1);

    // Someone else's switch arrives with the next read, but the switch keeps what it was read with.
    current = { ...current, settings: { ...saved, enabled: false }, relocations: [{ ...live, progress: { ...restoring, step: "switching-address", steps: [...restoring.steps, { step: "switching-address", reachedAt: "2026-10-19T14:55:00.000Z" }] } }] };
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(calls("placement-executor")).toHaveLength(2);
    expect(move("Calradia Company").querySelector('[aria-current="step"]')!.textContent).toContain("Switching address");
    expect(automaticPlacement().getAttribute("aria-checked")).toBe("true");

    await setVisibility("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(calls("placement-executor")).toHaveLength(2);
    await setVisibility("visible");
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(calls("placement-executor")).toHaveLength(3);

    // Once nothing is announced or queued, it stops.
    current = { ...current, status: { activeRelocationId: null, queuedInLast24Hours: 3 }, relocations: [{ ...live, state: "succeeded", completedAt: "2026-10-19T14:58:00.000Z" }] };
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(calls("placement-executor")).toHaveLength(4);
    expect(move("Calradia Company").textContent).toContain("Moved");
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(calls("placement-executor")).toHaveLength(4);
});

it("does not re-read the executor while no move is active", async () => {
    vi.useFakeTimers();
    current = { settings: saved, status: { activeRelocationId: null, queuedInLast24Hours: 1 }, relocations: [stoppedMove] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(calls("placement-executor")).toHaveLength(1);
});

it("shows a move putting its server back as returning, not as a stalled move", async () => {
    const back = { ...live, progress: { ...restoring, step: null, returning: true } };
    current = { settings: saved, status: { activeRelocationId: "live", queuedInLast24Hours: 1 }, relocations: [back] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(container.textContent).toContain("Returning: Calradia Company, putting the server back on its original VPS (vps-1a2b3c4d) · 1 move queued in the last 24 hours");
    expect(container.textContent).not.toContain("Moving now");
    expect(move("Calradia Company").textContent).toContain("Returning: putting the server back on its original VPS");
    const currentStep = move("Calradia Company").querySelector('[aria-current="step"]')!;
    expect(currentStep.textContent).toBe("Returning: current stepPutting the server back on its original VPS");
    expect(track("Calradia Company").at(-1)!.textContent).toBe("Done: not reachedThe move failed, so the server goes back");
});

it.each([
    ["failed", "Move failed", "The job failed; the executor records the outcome on its next run"],
    ["cancelled", "Move cancelled", "The job was cancelled; the executor records the outcome on its next run"],
] as const)("shows a queued move whose job %s before the executor recorded it", async (jobState, label, note) => {
    const ended = { ...live, progress: { ...restoring, step: "restoring" as const, jobState, jobCompletedAt: "2026-10-19T14:56:00.000Z" } };
    current = { settings: saved, status: { activeRelocationId: "live", queuedInLast24Hours: 1 }, relocations: [ended] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(container.textContent).toContain(`${label}: Calradia Company, ${note.charAt(0).toLowerCase()}${note.slice(1)}`);
    expect(container.textContent).not.toContain("Moving now");
    expect(move("Calradia Company").textContent).toContain(`${label}: ${note.charAt(0).toLowerCase()}${note.slice(1)}`);
    expect(move("Calradia Company").querySelector('[aria-current="step"]')).toBeNull();
    expect(track("Calradia Company").at(-1)!.textContent).toBe(`Done: not reached${note}`);
});

it("lists servers waiting to retry after a failed or cancelled move", async () => {
    current = {
        settings: saved,
        status: { activeRelocationId: null, queuedInLast24Hours: 2, backedOff: [
            { serverId: "lost-server", relocationId: "lost", until: "2026-10-20T15:10:00.000Z", errorCode: "placement_window_missed" },
            { serverId: "unlisted-server", relocationId: "older", until: "2026-10-20T09:00:00.000Z", errorCode: null },
        ] },
        relocations: [relocation("lost", "Lost Job", "cancelled", { errorCode: "placement_window_missed", completedAt: "2026-10-19T15:10:00.000Z" })],
    };
    await act(async () => root.render(<PlacementExecutorPanel />));
    const waiting = [...container.querySelector('[aria-label="Servers waiting to retry"]')!.querySelectorAll("li")];
    expect(waiting.map((item) => item.textContent)).toEqual([
        expect.stringMatching(/^Waiting to retry: Lost Job until .+ \(Cancelled because the move could not start within its announced window\)$/u),
        expect.stringMatching(/^Waiting to retry: unlisted-server until .+[^)]$/u),
    ]);
    expect(waiting[0]!.querySelector("time")!.getAttribute("datetime")).toBe("2026-10-20T15:10:00.000Z");
});

it("never runs the stale-save reload alongside a poll already reading", async () => {
    vi.useFakeTimers();
    current = { settings: saved, status: { activeRelocationId: "live", queuedInLast24Hours: 1 }, relocations: [live] };
    let reading = 0;
    let most = 0;
    let releasePoll: (() => void) | null = null;
    const respond = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (request: { operation: string }) => {
        if (request.operation === "set-placement-executor") {
            current = { ...current, settings: { ...saved, updatedAt: "2026-10-19T15:00:00.000Z" } };
            throw new ControlPlaneAdminError("stale_interaction", "Settings changed.", false, "request");
        }
        reading += 1;
        most = Math.max(most, reading);
        try {
            // The first poll waits until the test lets it finish.
            if (calls("placement-executor").length === 2) await new Promise<void>((resolve) => { releasePoll = resolve; });
            return await respond(request);
        } finally {
            reading -= 1;
        }
    });
    await act(async () => root.render(<PlacementExecutorPanel />));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(calls("placement-executor")).toHaveLength(2);
    expect(releasePoll).not.toBeNull();

    await flip();
    // The reload waits for the poll rather than reading beside it.
    expect(calls("placement-executor")).toHaveLength(2);
    await act(async () => { releasePoll!(); await vi.advanceTimersByTimeAsync(0); });
    expect(calls("placement-executor")).toHaveLength(3);
    expect(most).toBe(1);
    expect(container.querySelector('time[datetime="2026-10-19T15:00:00.000Z"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Someone else switched automatic placement meanwhile. Its current state is shown; switch it again if you still want to.");
});

it("keeps one read at a time when the page is shown again during a poll and a stale reload follows", async () => {
    vi.useFakeTimers();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    current = { settings: saved, status: { activeRelocationId: "live", queuedInLast24Hours: 1 }, relocations: [live] };
    let reading = 0;
    let most = 0;
    let releasePoll: (() => void) | null = null;
    const respond = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (request: { operation: string }) => {
        if (request.operation === "set-placement-executor") {
            current = { ...current, settings: { ...saved, updatedAt: "2026-10-19T15:00:00.000Z" } };
            throw new ControlPlaneAdminError("stale_interaction", "Settings changed.", false, "request");
        }
        reading += 1;
        most = Math.max(most, reading);
        try {
            if (calls("placement-executor").length === 2) await new Promise<void>((resolve) => { releasePoll = resolve; });
            // Later reads take a moment, so two started together would be seen reading at once.
            else if (calls("placement-executor").length > 2) await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
            return await respond(request);
        } finally {
            reading -= 1;
        }
    });
    await act(async () => root.render(<PlacementExecutorPanel />));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(releasePoll).not.toBeNull();

    // Shown again while the poll reads: the poll will read again once this one ends.
    await setVisibility("hidden");
    await setVisibility("visible");
    // A switch is rejected as stale, so the reload queues behind the poll.
    await flip();
    expect(calls("placement-executor")).toHaveLength(2);

    // The poll's second read joins the reload's rather than starting beside it.
    await act(async () => { releasePoll!(); await vi.advanceTimersByTimeAsync(100); });
    expect(most).toBe(1);
    expect(calls("placement-executor")).toHaveLength(3);
    expect(container.querySelector('time[datetime="2026-10-19T15:00:00.000Z"]')).not.toBeNull();
});

it("says to reload when the state after a stale switch cannot be loaded", async () => {
    current = { ...current, settings: saved };
    await act(async () => root.render(<PlacementExecutorPanel />));
    const respond = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (request: { operation: string }) => {
        if (request.operation === "set-placement-executor") throw new ControlPlaneAdminError("stale_interaction", "Settings changed.", false, "request");
        if (request.operation === "placement-executor") throw new ControlPlaneAdminError("control_plane_unavailable", "Unreachable.", true);
        return respond(request);
    });
    await flip();
    expect(calls("placement-executor")).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Someone else switched automatic placement meanwhile, and its current state could not be loaded. Reload the page before switching again.");
    expect(container.textContent).not.toContain("Its current state is shown");
});
