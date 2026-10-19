import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import { placementExecutorEnableConfirmation, placementExecutorInput } from "@/app/lib/control-plane/placement";
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

async function check(name: string, checked: boolean) {
    await act(async () => {
        const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        if (input.checked !== checked) input.click();
    });
}

async function type(name: string, value: string) {
    await act(async () => {
        const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function save() {
    await act(async () => button("Save settings").click());
}

it("validates settings and spells out what enabling does", () => {
    const form = { enabled: true, minimumGainHours: "20", noticeLeadHours: "48", alwaysOnPolicy: "single-slot", reason: "  " };
    expect(placementExecutorInput(form, null)).toEqual({ input: { enabled: true, minimumGainHours: 20, noticeLeadHours: 48, alwaysOnPolicy: "single-slot", expectedUpdatedAt: null } });
    expect(placementExecutorInput({ ...form, reason: "Quarterly rebalance" }, saved.updatedAt)).toMatchObject({ input: { reason: "Quarterly rebalance", expectedUpdatedAt: saved.updatedAt } });
    // The legacy compatibility field is echoed only as a number the latest read gave.
    expect(placementExecutorInput(form, null, 3)).toEqual({ input: { enabled: true, maximumRelocationsPerDay: 3, minimumGainHours: 20, noticeLeadHours: 48, alwaysOnPolicy: "single-slot", expectedUpdatedAt: null } });
    for (const value of [undefined, null, "3"]) expect(placementExecutorInput(form, null, value)).not.toMatchObject({ input: { maximumRelocationsPerDay: expect.anything() } });
    expect(placementExecutorInput({ ...form, minimumGainHours: "0.5" }, null)).toEqual({ error: "Minimum gain must be a whole number from 1 to 168." });
    expect(placementExecutorInput({ ...form, alwaysOnPolicy: "sometimes" }, null)).toEqual({ error: "Choose where always-on servers may move." });
    const confirmation = placementExecutorEnableConfirmation({ minimumGainHours: 20, noticeLeadHours: 48, alwaysOnPolicy: "single-slot" });
    // Moves are not rate limited, so the confirmation names no daily number.
    expect(confirmation).toContain("relocate customer servers to other VPSs by itself, one at a time, whenever a move saves at least 20 pair-hours a week.");
    expect(confirmation).not.toMatch(/24 hours|per day|daily/u);
    expect(confirmation).toContain("changes the server's IP address and game port");
    expect(confirmation).toContain("only to one-slot VPSs, which they never share");
    expect(confirmation).toContain("A running server is moved 48 hours after a notice on its page");
    const anywhere = placementExecutorEnableConfirmation({ minimumGainHours: 20, noticeLeadHours: 1, alwaysOnPolicy: "any" });
    expect(anywhere).toContain("A running server is moved an hour after a notice on its page, with in-game warnings");
    expect(anywhere).not.toContain("Always-on");
    const never = placementExecutorEnableConfirmation({ minimumGainHours: 20, noticeLeadHours: 1, alwaysOnPolicy: "none" });
    expect(never).toContain("Stopped servers move at once. A running server that is not always-on is moved an hour after a notice on its page, "
        + "with in-game warnings an hour and ten minutes ahead; the move stops the game and starts it again on the new VPS. Always-on servers are never moved.");
    expect(never).not.toContain("A running server is moved");
});

it("shows the current state, its defaults and recent automatic relocations, with no moves-per-day setting", async () => {
    await act(async () => root.render(<PlacementExecutorPanel />));

    expect(calls("placement-executor")).toEqual([expect.objectContaining({ input: {} })]);
    expect(container.textContent).toContain("Off · nothing moves automatically");
    expect(container.textContent).toContain("Never saved; these are the control plane's defaults.");
    expect(container.textContent).toContain("always-on servers: only to one-slot VPSs (never shared)");
    expect(container.querySelector<HTMLInputElement>('input[name="enabled"]')!.checked).toBe(false);
    expect(container.querySelector('input[name="maximumRelocationsPerDay"]')).toBeNull();
    expect(container.textContent).not.toMatch(/per day|Relocations per day|daily/u);
    // The control plane's default notice lead time is one hour.
    expect(container.querySelector<HTMLInputElement>('input[name="noticeLeadHours"]')!.value).toBe("1");
    expect(container.querySelector<HTMLSelectElement>('select[name="alwaysOnPolicy"]')!.value).toBe("single-slot");
    expect(container.textContent).toContain("Live moves");
    const rows = [...container.querySelectorAll("li")].map((row) => row.textContent);
    expect(rows[0]).toContain("The Gang");
    expect(rows[0]).toContain("Moved");
    expect(rows[0]).toContain("+24.5");
    expect(rows[1]).toContain("Announced");
    expect(rows[1]).toContain("Failed");
    expect(rows[1]).toContain("Cancelled because the move could not start within its announced window. placement_window_missed");
});

it("needs explicit confirmation to turn the executor on", async () => {
    await act(async () => root.render(<PlacementExecutorPanel />));
    await check("enabled", true);
    expect(container.textContent).toContain("Saving turns automatic relocation on.");

    mocks.confirm.mockReturnValueOnce(false);
    await save();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(String(mocks.confirm.mock.calls[0]?.[0])).toContain("Turn on automatic placement?");
    expect(calls("set-placement-executor")).toHaveLength(0);

    mocks.confirm.mockReturnValueOnce(true);
    await type("reason", "Start placement");
    await save();
    expect(calls("set-placement-executor")).toEqual([expect.objectContaining({
        input: { enabled: true, minimumGainHours: 20, noticeLeadHours: 1, alwaysOnPolicy: "single-slot", expectedUpdatedAt: null, reason: "Start placement" },
    })]);
    expect(container.textContent).toContain("On · relocating servers automatically");
    expect(container.querySelector('[role="status"].border-l-2')?.textContent).toBe("Saved. Automatic placement is on.");
});

it("turns the executor off against the generation it read, without a confirmation", async () => {
    current = { ...current, settings: saved };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(container.textContent).toContain("On · relocating servers automatically");
    expect(container.textContent).toContain("Start placement");
    await check("enabled", false);
    await save();

    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(calls("set-placement-executor")[0]?.input).toMatchObject({ enabled: false, expectedUpdatedAt: saved.updatedAt });
    expect(calls("set-placement-executor")[0]?.input).not.toHaveProperty("reason");
    expect(container.textContent).toContain("Off · nothing moves automatically");
});

it("reloads someone else's newer settings when the save is stale", async () => {
    await act(async () => root.render(<PlacementExecutorPanel />));
    await type("noticeLeadHours", "6");
    const respond = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (request: { operation: string }) => {
        if (request.operation === "set-placement-executor") {
            current = { ...current, settings: { ...saved, enabled: false, noticeLeadHours: 4 } };
            throw new ControlPlaneAdminError("stale_interaction", "Settings changed.", false, "request");
        }
        return respond(request);
    });
    await save();

    expect(calls("placement-executor")).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Someone else changed these settings. The current settings are shown; review them and save again.");
    expect(container.querySelector<HTMLInputElement>('input[name="noticeLeadHours"]')!.value).toBe("4");
    expect(container.textContent).toContain("Start placement");
});

it("rejects out-of-range settings before saving and retries a failed read", async () => {
    mocks.request.mockRejectedValueOnce(new ControlPlaneAdminError("control_plane_unavailable", "The control plane could not be reached.", true));
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("The control plane could not be reached.");
    await act(async () => button("Retry").click());
    expect(container.textContent).toContain("Off · nothing moves automatically");

    await type("noticeLeadHours", "200");
    // The browser's own range check blocks a click; dispatch the submit to reach the panel's validation.
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Notice lead time must be a whole number from 1 to 168.");
    expect(calls("set-placement-executor")).toHaveLength(0);
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

it("sends the legacy compatibility field back exactly as read, without ever showing it", async () => {
    // A control plane may send the field; an older one requires it back.
    current = { ...current, settings: { ...defaults, maximumRelocationsPerDay: 7 } };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(container.querySelector('input[name="maximumRelocationsPerDay"]')).toBeNull();
    expect(container.textContent).not.toMatch(/per day|daily|7 in any/u);
    await type("noticeLeadHours", "2");
    await save();
    expect(calls("set-placement-executor")[0]?.input).toEqual({ enabled: false, maximumRelocationsPerDay: 7, minimumGainHours: 20, noticeLeadHours: 2, alwaysOnPolicy: "single-slot", expectedUpdatedAt: null });
    // The saved settings are the last read: while they carry it, it goes back; once they do not, it is left out.
    const respond = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (request: { operation: string }) => {
        const result = await respond(request);
        if (request.operation !== "set-placement-executor") return result;
        const settings = { ...(result as Record<string, unknown>) };
        delete settings.maximumRelocationsPerDay;
        return settings;
    });
    await save();
    expect(calls("set-placement-executor")[1]?.input).toMatchObject({ maximumRelocationsPerDay: 7 });
    await save();
    expect(calls("set-placement-executor")[2]?.input).not.toHaveProperty("maximumRelocationsPerDay");
    expect(container.textContent).not.toMatch(/per day|daily/u);
});

it("leaves the legacy compatibility field out of a save when the read had none", async () => {
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(container.textContent).not.toMatch(/per day|daily/u);
    await save();
    expect(calls("set-placement-executor")[0]?.input).toEqual({ enabled: false, minimumGainHours: 20, noticeLeadHours: 1, alwaysOnPolicy: "single-slot", expectedUpdatedAt: null });
    expect(container.querySelector('[role="status"].border-l-2')?.textContent).toBe("Saved. Automatic placement is off.");
});

it("re-reads the executor every 15 seconds while a move is active and the page is visible", async () => {
    vi.useFakeTimers();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    current = { settings: saved, status: { activeRelocationId: "live", queuedInLast24Hours: 3 }, relocations: [live] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    expect(calls("placement-executor")).toHaveLength(1);

    // Someone else's settings arrive with the next read, but the form keeps what it was read with.
    current = { ...current, settings: { ...saved, noticeLeadHours: 9 }, relocations: [{ ...live, progress: { ...restoring, step: "switching-address", steps: [...restoring.steps, { step: "switching-address", reachedAt: "2026-10-19T14:55:00.000Z" }] } }] };
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(calls("placement-executor")).toHaveLength(2);
    expect(move("Calradia Company").querySelector('[aria-current="step"]')!.textContent).toContain("Switching address");
    expect(container.querySelector<HTMLInputElement>('input[name="noticeLeadHours"]')!.value).toBe("1");

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

it("sends back the legacy compatibility field from the latest read, polls included", async () => {
    vi.useFakeTimers();
    current = { settings: saved, status: { activeRelocationId: "live", queuedInLast24Hours: 1 }, relocations: [live] };
    await act(async () => root.render(<PlacementExecutorPanel />));
    // A rollback to a control plane that requires the field reaches the page through a poll.
    current = { ...current, settings: { ...saved, maximumRelocationsPerDay: 5 } };
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(calls("placement-executor")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/per day|daily/u);
    await save();
    expect(calls("set-placement-executor")[0]?.input).toMatchObject({ maximumRelocationsPerDay: 5, expectedUpdatedAt: saved.updatedAt });

    // A poll from a control plane that no longer sends it drops it again.
    current = { ...current, settings: saved };
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(calls("placement-executor")).toHaveLength(3);
    await save();
    expect(calls("set-placement-executor")[1]?.input).not.toHaveProperty("maximumRelocationsPerDay");
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
            current = { ...current, settings: { ...saved, noticeLeadHours: 4, updatedAt: "2026-10-19T15:00:00.000Z" } };
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

    await save();
    // The reload waits for the poll rather than reading beside it.
    expect(calls("placement-executor")).toHaveLength(2);
    await act(async () => { releasePoll!(); await vi.advanceTimersByTimeAsync(0); });
    expect(calls("placement-executor")).toHaveLength(3);
    expect(most).toBe(1);
    expect(container.querySelector<HTMLInputElement>('input[name="noticeLeadHours"]')!.value).toBe("4");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Someone else changed these settings. The current settings are shown; review them and save again.");
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
            current = { ...current, settings: { ...saved, noticeLeadHours: 4, updatedAt: "2026-10-19T15:00:00.000Z" } };
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
    // A save is rejected as stale, so the reload queues behind the poll.
    await save();
    expect(calls("placement-executor")).toHaveLength(2);

    // The poll's second read joins the reload's rather than starting beside it.
    await act(async () => { releasePoll!(); await vi.advanceTimersByTimeAsync(100); });
    expect(most).toBe(1);
    expect(calls("placement-executor")).toHaveLength(3);
    expect(container.querySelector<HTMLInputElement>('input[name="noticeLeadHours"]')!.value).toBe("4");
});
