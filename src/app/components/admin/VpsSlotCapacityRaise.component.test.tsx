import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneAdminError } from "@/app/lib/control-plane/client";
import type { HostingAdminVpsHost } from "@/app/lib/control-plane/types";
import { VpsSlotCapacityRaise } from "./VpsSlotCapacityRaise";

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
    updatedAt: "2026-10-20T12:00:00.000Z",
};

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
    await act(async () => root.render(<VpsSlotCapacityRaise
        host={{ provider: "ovhcloud-vps", name: SERVICE_NAME, totalSlots: 2, runnerOnboarding: SUCCEEDED, ...host }}
        onRefresh={onRefresh}
    />));
}

function input() {
    return container.querySelector<HTMLInputElement>('input[type="number"]')!;
}

function button() {
    return container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
}

async function enter(value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
        setter.call(input(), value);
        input().dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function submit() {
    await act(async () => container.querySelector("form")!.requestSubmit());
}

it("raises the host row's provider and service name to the entered capacity and refreshes the parent", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const refresh = vi.fn();
    mocks.request.mockResolvedValue({
        outcome: "raised", provider: "ovhcloud-vps", serviceName: SERVICE_NAME, vCpu: 4, previousSlotCapacity: 2,
        slotCapacity: 6, runnerOnboarding: { ...SUCCEEDED, state: "queued", progressStage: "slot-capacity-raised" },
    });
    await render({}, refresh);
    expect(input().value).toBe("3");
    expect(container.textContent).toContain("Now 2 slots.");
    await enter("6");
    await submit();

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(`Raise ${SERVICE_NAME} from 2 to 6 slots?`));
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({
        accessToken: "test-token",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        operation: "raise-vps-slot-capacity",
        input: { provider: "ovhcloud-vps", serviceName: SERVICE_NAME, slotCapacity: 6, reason: expect.any(String) },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/^Raised from 2 to 6 slots\./u);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
});

it("refreshes the page itself when no parent refresh is given", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.request.mockResolvedValue({
        outcome: "unchanged", provider: "ovhcloud-vps", serviceName: SERVICE_NAME, vCpu: 4, previousSlotCapacity: 3,
        slotCapacity: 3, runnerOnboarding: SUCCEEDED,
    });
    await render();
    await submit();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("This VPS already has 3 slots; nothing changed.");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it("shows the control plane's refusal, such as the switch being off, and changes nothing on the page", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const refresh = vi.fn();
    mocks.request.mockRejectedValue(new ControlPlaneAdminError("vps_slot_capacity_disabled", "Switched off.", false));
    await render({}, refresh);
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/switched off on the control plane \(HOSTING_DYNAMIC_SLOT_CAPACITY\)/u);
    expect(refresh).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
});

it("rejects a result for another host instead of reporting it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const refresh = vi.fn();
    mocks.request.mockResolvedValue({
        outcome: "raised", provider: "ovhcloud-vps", serviceName: "vps-other.vps.ovh.us", vCpu: 4, previousSlotCapacity: 2,
        slotCapacity: 3, runnerOnboarding: SUCCEEDED,
    });
    await render({}, refresh);
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("The control plane returned an unexpected slot capacity result.");
    expect(refresh).not.toHaveBeenCalled();
});

it("sends nothing for a capacity that is not above the current one, or when the confirmation is declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await render();
    await enter("2");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Choose more than the 2 slots this VPS has now; a capacity is never lowered.");
    expect(confirm).not.toHaveBeenCalled();
    await enter("33");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("A VPS holds at most 32 slots.");
    await enter("4");
    await submit();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.request).not.toHaveBeenCalled();
});

it("is disabled until onboarding succeeds and once the VPS holds 32 slots", async () => {
    await render({ runnerOnboarding: { ...SUCCEEDED, state: "running" } });
    expect(button().disabled).toBe(true);
    expect(input().disabled).toBe(true);
    expect(container.textContent).toContain("Available once this VPS's runner onboarding has succeeded.");
    await render({ runnerOnboarding: null });
    expect(button().disabled).toBe(true);
    await render({ totalSlots: 32 });
    expect(button().disabled).toBe(true);
    expect(container.textContent).toContain("This VPS already holds the most slots, 32.");
    await render();
    expect(button().disabled).toBe(false);
    expect(button().title).toMatch(/reserves no cores/u);
});
