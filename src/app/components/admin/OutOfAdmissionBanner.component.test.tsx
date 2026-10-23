import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { OutOfAdmissionBanner, outOfAdmissionHosts } from "./OutOfAdmissionBanner";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

type Host = Pick<HostingAdminVpsHost, "provider" | "name" | "runnerOnboarding">;
function host(name: string, onboarding: Partial<NonNullable<HostingAdminVpsHost["runnerOnboarding"]>> | null): Host {
    return { provider: "ovhcloud-vps", name, runnerOnboarding: onboarding === null ? null : {
        state: "succeeded", progressStage: "runner-active", errorCode: null, sourceCommit: "a".repeat(40),
        updatedAt: "2026-10-23T00:53:36.115Z", ...onboarding } };
}
async function render(hosts: Host[]) { await act(async () => root.render(<OutOfAdmissionBanner hosts={hosts} />)); }

it("renders nothing when every enrolled host's onboarding succeeded, and ignores hosts never enrolled", async () => {
    const hosts = [host("vps-a", {}), host("vps-b", null)];
    expect(outOfAdmissionHosts(hosts)).toEqual([]);
    await render(hosts);
    expect(container.innerHTML).toBe("");
});

it("alerts on a failed onboarding with its stage, error and since time, and asks for a retry", async () => {
    await render([host("vps-ok", {}), host("vps-d1d531f9", { state: "failed", progressStage: "slot-3-agent-activating", errorCode: "runner_onboarding_isolation_failed" })]);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.getAttribute("aria-label")).toBe("VPS hosts with a failed onboarding");
    expect(alert?.textContent).toContain("1 VPS host is out of admission: onboarding failed");
    expect(alert?.textContent).toContain("vps-d1d531f9 (ovhcloud-vps): Failed at slot-3-agent-activating with runner_onboarding_isolation_failed");
    expect(alert?.textContent).toContain("Retry onboarding");
    expect(alert?.textContent).not.toContain("vps-ok");
    expect(container.querySelector('[role="status"]')).toBeNull();
});

it("lists onboardings still running or waiting as a status, naming a paused decommission and the optional details", async () => {
    await render([
        host("vps-r", { state: "retry-wait", progressStage: "slot-3-isolated-apply", errorCode: "agent_transport_unavailable",
            attemptCount: 2, maximumAttempts: 3, timeoutAt: "2026-10-23T06:52:00.000Z", startedByAutomaticSizing: true }),
        host("vps-p", { state: "retry-wait", progressStage: "slot-decommission-paused", errorCode: "slot_decommission_disabled" }),
        host("vps-q", { state: "queued", progressStage: "queued" }),
    ]);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("3 VPS hosts are out of admission while onboarding runs");
    expect(status?.textContent).toContain("vps-r (ovhcloud-vps): Waiting to retry at slot-3-isolated-apply with agent_transport_unavailable, attempt 2 of 3");
    expect(status?.textContent).toContain("times out");
    expect(status?.textContent).toContain("started by automatic slot sizing");
    expect(status?.textContent).toContain("vps-p (ovhcloud-vps): Decommission paused at slot-decommission-paused");
    expect(status?.textContent).toContain("vps-q (ovhcloud-vps): Queued at queued");
    expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("omits the optional details an older control plane does not report", async () => {
    await render([host("vps-r", { state: "running", progressStage: "slot-3-host-delivering" })]);
    const text = container.querySelector('[role="status"]')?.textContent ?? "";
    expect(text).toContain("vps-r (ovhcloud-vps): Running at slot-3-host-delivering, since");
    expect(text).not.toContain("attempt");
    expect(text).not.toContain("times out");
    expect(text).not.toContain("automatic slot sizing");
});
