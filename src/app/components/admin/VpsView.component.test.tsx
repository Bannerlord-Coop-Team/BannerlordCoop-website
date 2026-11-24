import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostingAdminHostResources, HostingAdminVpsHost, HostingAdminVpsInventory, HostingRegionCatalogRead } from "@/app/lib/control-plane/types";
import { VpsView } from "./VpsView";

const mocks = vi.hoisted(() => ({ request: vi.fn(), resources: vi.fn(), billing: vi.fn(), oracle: vi.fn(), regionRequests: vi.fn(), session: vi.fn() }));
vi.mock("@/app/lib/control-plane/client", () => ({ requestControlPlaneAdmin: mocks.request }));
vi.mock("@/app/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: mocks.session } }) }));
vi.mock("./RunnerOnboardingStatus", () => ({ RunnerOnboardingStatus: () => <span>Runner current</span> }));
vi.mock("./VpsSlotCapacityRaise", () => ({ VpsSlotCapacityRaise: () => <span>Raise slots</span> }));
vi.mock("./VpsSlotDecommission", () => ({ VpsSlotDecommission: () => <span>Decommission slots</span> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const NO_REGIONS: HostingRegionCatalogRead = { regions: [], error: null };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mocks.request.mockImplementation(options => options.operation === "control-plane-host-resources" ? mocks.oracle(options) : options.operation === "region-requests"
        ? mocks.regionRequests(options)
        : (options.input.includeLiveData ? mocks.resources : mocks.billing)(options));
    mocks.billing.mockResolvedValue({ ...inventory(true), liveDataIncluded: false });
    mocks.regionRequests.mockResolvedValue({ items: [], nextCursor: null });
    mocks.oracle.mockResolvedValue(resources(60, 40));
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
        availableHosts: [], runnerTargetSourceCommit: liveDataIncluded ? "target-source" : null };
}

function oracleCard() {
    return [...container.querySelectorAll('h3')].find(heading => heading.textContent === 'Oracle control plane')!.closest('section')!.textContent;
}

it("loads and refreshes Oracle while fleet resources and billing remain stalled", async () => {
    mocks.resources.mockReturnValue(new Promise(() => {}));
    mocks.billing.mockReturnValue(new Promise(() => {}));
    const initial = resources(60, 40);
    const updated = { ...initial, cpuPercent: 12.3 };
    mocks.oracle.mockResolvedValueOnce(initial).mockResolvedValueOnce(updated);
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    expect(oracleCard()).toContain("47.7%");
    expect(oracleCard()).not.toContain("Loading");
    expect(container.textContent).toContain("Loading live resource");
    expect(mocks.oracle).toHaveBeenCalledWith(expect.objectContaining({ operation: "control-plane-host-resources" }));
    expect(mocks.oracle.mock.calls[0][0]).not.toHaveProperty("input");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(oracleCard()).toContain("12.3%");
    expect(mocks.resources).toHaveBeenCalledTimes(1);
    expect(mocks.billing).toHaveBeenCalledTimes(1);
});

it("keeps Oracle readings independent when a later fleet response arrives", async () => {
    const fleet = deferred();
    mocks.resources.mockReturnValue(fleet.promise);
    mocks.oracle.mockResolvedValue({ ...resources(60, 40), cpuPercent: 12.3 });
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    await act(async () => fleet.resolve(inventory(true)));
    expect(oracleCard()).toContain("12.3%");
    expect(oracleCard()).not.toContain("47.7%");
});

it("retains and labels failed Oracle readings, retries only Oracle, and clears a missing observation", async () => {
    mocks.resources.mockResolvedValue(inventory(true));
    mocks.oracle.mockResolvedValueOnce(resources(60, 40)).mockRejectedValueOnce(new Error("Oracle unavailable"))
        .mockResolvedValueOnce(null);
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(oracleCard()).toContain("47.7%");
    expect(container.textContent).toContain("Showing the last Oracle readings");
    const fleetCalls = mocks.resources.mock.calls.length;
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === "Retry Oracle readings")!.click());
    expect(mocks.resources).toHaveBeenCalledTimes(fleetCalls);
    expect(oracleCard()).toContain("No current trusted resource observation");
    expect(container.textContent).not.toContain("Showing the last Oracle readings");
});

it("bounds slow Oracle reads, pauses hidden tabs and aborts on unmount", async () => {
    mocks.resources.mockResolvedValue(inventory(true));
    mocks.oracle.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.oracle).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Oracle readings timed out");
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
        await act(async () => vi.advanceTimersByTimeAsync(30_000));
        expect(mocks.oracle).toHaveBeenCalledTimes(1);
        visibility.mockReturnValue("visible");
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
        expect(mocks.oracle).toHaveBeenCalledTimes(2);
        const signal = mocks.oracle.mock.calls[1][0].signal as AbortSignal;
        await act(async () => root.render(null));
        expect(signal.aborted).toBe(true);
    } finally { visibility.mockRestore(); }
});
function deferred() {
    let resolve!: (value: HostingAdminVpsInventory) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<HostingAdminVpsInventory>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
it("shows fleet slot totals above the Oracle control plane card", async () => {
    const listed = inventory(true);
    listed.hosts[0] = { ...listed.hosts[0], region: "us-east" };
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={listed} accounts={[]} />));
    const text = container.textContent ?? "";
    const totals = text.indexOf("Total slots");
    const oracle = text.indexOf("Oracle control plane");
    expect(totals).toBeGreaterThan(-1);
    expect(oracle).toBeGreaterThan(totals);
    expect(text).toContain("Taken slots");
    expect(text).toContain("US-East");
    expect(text).toContain("1 taken / 3 total");
});

it("shows usable inventory before readings and preserves an expanded row when they arrive", async () => {
    const read = deferred(); mocks.resources.mockReturnValue(read.promise);
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    expect(container.textContent).toContain("host-a");
    expect(container.textContent).toContain("testserver");
    expect(container.textContent).toContain("Runner current");
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
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
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
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory(false, "host-b")} accounts={[]} />));
    await act(async () => old.resolve(inventory(true)));
    expect(container.textContent).toContain("host-b");
    expect(container.textContent).not.toContain("host-a");
    await act(async () => current.resolve(inventory(true, "host-b")));
    expect(container.textContent).not.toContain("Loading live resource");
});
it.each([true, undefined])("does not reload an already complete or legacy response (%s)", async (flag) => {
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={{ ...inventory(true), liveDataIncluded: flag }} accounts={[]} />));
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
        notifiedAt: null,
    }], nextCursor: null });
    mocks.request.mockImplementation(async options => {
        if (options.operation === "region-requests") return mocks.regionRequests(options);
        if (options.operation === "control-plane-host-resources") return mocks.oracle(options);
        if (options.operation === "resolve-region-request") return {};
        return options.input.includeLiveData ? mocks.resources(options) : mocks.billing(options);
    });
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory(true)} accounts={[]} />));
    expect(container.textContent).toContain("Pending region requests");
    expect(container.textContent).toContain("United Kingdom");
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

it("notifies a requester once and keeps the request pending with a notified badge", async () => {
    mocks.regionRequests.mockResolvedValue({ items: [{
        requestId: "11111111-1111-4111-8111-111111111111",
        guildId: "709516043332354119",
        discordUserId: "33333333-3333-4333-8333-333333333333",
        region: "united-kingdom",
        status: "outstanding",
        createdAt: "2026-10-08T12:00:00.000Z",
        requesterEmail: "owner@example.com",
        allocatedRegions: [],
        notifiedAt: null,
    }], nextCursor: null });
    mocks.request.mockImplementation(async options => {
        if (options.operation === "region-requests") return mocks.regionRequests(options);
        if (options.operation === "control-plane-host-resources") return mocks.oracle(options);
        if (options.operation === "notify-region-request") {
            return { requestId: options.input.requestId, notifiedAt: "2026-10-10T12:00:00.000Z", sent: true };
        }
        return options.input.includeLiveData ? mocks.resources(options) : mocks.billing(options);
    });
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory(true)} accounts={[]} />));
    expect(container.textContent).not.toContain("Notified");
    const notify = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Notify");
    expect(notify).toBeDefined();
    await act(async () => notify!.click());
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
        operation: "notify-region-request",
        input: { requestId: "11111111-1111-4111-8111-111111111111" },
    }));
    expect(container.textContent).toContain("Notified");
    expect(container.textContent).toContain("United Kingdom");
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")].map(button => button.textContent);
    expect(buttons).not.toContain("Notify");
    expect(buttons).toContain("Dismiss");
});

it("offers Notify only when the control plane captured the requester email", async () => {
    mocks.regionRequests.mockResolvedValue({ items: [{
        requestId: "22222222-2222-4222-8222-222222222222",
        guildId: "709516043332354119",
        discordUserId: "33333333-3333-4333-8333-333333333333",
        region: "germany",
        status: "outstanding",
        createdAt: "2026-10-08T12:00:00.000Z",
        requesterEmail: null,
        allocatedRegions: [],
        notifiedAt: null,
    }], nextCursor: null });
    mocks.request.mockImplementation(async options => options.operation === "region-requests"
        ? mocks.regionRequests(options)
        : options.input.includeLiveData ? mocks.resources(options) : mocks.billing(options));
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory(true)} accounts={[]} />));
    expect(container.textContent).toContain("Dismiss");
    expect(container.textContent).not.toContain("Notify");
});

it("recovers a historical requester email from the current account directory", async () => {
    mocks.regionRequests.mockResolvedValue({ items: [{
        requestId: "22222222-2222-4222-8222-222222222222",
        guildId: "709516043332354119",
        discordUserId: "33333333-3333-4333-8333-333333333333",
        region: "germany",
        status: "outstanding",
        createdAt: "2026-10-08T12:00:00.000Z",
        requesterEmail: null,
        allocatedRegions: [],
        notifiedAt: null,
    }], nextCursor: null });
    mocks.request.mockImplementation(async options => {
        if (options.operation === "region-requests") return mocks.regionRequests(options);
        if (options.operation === "control-plane-host-resources") return mocks.oracle(options);
        return options.input.includeLiveData ? mocks.resources(options) : mocks.billing(options);
    });
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory(true)} accounts={[{
        accountId: "33333333-3333-4333-8333-333333333333",
        label: "owner@example.com",
        email: "owner@example.com",
        discordUserId: null,
    }]} />));
    expect(container.textContent).toContain("owner@example.com");
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("Email unavailable");
});

it("updates readings in place without overlapping slow requests or collapsing details", async () => {
    const next = deferred();
    mocks.resources.mockResolvedValueOnce(inventory(true)).mockReturnValueOnce(next.promise);
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for host-a"]')!.click());
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(mocks.resources).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("47.7%");
    expect(container.textContent).not.toContain("Loading");
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.resources).toHaveBeenCalledTimes(2);
    const updated = inventory(true);
    updated.hosts[0].resources!.cpuPercent = 12.3;
    await act(async () => next.resolve(updated));
    expect(container.textContent).toContain("12.3%");
    expect(container.querySelector('button[aria-label="Collapse details for host-a"]')).not.toBeNull();
});

it("labels retained readings on failure and recovers automatically", async () => {
    mocks.resources.mockResolvedValueOnce(inventory(true))
        .mockRejectedValueOnce(new Error("Provider unavailable"))
        .mockResolvedValueOnce({ ...inventory(true), controlPlaneHost: null });
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(container.textContent).toContain("47.7%");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Showing the last resource readings");
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(oracleCard()).toContain("47.7%");
});

it("pauses hidden tabs, resumes on return, and cancels requests on unmount", async () => {
    mocks.resources.mockResolvedValue(inventory(true));
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
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
    updated.hosts[0].resources!.cpuPercent = 12.3;
    mocks.resources.mockResolvedValue(updated);
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory(true)} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(mocks.resources).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("12.3%");
});

it("shows resources and runner state while billing is pending, then merges only provider fields", async () => {
    const billing = deferred();
    mocks.billing.mockReturnValue(billing.promise);
    const live = inventory(true);
    live.hosts[0].runningServers = 2;
    mocks.resources.mockResolvedValue(live);
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
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
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Billing readings timed out");
    expect(container.querySelector('[data-label="Billing"]')?.textContent).toBe("Unavailable");
    expect(container.textContent).toContain("47.7%");
    expect(mocks.resources).toHaveBeenCalledTimes(2);
    expect(mocks.billing).toHaveBeenCalledTimes(1);
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === "Retry billing")!.click());
    expect(mocks.resources).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[data-label="Billing"]')?.textContent).toContain("$12.32");
});

it("retains and labels stale billing independently of successful telemetry refreshes", async () => {
    mocks.resources.mockResolvedValue(inventory(true));
    mocks.billing.mockResolvedValueOnce({ ...inventory(true), liveDataIncluded: false })
        .mockRejectedValueOnce(new Error("Provider unavailable"));
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
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
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    const signal = mocks.billing.mock.calls[0][0].signal as AbortSignal;
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory(false, "host-b")} accounts={[]} />));
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
        provider: "ovhcloud-vps",
        name,
        locationId: "os-us-east-va-2",
        countryCode: "US",
        region: null,
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

it("opens with the out-of-admission banner when a host's onboarding failed", async () => {
    mocks.resources.mockReturnValue(new Promise(() => {}));
    mocks.billing.mockReturnValue(new Promise(() => {}));
    const initial = inventory();
    const failed = { ...initial, hosts: initial.hosts.map(item => ({ ...item, runnerOnboarding: {
        state: "failed" as const, progressStage: "slot-3-isolated-apply", errorCode: "runner_onboarding_isolation_failed",
        sourceCommit: "target-source", updatedAt: "2026-10-23T00:53:36.115Z" } })) };
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={failed} accounts={[]} />));
    const alert = container.querySelector('[role="alert"][aria-label="VPS hosts with a failed onboarding"]');
    expect(alert?.textContent).toContain("host-a (OVHcloud): Failed at slot-3-isolated-apply with runner_onboarding_isolation_failed");
});

/** Stubs the native modal dialog methods jsdom lacks. */
function stubDialog() {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
}

/** Focuses and clicks the page button with the given label, as a keyboard or pointer user would, and returns it. */
async function openFrom(label: string) {
    const trigger = [...container.querySelectorAll("button")].find(button => button.textContent === label)!;
    trigger.focus();
    await act(async () => trigger.click());
    return trigger;
}

const AVAILABLE = { provider: "contabo-vps" as const, serviceName: "203779521", label: "Contabo VPS · 203779521" };

const BENELUX: HostingRegionCatalogRead = { regions: [{ region: "benelux", placement: { countryCodes: ["NL"] }, available: false }], error: null };
const UNREADABLE: HostingRegionCatalogRead = { regions: null, error: "The operation is not supported." };

it.each([
    ["Onboard VPS", "Provider account", BENELUX, "Add manual VPS"],
    ["Add manual VPS", "Manual entry", BENELUX, "Add manual VPS"],
    ["Add manual VPS", "Manual entry", UNREADABLE, "Unavailable"],
] as const)("opens the Add capacity dialog from %s on its %s tab and refocuses the button on close", async (label, tabLabel, hostingRegions, manualSubmit) => {
    stubDialog();
    mocks.resources.mockReturnValue(new Promise(() => {}));
    mocks.billing.mockResolvedValue({ ...inventory(), availableHosts: [AVAILABLE] });
    const listed = { ...inventory(), manualEntryProviders: [{ provider: "hosthatch-vps", displayName: "HostHatch VPS" }] };
    await act(async () => root.render(<VpsView hostingRegions={hostingRegions} inventory={listed} accounts={[]} />));
    expect([...container.querySelectorAll("button")].find(button => button.textContent === label)!.getAttribute("aria-haspopup")).toBe("dialog");
    expect(container.querySelector("dialog")).toBeNull();
    const trigger = await openFrom(label);
    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(tabLabel);
    // The provider tab lists the billing read's unregistered hosts; the manual tab, the inventory's manual-entry providers and the catalog read.
    expect(dialog.querySelector('select[name="host"] option[value*="203779521"]')).not.toBeNull();
    expect(dialog.querySelector<HTMLSelectElement>('select[name="provider"]')!.value).toBe("hosthatch-vps");
    const manual = dialog.querySelectorAll<HTMLElement>('[role="tabpanel"]')[1]!;
    expect(manual.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent).toBe(manualSubmit);
    await act(async () => dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(container.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
});

it("treats a malformed host list as not yet listed", async () => {
    stubDialog();
    mocks.resources.mockReturnValue(new Promise(() => {}));
    mocks.billing.mockResolvedValue({ ...inventory(), availableHosts: "not-a-list" });
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    await openFrom("Onboard VPS");
    const provider = container.querySelector<HTMLElement>('dialog [role="tabpanel"]:not([hidden])')!;
    expect(provider.textContent).toContain("Provider account inventory is unavailable, so unregistered VPS products cannot be listed");
    expect(provider.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent).toBe("Unavailable");
});

it("retries the billing read from the Provider account tab", async () => {
    stubDialog();
    mocks.resources.mockReturnValue(new Promise(() => {}));
    mocks.billing.mockRejectedValueOnce(new Error("Billing provider timed out.")).mockResolvedValueOnce({ ...inventory(), availableHosts: [AVAILABLE] });
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    await openFrom("Onboard VPS");
    const retry = [...container.querySelectorAll<HTMLButtonElement>("dialog button")].find(button => button.textContent === "Retry provider inventory")!;
    await act(async () => retry.click());
    expect(mocks.billing).toHaveBeenCalledTimes(2);
    expect(container.querySelector<HTMLSelectElement>('dialog select[name="host"]')!.value).toContain("203779521");
});

it("keeps the listed provider host beside a retained-inventory notice when a later billing read fails", async () => {
    stubDialog();
    mocks.resources.mockReturnValue(new Promise(() => {}));
    mocks.billing.mockResolvedValueOnce({ ...inventory(), availableHosts: [AVAILABLE] }).mockRejectedValueOnce(new Error("Billing provider timed out."));
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(container.textContent).toContain("Showing the last billing readings");
    await openFrom("Onboard VPS");
    const provider = container.querySelector<HTMLElement>('dialog [role="tabpanel"]:not([hidden])')!;
    expect(provider.querySelector('[role="status"]')!.textContent).toBe("Showing the last provider account inventory; retrying automatically.Billing provider timed out.Retry provider inventory");
    expect(provider.querySelector<HTMLSelectElement>('select[name="host"]')!.value).toContain("203779521");
});

it("keeps billing across a server refresh while the refreshed registered inventory replaces stale resources", async () => {
    mocks.resources.mockResolvedValueOnce(inventory(true)).mockReturnValue(new Promise(() => {}));
    mocks.billing.mockResolvedValueOnce({ ...inventory(), availableHosts: [AVAILABLE] }).mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    expect(container.textContent).toContain("1 authenticated provider VPS is available to onboard.");
    // router.refresh() after onboarding hands the view a new registered inventory with the new host.
    const refreshed = { ...inventory(), hosts: [...inventory().hosts, inventory(false, "host-new").hosts[0]!] };
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={refreshed} accounts={[]} />));
    expect(container.textContent).toContain("host-new");
    expect(container.textContent).toContain("Loading live resource readings");
    expect(container.textContent).not.toContain("Loading billing readings");
    expect(container.textContent).toContain("1 authenticated provider VPS is available to onboard.");
});

it("keeps the last billing host list and its error when the read after a server refresh fails", async () => {
    mocks.resources.mockReturnValue(new Promise(() => {}));
    mocks.billing.mockResolvedValueOnce({ ...inventory(), availableHosts: [AVAILABLE] }).mockRejectedValueOnce(new Error("Billing provider timed out."));
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    expect(container.textContent).toContain("1 authenticated provider VPS is available to onboard.");
    // The refreshed inventory reads billing again at once; that read fails.
    await act(async () => root.render(<VpsView hostingRegions={NO_REGIONS} inventory={inventory()} accounts={[]} />));
    expect(mocks.billing).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("1 authenticated provider VPS is available to onboard.");
    expect(container.textContent).toContain("Showing the last billing readings");
});
