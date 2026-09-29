import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostingAdminHostResources, HostingAdminVpsHost, HostingAdminVpsInventory } from "@/app/lib/control-plane/types";
import { VpsView } from "./VpsView";

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", () => ({ requestControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));
vi.mock("./RunnerOnboardingStatus", () => ({ RunnerOnboardingStatus: () => <span>Runner current</span> }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mocks.session.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
function inventory(liveDataIncluded = false, name = "host-a"): HostingAdminVpsInventory {
    const item = host(name, resources(60, 40), 0);
    return { liveDataIncluded, hosts: [{ ...item, resources: liveDataIncluded ? item.resources : null,
        occupiedSlots: item.occupiedSlots.map(slot => ({ ...slot, resources: liveDataIncluded ? slot.resources : null })),
        cost: liveDataIncluded ? item.cost : null, providerCheckedAt: liveDataIncluded ? item.providerCheckedAt : null }],
        controlPlaneHost: liveDataIncluded ? resources(60, 40) : null,
        availableServiceNames: [], runnerTargetSourceCommit: liveDataIncluded ? "target-source" : null };
}
function deferred() {
    let resolve!: (value: HostingAdminVpsInventory) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<HostingAdminVpsInventory>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
it("shows usable inventory before readings and preserves an expanded row when they arrive", async () => {
    const read = deferred(); mocks.request.mockReturnValue(read.promise);
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    expect(container.textContent).toContain("host-a");
    expect(container.textContent).toContain("testserver");
    expect(container.textContent).toContain("Loading live resource");
    expect(container.textContent).not.toContain("unavailable");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-a"]')!.click());
    expect(container.textContent).toContain("Slot 1 · UDP 4200");
    await act(async () => read.resolve(inventory(true)));
    expect(container.textContent).not.toContain("Loading");
    expect(container.textContent).toContain("47.7%");
    expect(container.querySelector('button[aria-label="Collapse details for host-a"]')).not.toBeNull();
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "test-token", operation: "vps-hosts" }));
});
it("keeps inventory on failure and retries live readings", async () => {
    mocks.request.mockRejectedValueOnce(new Error("Provider unavailable")).mockResolvedValueOnce(inventory(true));
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    expect(container.textContent).toContain("host-a");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Provider unavailable");
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === "Retry live readings")!.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("47.7%");
    expect(mocks.request).toHaveBeenCalledTimes(2);
});
it("ignores an old result after the server supplies a new inventory", async () => {
    const old = deferred(); const current = deferred();
    mocks.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    await act(async () => root.render(<VpsView inventory={inventory(false, "host-b")} accounts={[]} />));
    await act(async () => old.resolve(inventory(true)));
    expect(container.textContent).toContain("host-b");
    expect(container.textContent).not.toContain("host-a");
    await act(async () => current.resolve(inventory(true, "host-b")));
    expect(container.textContent).not.toContain("Loading live resource");
});
it.each([true, undefined])("does not reload an already complete or legacy response (%s)", async (flag) => {
    await act(async () => root.render(<VpsView inventory={{ ...inventory(true), liveDataIncluded: flag }} accounts={[]} />));
    expect(mocks.request).not.toHaveBeenCalled();
});

it("updates readings in place without overlapping slow requests or collapsing details", async () => {
    const next = deferred();
    mocks.request.mockResolvedValueOnce(inventory(true)).mockReturnValueOnce(next.promise);
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-a"]')!.click());
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("47.7%");
    expect(container.textContent).not.toContain("Loading");
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.request).toHaveBeenCalledTimes(2);
    const updated = inventory(true);
    updated.controlPlaneHost!.cpuPercent = 12.3;
    await act(async () => next.resolve(updated));
    expect(container.textContent).toContain("12.3%");
    expect(container.querySelector('button[aria-label="Collapse details for host-a"]')).not.toBeNull();
});

it("labels retained readings on failure and recovers automatically", async () => {
    mocks.request.mockResolvedValueOnce(inventory(true))
        .mockRejectedValueOnce(new Error("Provider unavailable"))
        .mockResolvedValueOnce({ ...inventory(true), controlPlaneHost: null });
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.textContent).toContain("47.7%");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Showing the last readings");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("No current trusted resource observation");
});

it("pauses hidden tabs, resumes on return, and cancels requests on unmount", async () => {
    mocks.request.mockResolvedValue(inventory(true));
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    const next = deferred();
    mocks.request.mockReturnValueOnce(next.promise);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(mocks.request).toHaveBeenCalledTimes(2);
    const signal = mocks.request.mock.calls[1][0].signal as AbortSignal;
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
    await act(async () => next.resolve(inventory(true)));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.request).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
});

it("refreshes an initially complete snapshot after the interval", async () => {
    const updated = inventory(true);
    updated.controlPlaneHost!.cpuPercent = 12.3;
    mocks.request.mockResolvedValue(updated);
    await act(async () => root.render(<VpsView inventory={inventory(true)} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("12.3%");
});

function host(name: string, hostResources: HostingAdminHostResources, slotIndex: number, updating = false): HostingAdminVpsHost {
    return {
        name,
        locationId: "os-us-east-va-2",
        region: "us-east",
        totalSlots: 3,
        runningServers: 1,
        availableServers: 2,
        occupiedSlots: [{
            slotIndex,
            gamePort: 4200 + slotIndex,
            serverId: `server-${slotIndex}`,
            displayName: slotIndex === 0 ? "testserver" : "Joke's Cool Server",
            ownerDiscordUserId: "owner-1",
            operationState: "running",
            resources: {
                observedAt: "2026-09-10T18:00:00.000Z",
                sampleDurationMs: 250,
                cpuVcpus: 1.16,
                cpuLimitVcpus: 2,
                memoryUsedBytes: 1_352_917_606,
                memoryLimitBytes: 3_221_225_472,
            },
        }],
        cost: { priceInMicrocents: 1_232_000_000, currencyCode: "USD", duration: "P1M", interval: 1 },
        expirationDate: "2027-08-30T20:52:00.000Z",
        autoRenew: true,
        providerCheckedAt: "2026-09-10T18:00:00.000Z",
        resources: hostResources,
        runnerOnboarding: { state: "succeeded", progressStage: "runner-active", errorCode: null, sourceCommit: "target-source", updatedAt: "2026-09-10T18:00:00.000Z" },
        runnerUpdate: updating ? {
            state: "running",
            progressStage: "verifying-capabilities",
            errorCode: null,
            targetSourceCommit: "target-source",
            priorSourceCommit: "prior-source",
            updatedAt: "2026-09-10T18:00:00.000Z",
        } : null,
    };
}

function resources(used: number, free: number): HostingAdminHostResources {
    return {
        observedAt: "2026-09-10T18:00:00.000Z",
        uptimeSeconds: 900_000,
        cpuPercent: 47.7,
        memoryUsedBytes: 2_791_728_742,
        memoryTotalBytes: 12_240_000_000,
        diskUsedBytes: used * 1024,
        diskFreeBytes: free * 1024,
        diskTotalBytes: 100 * 1024,
    };
}
