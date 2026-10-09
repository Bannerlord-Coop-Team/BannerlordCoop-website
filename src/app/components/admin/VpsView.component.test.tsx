import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostingAdminHostResources, HostingAdminVpsHost, HostingAdminVpsInventory } from "@/app/lib/control-plane/types";
import { VpsView } from "./VpsView";

const mocks = vi.hoisted(() => ({ request: vi.fn(), resources: vi.fn(), billing: vi.fn(), regionRequests: vi.fn(), session: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", () => ({ requestControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));
vi.mock("./RunnerOnboardingStatus", () => ({ RunnerOnboardingStatus: () => <span>Runner current</span> }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mocks.request.mockImplementation(options => options.operation === "region-requests"
        ? mocks.regionRequests(options)
        : (options.input.includeLiveData ? mocks.resources : mocks.billing)(options));
    mocks.billing.mockResolvedValue({ ...inventory(true), liveDataIncluded: false });
    mocks.regionRequests.mockResolvedValue({ items: [], nextCursor: null });
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
    const read = deferred(); mocks.resources.mockReturnValue(read.promise);
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
    expect(mocks.resources).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "test-token", operation: "vps-hosts" }));
});
it("keeps inventory on failure and retries live readings", async () => {
    mocks.resources.mockRejectedValueOnce(new Error("Provider unavailable")).mockResolvedValueOnce(inventory(true));
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    expect(container.textContent).toContain("host-a");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Provider unavailable");
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === "Retry live readings")!.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("47.7%");
    expect(mocks.resources).toHaveBeenCalledTimes(2);
});
it("ignores an old result after the server supplies a new inventory", async () => {
    const old = deferred(); const current = deferred();
    mocks.resources.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
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
    expect(mocks.resources).not.toHaveBeenCalled();
});

it("shows pending region requests and removes one after an inline resolution", async () => {
    mocks.regionRequests.mockResolvedValue({ items: [{
        requestId: "11111111-1111-4111-8111-111111111111",
        guildId: "709516043332354119",
        discordUserId: "123456789012345678",
        region: "united-kingdom",
        status: "outstanding",
        createdAt: "2026-10-08T12:00:00.000Z",
        requesterEmail: "owner@example.com",
        allocatedRegions: ["germany"],
    }], nextCursor: null });
    mocks.request.mockImplementation(async options => {
        if (options.operation === "region-requests") return mocks.regionRequests(options);
        if (options.operation === "resolve-region-request") return {};
        return options.input.includeLiveData ? mocks.resources(options) : mocks.billing(options);
    });
    await act(async () => root.render(<VpsView inventory={inventory(true)} accounts={[]} />));
    expect(container.textContent).toContain("Pending region requests");
    expect(container.textContent).toContain("united-kingdom");
    expect(container.textContent).toContain("owner@example.com");
    expect(container.textContent).toContain("Germany");
    expect(container.textContent).not.toContain("123456789012345678");
    expect(container.textContent).toContain("Dismiss");
    expect(container.textContent).not.toContain("Approve");
    expect(container.textContent).not.toContain("Fulfill");
    expect(container.textContent).not.toContain("Requests are saved without");
    const dismiss = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Dismiss");
    expect(dismiss).toBeDefined();
    await act(async () => dismiss!.click());
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
        operation: "resolve-region-request",
        input: { requestId: "11111111-1111-4111-8111-111111111111", resolution: "dismissed" },
    }));
    expect(container.textContent).not.toContain("united-kingdom");
});

it("updates readings in place without overlapping slow requests or collapsing details", async () => {
    const next = deferred();
    mocks.resources.mockResolvedValueOnce(inventory(true)).mockReturnValueOnce(next.promise);
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-a"]')!.click());
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(mocks.resources).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("47.7%");
    expect(container.textContent).not.toContain("Loading");
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.resources).toHaveBeenCalledTimes(2);
    const updated = inventory(true);
    updated.controlPlaneHost!.cpuPercent = 12.3;
    await act(async () => next.resolve(updated));
    expect(container.textContent).toContain("12.3%");
    expect(container.querySelector('button[aria-label="Collapse details for host-a"]')).not.toBeNull();
});

it("labels retained readings on failure and recovers automatically", async () => {
    mocks.resources.mockResolvedValueOnce(inventory(true))
        .mockRejectedValueOnce(new Error("Provider unavailable"))
        .mockResolvedValueOnce({ ...inventory(true), controlPlaneHost: null });
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.textContent).toContain("47.7%");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Showing the last resource readings");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("No current trusted resource observation");
});

it("pauses hidden tabs, resumes on return, and cancels requests on unmount", async () => {
    mocks.resources.mockResolvedValue(inventory(true));
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.resources).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    const next = deferred();
    mocks.resources.mockReturnValueOnce(next.promise);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(mocks.resources).toHaveBeenCalledTimes(2);
    const signal = mocks.resources.mock.calls[1][0].signal as AbortSignal;
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
    await act(async () => next.resolve(inventory(true)));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.resources).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
});

it("refreshes an initially complete snapshot after the interval", async () => {
    const updated = inventory(true);
    updated.controlPlaneHost!.cpuPercent = 12.3;
    mocks.resources.mockResolvedValue(updated);
    await act(async () => root.render(<VpsView inventory={inventory(true)} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(mocks.resources).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("12.3%");
});

it("shows resources and runner state while billing is pending, then merges only provider fields", async () => {
    const billing = deferred();
    mocks.billing.mockReturnValue(billing.promise);
    const live = inventory(true);
    live.hosts[0].runningServers = 2;
    mocks.resources.mockResolvedValue(live);
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    expect(container.textContent).toContain("47.7%");
    expect(container.textContent).toContain("Runner current");
    expect(container.textContent).toContain("Loading billing readings");
    expect(container.querySelector('[data-label="Billing"]')?.textContent).toContain("Loading");
    expect(container.querySelector('[data-label="Capacity"]')?.textContent).toContain("Running2");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-a"]')!.click());
    await act(async () => billing.resolve({ ...inventory(), hosts: inventory(true).hosts }));
    expect(container.querySelector('[data-label="Billing"]')?.textContent).toContain("$12.32 / month");
    expect(container.querySelector('[data-label="Capacity"]')?.textContent).toContain("Running2");
    expect(container.textContent).toContain("47.7%");
    expect(container.querySelector('button[aria-label="Collapse details for host-a"]')).not.toBeNull();
    expect(mocks.resources).toHaveBeenCalledWith(expect.objectContaining({ input: { includeLiveData: true, includeProviderInventory: false } }));
    expect(mocks.billing).toHaveBeenCalledWith(expect.objectContaining({ input: { includeLiveData: false, includeProviderInventory: true } }));
});

it("times out billing separately, continues telemetry, and recovers on a billing-only retry", async () => {
    mocks.resources.mockResolvedValue(inventory(true));
    mocks.billing.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Billing readings timed out");
    expect(container.querySelector('[data-label="Billing"]')?.textContent).toBe("Unavailable");
    expect(container.textContent).toContain("47.7%");
    expect(mocks.resources).toHaveBeenCalledTimes(4);
    expect(mocks.billing).toHaveBeenCalledTimes(1);
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === "Retry billing")!.click());
    expect(mocks.resources).toHaveBeenCalledTimes(4);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[data-label="Billing"]')?.textContent).toContain("$12.32");
});

it("retains and labels stale billing independently of successful telemetry refreshes", async () => {
    mocks.resources.mockResolvedValue(inventory(true));
    mocks.billing.mockResolvedValueOnce({ ...inventory(true), liveDataIncluded: false })
        .mockRejectedValueOnce(new Error("Provider unavailable"));
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Showing the last billing readings");
    expect(container.querySelector('[data-label="Billing"]')?.textContent).toContain("$12.32");
    expect(container.textContent).toContain("47.7%");
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("ignores old billing after new inventory arrives and aborts billing on unmount", async () => {
    const old = deferred();
    mocks.resources.mockImplementation(async () => inventory(true, "host-b"));
    mocks.billing.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...inventory(true, "host-b"), liveDataIncluded: false });
    await act(async () => root.render(<VpsView inventory={inventory()} accounts={[]} />));
    const signal = mocks.billing.mock.calls[0][0].signal as AbortSignal;
    await act(async () => root.render(<VpsView inventory={inventory(false, "host-b")} accounts={[]} />));
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve({ ...inventory(true), liveDataIncluded: false }));
    expect(container.textContent).toContain("host-b");
    expect(container.textContent).not.toContain("host-a");
    const currentSignal = mocks.billing.mock.calls[1][0].signal as AbortSignal;
    await act(async () => root.render(null));
    expect(currentSignal.aborted).toBe(true);
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
