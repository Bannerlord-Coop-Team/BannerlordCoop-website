import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RunnerOnboardingStatus } from "./RunnerOnboardingStatus";

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", () => ({ requestControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

it("keeps the current-runner control visible without expanded metadata", async () => {
    await renderRunner({ targetSourceCommit: "current-source", runningServers: 2 });
    const button = actionButton("Runner current");
    expect(button.disabled).toBe(true);
    expect(container.textContent).not.toContain("Runner Active");
    expect(container.textContent).not.toContain("current-sour");
});

it("offers the same compact control for an actionable update", async () => {
    await renderRunner({ targetSourceCommit: "new-source", runningServers: 0 });
    expect(actionButton("Update runner").disabled).toBe(false);
});

it("sends the host row's provider with a runner update", async () => {
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
    mocks.request.mockResolvedValue({});
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderRunner({ targetSourceCommit: "new-source", runningServers: 0 });
    await act(async () => actionButton("Update runner").click());
    confirm.mockRestore();
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
        operation: "update-vps-runner",
        input: expect.objectContaining({ provider: "contabo-vps", serviceName: "host-a" }),
    }));
});

it("preserves the stopped-server gate in compact mode", async () => {
    await renderRunner({ targetSourceCommit: "new-source", runningServers: 1 });
    expect(actionButton("Stop servers first").disabled).toBe(true);
});

async function renderRunner({ targetSourceCommit, runningServers }: { targetSourceCommit: string; runningServers: number }) {
    await act(async () => root.render(<RunnerOnboardingStatus
        compact
        provider="contabo-vps"
        serviceName="host-a"
        runningServers={runningServers}
        targetSourceCommit={targetSourceCommit}
        onboarding={{ state: "succeeded", progressStage: "runner-active", errorCode: null, sourceCommit: "current-source", updatedAt: "2026-09-10T18:00:00.000Z" }}
        update={null}
    />));
}

function actionButton(text: string) {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === text);
    expect(button, text).toBeDefined();
    return button!;
}


it("uses the parent live refresh after a mutation and leaves polling to it", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
    mocks.request.mockResolvedValue({});
    try {
        await act(async () => root.render(<RunnerOnboardingStatus
            provider="ovhcloud-vps" serviceName="host-a" runningServers={0} targetSourceCommit="new-source"
            onboarding={null} update={null} onRefresh={refresh}
        />));
        await act(async () => actionButton("Onboard runner").click());
        expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
            operation: "onboard-vps-host",
            input: { provider: "ovhcloud-vps", serviceName: "host-a", mode: "enroll" },
        }));
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(mocks.refresh).not.toHaveBeenCalled();
        await act(async () => root.render(<RunnerOnboardingStatus
            provider="ovhcloud-vps" serviceName="host-a" runningServers={0} targetSourceCommit="new-source"
            onboarding={{ state: "running", progressStage: "runner-installing", errorCode: null, sourceCommit: null, updatedAt: "2026-09-10T18:00:00.000Z" }}
            update={null} onRefresh={refresh}
        />));
        await act(async () => vi.advanceTimersByTimeAsync(15_000));
        expect(mocks.refresh).not.toHaveBeenCalled();
        expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
        vi.useRealTimers();
    }
});

it.each([true, false])("shows a decommission paused by the switch as a waiting state, not an error: compact=%s", async (compact) => {
    await act(async () => root.render(<RunnerOnboardingStatus
        compact={compact} onRefresh={vi.fn()}
        provider="ovhcloud-vps" serviceName="host-a" runningServers={0} targetSourceCommit={null}
        onboarding={{ state: "retry-wait", progressStage: "slot-decommission-paused", errorCode: "slot_decommission_disabled", sourceCommit: null, updatedAt: "2026-10-22T09:00:00.000Z" }}
        update={null}
    />));
    const meaning = "Decommission paused: the dynamic slot capacity switch is off. The host takes no new servers until it is switched on again.";
    expect(container.textContent).toContain("Slot Decommission Paused");
    expect(container.textContent).toContain(meaning);
    expect(container.querySelector(".text-red-200")).toBeNull();
    expect(container.querySelector('[title="slot_decommission_disabled"]')?.textContent).toBe(meaning);
    expect(container.querySelector("span[title]")?.getAttribute("title")).toBe(meaning);
});

it("still shows any other onboarding error code as an error", async () => {
    await act(async () => root.render(<RunnerOnboardingStatus
        compact onRefresh={vi.fn()}
        provider="ovhcloud-vps" serviceName="host-a" runningServers={0} targetSourceCommit={null}
        onboarding={{ state: "failed", progressStage: "slot-decommission-kept-slot-1", errorCode: "slot_decommission_kept_game_newly_failed", sourceCommit: null, updatedAt: "2026-10-22T09:00:00.000Z" }}
        update={null}
    />));
    expect([...container.querySelectorAll("p.text-red-200")].map((line) => line.textContent)).toEqual(["slot_decommission_kept_game_newly_failed"]);
    expect(container.textContent).not.toContain("Decommission paused");
});
