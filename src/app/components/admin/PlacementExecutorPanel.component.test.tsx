import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import { placementExecutorEnableConfirmation, placementExecutorInput } from "@/app/lib/control-plane/placement";
import type { HostingAdminPlacementExecutor, HostingPlacementExecutorSettings, HostingPlacementRelocation } from "@/app/lib/control-plane/types";
import { PlacementExecutorPanel } from "./PlacementExecutorPanel";

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), confirm: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (original) => ({ ...await original<typeof import("@/app/lib/control-plane/client")>(), requestControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));

const defaults: HostingPlacementExecutorSettings = {
    enabled: false, maximumRelocationsPerDay: 2, minimumGainHours: 20, alwaysOnPolicy: "single-slot", noticeLeadHours: 24,
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
    const form = { enabled: true, maximumRelocationsPerDay: "3", minimumGainHours: "20", noticeLeadHours: "48", alwaysOnPolicy: "single-slot", reason: "  " };
    expect(placementExecutorInput(form, null)).toEqual({ input: { enabled: true, maximumRelocationsPerDay: 3, minimumGainHours: 20, noticeLeadHours: 48, alwaysOnPolicy: "single-slot", expectedUpdatedAt: null } });
    expect(placementExecutorInput({ ...form, reason: "Quarterly rebalance" }, saved.updatedAt)).toMatchObject({ input: { reason: "Quarterly rebalance", expectedUpdatedAt: saved.updatedAt } });
    expect(placementExecutorInput({ ...form, maximumRelocationsPerDay: "25" }, null)).toEqual({ error: "Relocations per day must be a whole number from 1 to 24." });
    expect(placementExecutorInput({ ...form, minimumGainHours: "0.5" }, null)).toEqual({ error: "Minimum gain must be a whole number from 1 to 168." });
    expect(placementExecutorInput({ ...form, alwaysOnPolicy: "sometimes" }, null)).toEqual({ error: "Choose where always-on servers may move." });
    const confirmation = placementExecutorEnableConfirmation({ maximumRelocationsPerDay: 3, minimumGainHours: 20, noticeLeadHours: 48, alwaysOnPolicy: "single-slot" });
    expect(confirmation).toContain("relocate customer servers to other VPSs by itself, up to 3 in any 24 hours");
    expect(confirmation).toContain("changes the server's IP address and game port");
    expect(confirmation).toContain("only to one-slot VPSs, which they never share");
    expect(confirmation).toContain("at least 48 hours ahead");
    expect(placementExecutorEnableConfirmation({ maximumRelocationsPerDay: 1, minimumGainHours: 20, noticeLeadHours: 24, alwaysOnPolicy: "none" })).toContain("Always-on servers are never moved.");
});

it("shows the current state, its defaults and recent automatic relocations", async () => {
    await act(async () => root.render(<PlacementExecutorPanel />));

    expect(calls("placement-executor")).toEqual([expect.objectContaining({ input: {} })]);
    expect(container.textContent).toContain("Off · nothing moves automatically");
    expect(container.textContent).toContain("Never saved; these are the control plane's defaults.");
    expect(container.textContent).toContain("always-on servers: only to one-slot VPSs (never shared)");
    expect(container.querySelector<HTMLInputElement>('input[name="enabled"]')!.checked).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[name="maximumRelocationsPerDay"]')!.value).toBe("2");
    expect(container.querySelector<HTMLSelectElement>('select[name="alwaysOnPolicy"]')!.value).toBe("single-slot");
    const rows = [...container.querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(rows[0]).toContain("The Gang");
    expect(rows[0]).toContain("Moved");
    expect(rows[0]).toContain("+24.5");
    expect(rows[1]).toContain("Announced");
    expect(rows[1]).toContain("Failed");
    expect(rows[1]).toContain("placement_window_missed");
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
        input: { enabled: true, maximumRelocationsPerDay: 2, minimumGainHours: 20, noticeLeadHours: 24, alwaysOnPolicy: "single-slot", expectedUpdatedAt: null, reason: "Start placement" },
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
    await type("maximumRelocationsPerDay", "6");
    const respond = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (request: { operation: string }) => {
        if (request.operation === "set-placement-executor") {
            current = { ...current, settings: { ...saved, enabled: false, maximumRelocationsPerDay: 4 } };
            throw new ControlPlaneAdminError("stale_interaction", "Settings changed.", false, "request");
        }
        return respond(request);
    });
    await save();

    expect(calls("placement-executor")).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Someone else changed these settings. The current settings are shown; review them and save again.");
    expect(container.querySelector<HTMLInputElement>('input[name="maximumRelocationsPerDay"]')!.value).toBe("4");
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
