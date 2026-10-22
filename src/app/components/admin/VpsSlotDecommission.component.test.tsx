import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { VpsSlotDecommission } from "./VpsSlotDecommission";

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/app/lib/control-plane/client")>(),
    requestControlPlaneAdmin: mocks.request,
}));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const SERVICE_NAME = "vps-a1b2c3d4.vps.ovh.us";
const SUCCEEDED: NonNullable<HostingAdminVpsHost["runnerOnboarding"]> = {
    state: "succeeded", progressStage: "runner-active", errorCode: null, sourceCommit: "a".repeat(40),
    updatedAt: "2026-10-21T12:00:00.000Z",
};
const KEPT_FAILED: NonNullable<HostingAdminVpsHost["runnerOnboarding"]> = {
    ...SUCCEEDED, state: "failed", progressStage: "slot-decommission-continuity", errorCode: "slot_decommission_kept_game_newly_failed",
};
const TOKEN = "b".repeat(64);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
});

afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    container.remove();
});

async function render(host: Partial<Pick<HostingAdminVpsHost, "totalSlots" | "runnerOnboarding">> = {}, onRefresh?: () => void) {
    await act(async () => root.render(<VpsSlotDecommission
        host={{ provider: "ovhcloud-vps", name: SERVICE_NAME, totalSlots: 4, runnerOnboarding: SUCCEEDED, ...host }}
        onRefresh={onRefresh}
    />));
}

function field(label: string) {
    const element = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent === label);
    return document.getElementById(element!.htmlFor) as HTMLInputElement;
}

function button(text: string) {
    return [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === text)!;
}

function form(label: string) {
    return container.querySelector<HTMLFormElement>(`form[aria-label="${label}"]`);
}

async function enter(label: string, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
        setter.call(field(label), value);
        field(label).dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function submit(label: string) {
    await act(async () => form(label)!.requestSubmit());
}

const status = () => container.querySelector('[role="status"]');
const alert = () => container.querySelector('[role="alert"]');

it("confirms, then requests the host row's decommission to the entered slots with its reason, and refreshes the parent", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const refresh = vi.fn();
    mocks.request.mockResolvedValue({
        outcome: "draining", provider: "ovhcloud-vps", serviceName: SERVICE_NAME, vCpu: 4, slotCapacity: 4, targetSlots: 2,
        occupiedSlotIndexes: [3], runnerOnboarding: SUCCEEDED,
    });
    await render({}, refresh);
    expect(field("Keep slots").value).toBe("3");
    await enter("Keep slots", "2");
    await enter("Reason", "  Too few players online together  ");
    await submit(`Decommission slots of ${SERVICE_NAME}`);

    expect(confirm).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(
        new RegExp(`^Decommission ${SERVICE_NAME.replaceAll(".", "\\.")} from 4 to 2 slots\\? Slots 3–4 are retired once empty .*No server is moved`, "u")));
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({
        accessToken: "test-token",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        operation: "decommission-vps-slots",
        input: { provider: "ovhcloud-vps", serviceName: SERVICE_NAME, slotCapacity: 2, reason: "Too few players online together" },
    });
    expect(status()?.textContent).toMatch(/^Planned: Slots 3–4 retire once Slot 4 is empty\./u);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
});

it("uses a fresh request id, and so a fresh correlation id, for each request", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.request.mockResolvedValue({
        outcome: "queued", provider: "ovhcloud-vps", serviceName: SERVICE_NAME, vCpu: 4, slotCapacity: 4, targetSlots: 3,
        occupiedSlotIndexes: [], runnerOnboarding: { ...SUCCEEDED, state: "queued", progressStage: "slot-decommission-queued" },
    });
    await render();
    await enter("Reason", "Retire the empty slot");
    await submit(`Decommission slots of ${SERVICE_NAME}`);
    await submit(`Decommission slots of ${SERVICE_NAME}`);
    const [first, second] = mocks.request.mock.calls.map(([options]) => options.requestId);
    expect(first).not.toBe(second);
    expect(status()?.textContent).toMatch(/^Queued: the control plane is decommissioning Slot 4, lowering this VPS to 3 slots\./u);
    // Without a parent refresh the page refreshes itself.
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
});

it("shows the switched-off control plane as a calm note, not an alert, and changes nothing on the page", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const refresh = vi.fn();
    mocks.request.mockRejectedValue(new ControlPlaneAdminError("vps_slot_decommission_disabled",
        "Decommissioning VPS slots is switched off on this control plane (HOSTING_DYNAMIC_SLOT_CAPACITY).", false));
    await render({}, refresh);
    await enter("Reason", "Retire the empty slot");
    await submit(`Decommission slots of ${SERVICE_NAME}`);
    expect(alert()).toBeNull();
    expect(status()?.textContent).toBe("Slot decommissioning is switched off on this control plane (HOSTING_DYNAMIC_SLOT_CAPACITY is off), so nothing was changed.");
    expect(refresh).not.toHaveBeenCalled();
    expect(button("Decommission slots").disabled).toBe(false);
});

it("shows any other refusal as an alert", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.request.mockRejectedValue(new ControlPlaneAdminError("vps_slot_decommission_would_move", "raw", false));
    await render();
    await enter("Reason", "Retire the empty slot");
    await submit(`Decommission slots of ${SERVICE_NAME}`);
    expect(alert()?.textContent).toMatch(/never moves a server/u);
    expect(status()).toBeNull();
});

it("rejects a result for another host instead of reporting it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const refresh = vi.fn();
    mocks.request.mockResolvedValue({
        outcome: "queued", provider: "ovhcloud-vps", serviceName: "vps-other.vps.ovh.us", vCpu: 4, slotCapacity: 4, targetSlots: 3,
        occupiedSlotIndexes: [], runnerOnboarding: SUCCEEDED,
    });
    await render({}, refresh);
    await enter("Reason", "Retire the empty slot");
    await submit(`Decommission slots of ${SERVICE_NAME}`);
    expect(alert()?.textContent).toBe("The control plane returned an unexpected slot decommission result.");
    expect(refresh).not.toHaveBeenCalled();
});

it("sends nothing for a slot count that is not lower, a missing reason, or a declined confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await render();
    await enter("Keep slots", "4");
    await submit(`Decommission slots of ${SERVICE_NAME}`);
    expect(alert()?.textContent).toBe("Choose fewer than the 4 slots this VPS has now.");
    await enter("Keep slots", "2");
    await submit(`Decommission slots of ${SERVICE_NAME}`);
    expect(alert()?.textContent).toMatch(/^Give a reason of at least 3 characters/u);
    expect(confirm).not.toHaveBeenCalled();
    await enter("Reason", "Retire the empty slots");
    await submit(`Decommission slots of ${SERVICE_NAME}`);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.request).not.toHaveBeenCalled();
});

it("cancels the open plan after a confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    mocks.request.mockResolvedValue({ outcome: "unchanged", provider: "ovhcloud-vps", serviceName: SERVICE_NAME, slotCapacity: 4, runnerOnboarding: SUCCEEDED });
    await render();
    await act(async () => button("Cancel decommission").click());
    expect(mocks.request).not.toHaveBeenCalled();
    await act(async () => button("Cancel decommission").click());
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(new RegExp(`^Cancel the open slot decommission plan of ${SERVICE_NAME.replaceAll(".", "\\.")}\\?`, "u")));
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({
        accessToken: "test-token",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        operation: "cancel-vps-slot-decommission",
        input: { provider: "ovhcloud-vps", serviceName: SERVICE_NAME, reason: expect.any(String) },
    });
    expect(status()?.textContent).toBe("This VPS has no open decommission plan; nothing changed.");
});

it("reports a committed decommission's cancel as an alert", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.request.mockRejectedValue(new ControlPlaneAdminError("vps_slot_decommission_committed", "raw", false));
    await render({ runnerOnboarding: { ...SUCCEEDED, state: "running", progressStage: "slot-decommission-remove" } });
    // A running decommission job can still meet a cancel, so the cancel stays available.
    expect(button("Cancel decommission").disabled).toBe(false);
    await act(async () => button("Cancel decommission").click());
    expect(alert()?.textContent).toMatch(/can no longer be cancelled; it rolls forward/u);
});

it("is disabled for a VPS never onboarded, while its onboarding runs, and at one slot", async () => {
    await render({ runnerOnboarding: null });
    expect(button("Decommission slots").disabled).toBe(true);
    expect(button("Cancel decommission").disabled).toBe(true);
    expect(field("Keep slots").disabled).toBe(true);
    expect(container.textContent).toContain("Available once this VPS has been onboarded.");
    await render({ runnerOnboarding: { ...SUCCEEDED, state: "queued" } });
    expect(button("Decommission slots").disabled).toBe(true);
    expect(button("Cancel decommission").disabled).toBe(false);
    expect(container.textContent).toContain("Available once this VPS's runner onboarding is no longer running.");
    await render({ totalSlots: 1 });
    expect(button("Decommission slots").disabled).toBe(true);
    expect(container.textContent).toContain("This VPS holds one slot, the fewest a VPS keeps.");
    await render();
    expect(button("Decommission slots").disabled).toBe(false);
    expect(button("Decommission slots").title).toMatch(/never moves a server.*HOSTING_DYNAMIC_SLOT_CAPACITY/u);
});

it("offers the kept-slot resolution only after a failed kept-slot check", async () => {
    await render();
    expect(form(`Resolve the kept slots of ${SERVICE_NAME}`)).toBeNull();
    await render({ runnerOnboarding: { ...KEPT_FAILED, errorCode: "slot_decommission_kept_unsettled" } });
    expect(form(`Resolve the kept slots of ${SERVICE_NAME}`)).toBeNull();
    await render({ runnerOnboarding: KEPT_FAILED });
    expect(form(`Resolve the kept slots of ${SERVICE_NAME}`)?.textContent).toContain("slot_decommission_kept_game_newly_failed");
    expect(button("Resolve / accept")).toBeDefined();
});

it("confirms, then sends the resolution and reports the requeued job", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const refresh = vi.fn();
    mocks.request.mockResolvedValue({
        outcome: "requeued", provider: "ovhcloud-vps", serviceName: SERVICE_NAME, evidenceVersion: 1,
        runnerOnboarding: { ...KEPT_FAILED, state: "queued", errorCode: null },
    });
    await render({ runnerOnboarding: KEPT_FAILED }, refresh);
    await enter("Token", TOKEN);
    await enter("Evidence version", "1");
    await enter("Accept slot indexes", "1");
    await enter("Repair slot indexes", "0");
    await enter("Resolution reason", "Owner restarted slot 2 during the job");
    await submit(`Resolve the kept slots of ${SERVICE_NAME}`);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("index 0 (Slot 1): repair; index 1 (Slot 2): accept"));
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({
        accessToken: "test-token",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        operation: "resolve-vps-slot-decommission-kept-slots",
        input: {
            provider: "ovhcloud-vps", serviceName: SERVICE_NAME, token: TOKEN, expectedEvidenceVersion: 1,
            reason: "Owner restarted slot 2 during the job",
            slots: [{ slotIndex: 0, disposition: "repair" }, { slotIndex: 1, disposition: "accept" }],
        },
    });
    expect(status()?.textContent).toMatch(/evidence version 1 and requeued the decommission job/u);
    expect(refresh).toHaveBeenCalledTimes(1);
});

it("shows a control plane without the resolution operation as a calm note", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.request.mockRejectedValue(new ControlPlaneAdminError("invalid_request", "The control plane request is invalid.", false));
    await render({ runnerOnboarding: KEPT_FAILED });
    await enter("Token", TOKEN);
    await enter("Evidence version", "1");
    await enter("Accept slot indexes", "0");
    await enter("Resolution reason", "Accept the restarted game");
    await submit(`Resolve the kept slots of ${SERVICE_NAME}`);
    expect(alert()).toBeNull();
    expect(status()?.textContent).toMatch(/^This control plane cannot resolve kept slots yet/u);
});
