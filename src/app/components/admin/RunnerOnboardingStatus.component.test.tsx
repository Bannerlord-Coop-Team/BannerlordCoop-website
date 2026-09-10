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

it("preserves the stopped-server gate in compact mode", async () => {
    await renderRunner({ targetSourceCommit: "new-source", runningServers: 1 });
    expect(actionButton("Stop servers first").disabled).toBe(true);
});

async function renderRunner({ targetSourceCommit, runningServers }: { targetSourceCommit: string; runningServers: number }) {
    await act(async () => root.render(<RunnerOnboardingStatus
        compact
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
